# Admin User Status (Đợt 5, phần 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin/staff user toggle another user's account between `active`/`banned`, enforce
`banned` at login and at every authenticated API call, and wire the existing (currently mock-only)
"Khóa/Mở khóa" button in the admin Users page to the real backend.

**Architecture:** One new backend route (`POST /api/identity/auth/users/{id}/status`) that flips
`profiles.status`, reusing the existing `authenticate`/`requireRole`/`mapUserResponse` helpers.
Enforcement lives in exactly two places — the shared `authenticate()` function (covers every other
route in the project automatically) and the `login` route (rejects before issuing a token) — so no
other route needs to change. A migration adds the missing RLS/GRANT pieces that let an admin update
*another* user's `status` column (today only self-updates of `name`/`phone`/`email` are permitted)
plus a CHECK constraint locking the column to the two valid values.

**Tech Stack:** Next.js 16.3.4 Route Handlers, `@supabase/supabase-js`, Vitest (backend); React +
Vite, Vitest + Testing Library (frontend, `D:\SimDuLich\Simdulich`).

## Global Constraints

- Toggle only — no `PATCH` with an explicit `{status}` body. The endpoint flips whatever the
  current value is; it never accepts a caller-supplied target status.
- Status vocabulary is exactly `'active'` / `'banned'` (matches the frontend's existing
  `StatusBadge`/`AdminDataContext` vocabulary — do not invent `disabled`/`inactive`).
- An admin/staff caller can never toggle their own account's status — always 400, checked before
  any database access.
- `requireRole(user, ['admin', 'staff'])` — same two-role gate as every other admin route in this
  project. Do not add a finer-grained "only admin can ban admin" rule — not asked for.
- Enforcement of `banned` happens in exactly two places: `lib/apiAuth.js`'s `authenticate()` and
  `app/api/identity/auth/login/route.js`. No other route file changes.
- Every error response is `{ message: "..." }` with an appropriate status code.
- Response shape for the toggle endpoint is the existing `mapUserResponse` shape:
  `{id, name, email, phone, role, status}` — do not invent a new shape.
- Vitest: chainable Supabase query-builder mocks, each test file defines its own local mock
  (backend convention already established in `lib/__tests__/*.test.js`).
- Next.js 16: Route Handler `params` is a `Promise` — always `await params`.
- Frontend change is scoped to exactly two files: `Simdulich/src/api/authApi.js` (new function) and
  `Simdulich/src/admin/pages/UsersPage.jsx` (wire the real call instead of the
  `AdminDataContext.toggleUserStatus` mock). No other frontend file changes.

---

### Task 1: Migration — allow admin to update another user's status

**Files:**
- Create: `supabase/migrations/0009_profiles_admin_status_update.sql`

**Interfaces:**
- Consumes: `public.is_admin_or_staff()` (already exists, from migration `0003`).
- Produces: the DB-level permission and RLS policy that Task 2's `toggleUserStatus` needs in order
  for `.update({status}).eq('id', targetId)` to actually take effect for an admin caller acting on
  someone else's row.

**Why this migration is needed (read before writing the SQL):** Migration `0003` intentionally
revoked table-level `UPDATE` on `profiles` from `authenticated` and re-granted it only for
`(name, phone, email)` — `status`/`role` have no `UPDATE` grant at all today, for anyone. It also
only ever added an RLS `UPDATE` policy for a user updating their *own* row (`auth.uid() = id`,
migration `0001`) — there is no RLS policy letting an admin update *another* user's row. Without
both of these, Task 2's update would either fail with a Postgres permission error (missing column
grant) or silently update 0 rows (no matching RLS policy) — this is the same class of "looks fine
until you check the real grants/policies" gotcha the Order/Payment API's final review caught with
`orders`/`order_items` INSERT-vs-SELECT. The existing `profiles_freeze_privileged_columns` trigger
(migration `0003`) is *already* written to expect an admin write path to exist — it only freezes
`role`/`status` back to their old values `if not public.is_admin_or_staff()`, i.e. it already lets
an admin's own write through. This migration just completes the grant + policy half that trigger
was always waiting for.

- [ ] **Step 1: Create `supabase/migrations/0009_profiles_admin_status_update.sql`**

```sql
-- migration 0003 revoked table-level UPDATE on profiles and re-granted only
-- (name, phone, email) to `authenticated` — status has no UPDATE grant at
-- all yet. Add it. The profiles_freeze_privileged_columns trigger (0003)
-- already freezes this column back to its old value for any non-admin
-- caller, so granting the column is safe: a non-admin attempting to set
-- their own status still gets silently reverted by that trigger.
grant update (status) on public.profiles to authenticated;

-- migration 0001/0003 only ever gave a row-level UPDATE policy for a user's
-- OWN row (`auth.uid() = id`). There is no policy letting an admin update
-- someone else's row. Add one, mirroring every other "Admins can manage X"
-- policy already in this project (e.g. 0007's "Admins can manage orders").
create policy "Admins can update any profile status"
  on public.profiles for update
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

-- Lock the column to the two values this feature ever writes. Safe today:
-- every row currently has status = 'active'.
alter table public.profiles
  add constraint profiles_status_check check (status in ('active', 'banned'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0009_profiles_admin_status_update.sql
git commit -m "feat: allow admin to update another user's profiles.status"
```

---

### Task 2: `lib/adminUsers.js` — toggle logic

**Files:**
- Create: `lib/adminUsers.js`
- Create: `lib/__tests__/adminUsers.test.js`

**Interfaces:**
- Consumes: `mapUserResponse` from `lib/apiAuth.js` (already exists, do not modify it in this
  task).
- Produces: `AdminUsersError` (class, has `.status`), `toggleUserStatus(supabase, {targetId,
  actingUserId})` (async — Task 3's route consumes this. Returns the updated user in
  `mapUserResponse` shape, or `null` if `targetId` doesn't exist, or throws `AdminUsersError` for
  the self-lock case (400) and for genuine DB errors (500)).

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/adminUsers.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

import { toggleUserStatus, AdminUsersError } from '../adminUsers';

describe('toggleUserStatus', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('ném AdminUsersError 400 khi tự khoá chính mình, không gọi DB', async () => {
    await expect(toggleUserStatus(supabaseMock, { targetId: 'u1', actingUserId: 'u1' }))
      .rejects.toMatchObject({ status: 400 });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('trả null khi không tìm thấy user', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    const result = await toggleUserStatus(supabaseMock, { targetId: 'u2', actingUserId: 'admin1' });

    expect(result).toBeNull();
  });

  it('ném AdminUsersError 500 khi tra user lỗi hạ tầng', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { message: 'boom' } }));

    await expect(toggleUserStatus(supabaseMock, { targetId: 'u2', actingUserId: 'admin1' }))
      .rejects.toMatchObject({ status: 500 });
  });

  it('lật active -> banned', async () => {
    const lookupQuery = createQueryBuilderMock({
      data: { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'active' },
      error: null,
    });
    const updateQuery = createQueryBuilderMock({
      data: { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'banned' },
      error: null,
    });
    let callCount = 0;
    fromMock.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? lookupQuery : updateQuery;
    });

    const result = await toggleUserStatus(supabaseMock, { targetId: 'u2', actingUserId: 'admin1' });

    expect(updateQuery.update).toHaveBeenCalledWith({ status: 'banned' });
    expect(result).toEqual({ id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'banned' });
  });

  it('lật banned -> active', async () => {
    const lookupQuery = createQueryBuilderMock({
      data: { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'banned' },
      error: null,
    });
    const updateQuery = createQueryBuilderMock({
      data: { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'active' },
      error: null,
    });
    let callCount = 0;
    fromMock.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? lookupQuery : updateQuery;
    });

    const result = await toggleUserStatus(supabaseMock, { targetId: 'u2', actingUserId: 'admin1' });

    expect(updateQuery.update).toHaveBeenCalledWith({ status: 'active' });
    expect(result.status).toBe('active');
  });

  it('ném AdminUsersError 500 khi update lỗi', async () => {
    const lookupQuery = createQueryBuilderMock({
      data: { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'active' },
      error: null,
    });
    const updateQuery = createQueryBuilderMock({ data: null, error: { message: 'boom' } });
    let callCount = 0;
    fromMock.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? lookupQuery : updateQuery;
    });

    await expect(toggleUserStatus(supabaseMock, { targetId: 'u2', actingUserId: 'admin1' }))
      .rejects.toMatchObject({ status: 500 });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- lib/__tests__/adminUsers.test.js`
Expected: FAIL with "Cannot find module '../adminUsers'".

- [ ] **Step 3: Create `lib/adminUsers.js`**

```js
import { mapUserResponse } from './apiAuth';

export class AdminUsersError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const PROFILE_COLUMNS = 'id, name, phone, email, role, status';

export async function toggleUserStatus(supabase, { targetId, actingUserId }) {
  if (targetId === actingUserId) {
    throw new AdminUsersError('Không thể tự khoá tài khoản của chính mình.', 400);
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', targetId)
    .maybeSingle();
  if (error) {
    console.error('[adminUsers] user lookup failed', error);
    throw new AdminUsersError('Không tải được người dùng.', 500);
  }
  if (!profile) {
    return null;
  }

  const nextStatus = profile.status === 'active' ? 'banned' : 'active';
  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({ status: nextStatus })
    .eq('id', targetId)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (updateError) {
    console.error('[adminUsers] status update failed', updateError);
    throw new AdminUsersError('Không cập nhật được trạng thái người dùng.', 500);
  }

  return mapUserResponse(updated);
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- lib/__tests__/adminUsers.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite, then commit**

Run: `npm test`
Expected: PASS.

```bash
git add lib/adminUsers.js lib/__tests__/adminUsers.test.js
git commit -m "feat: add toggleUserStatus for admin user-status management"
```

---

### Task 3: Route — `POST /api/identity/auth/users/{id}/status`

**Files:**
- Create: `app/api/identity/auth/users/[id]/status/route.js`
- Create: `app/api/identity/auth/users/[id]/status/__tests__/route.test.js`

**Interfaces:**
- Consumes: `authenticate`, `authErrorResponse`, `requireRole` from `lib/apiAuth.js`;
  `toggleUserStatus`, `AdminUsersError` from `lib/adminUsers.js` (Task 2).
- Produces: nothing new — this is the last piece consuming Task 2's interface.

- [ ] **Step 1: Write the failing test**

Create `app/api/identity/auth/users/[id]/status/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const toggleUserStatusMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminUsers', async () => {
  const actual = await vi.importActual('../../../../../../../lib/adminUsers');
  return { ...actual, toggleUserStatus: (...args) => toggleUserStatusMock(...args) };
});

import { POST } from '../route';

function makeRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}

describe('POST /api/identity/auth/users/[id]/status', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    toggleUserStatusMock.mockReset();
  });

  it('lật trạng thái thành công, trả 200 với user đã cập nhật', async () => {
    authenticateMock.mockResolvedValue({ user: { id: 'admin1', role: 'admin' }, supabase: {} });
    toggleUserStatusMock.mockResolvedValue({ id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'banned' });

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'u2' }) });
    const body = await response.json();

    expect(toggleUserStatusMock).toHaveBeenCalledWith({}, { targetId: 'u2', actingUserId: 'admin1' });
    expect(response.status).toBe(200);
    expect(body.status).toBe('banned');
  });

  it('trả 404 khi không tìm thấy user', async () => {
    authenticateMock.mockResolvedValue({ user: { id: 'admin1', role: 'admin' }, supabase: {} });
    toggleUserStatusMock.mockResolvedValue(null);

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'u2' }) });

    expect(response.status).toBe(404);
  });

  it('trả 400 khi tự khoá chính mình', async () => {
    authenticateMock.mockResolvedValue({ user: { id: 'admin1', role: 'admin' }, supabase: {} });
    const { AdminUsersError } = await vi.importActual('../../../../../../../lib/adminUsers');
    toggleUserStatusMock.mockRejectedValue(new AdminUsersError('Không thể tự khoá tài khoản của chính mình.', 400));

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'admin1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Không thể tự khoá tài khoản của chính mình.' });
  });

  it('trả 403 khi caller không phải admin/staff, không gọi toggleUserStatus', async () => {
    authenticateMock.mockResolvedValue({ user: { id: 'u3', role: 'customer' }, supabase: {} });

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'u2' }) });

    expect(response.status).toBe(403);
    expect(toggleUserStatusMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- "app/api/identity/auth/users/\[id\]/status"`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 3: Create `app/api/identity/auth/users/[id]/status/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../../lib/apiAuth';
import { toggleUserStatus, AdminUsersError } from '../../../../../../../lib/adminUsers';

export async function POST(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const updated = await toggleUserStatus(supabase, { targetId: id, actingUserId: user.id });
    if (!updated) {
      return NextResponse.json({ message: 'Không tìm thấy người dùng.' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AdminUsersError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- "app/api/identity/auth/users/\[id\]/status"`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite, then commit**

Run: `npm test`
Expected: PASS.

```bash
git add "app/api/identity/auth/users/[id]/status"
git commit -m "feat: add admin user-status toggle endpoint"
```

---

### Task 4: Enforce `banned` at `authenticate()` and `login`

**Files:**
- Modify: `lib/apiAuth.js`
- Modify: `lib/__tests__/apiAuth.test.js`
- Modify: `app/api/identity/auth/login/route.js`
- Modify: `app/api/identity/auth/login/__tests__/route.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — `authenticate()`'s existing signature/return shape is unchanged for
  non-banned callers; it now also throws `AuthError('Tài khoản đã bị khoá.', 403)` for banned ones.
  Every existing caller of `authenticate`/`optionalAuthenticate` (every order/payment/admin-catalog
  route from earlier phases) gets this enforcement automatically with no changes to those files.

- [ ] **Step 1: Write the failing test for `authenticate()`**

Add this test inside the existing `describe('authenticate', ...)` block in
`lib/__tests__/apiAuth.test.js` (add it after the last existing `it(...)` in that block, before the
closing `});` of the block):

```js
    it('ném AuthError 403 khi tài khoản bị khoá (status banned)', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@simdulich.vn' } }, error: null });
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: { id: 'u1', name: 'A', phone: '0900000000', email: 'a@simdulich.vn', role: 'customer', status: 'banned' },
        error: null,
      }));

      await expect(authenticate(makeRequest({ authorization: 'Bearer good-token' })))
        .rejects.toMatchObject({ status: 403 });
    });
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- lib/__tests__/apiAuth.test.js`
Expected: FAIL — the new test expects a 403 throw, but `authenticate()` doesn't check `status` yet
(it currently returns a resolved value instead of throwing).

- [ ] **Step 3: Modify `lib/apiAuth.js`'s `authenticate()`**

In `lib/apiAuth.js`, change this block (currently the last few lines of `authenticate` before its
`return`):

```js
  if (!profile) {
    throw new AuthError('Không tìm thấy hồ sơ người dùng.', 401);
  }

  return { user: mapUserResponse(profile), supabase };
```

to:

```js
  if (!profile) {
    throw new AuthError('Không tìm thấy hồ sơ người dùng.', 401);
  }

  if (profile.status === 'banned') {
    throw new AuthError('Tài khoản đã bị khoá.', 403);
  }

  return { user: mapUserResponse(profile), supabase };
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- lib/__tests__/apiAuth.test.js`
Expected: PASS (all tests in this file, including the new one).

- [ ] **Step 5: Write the failing test for `login`**

Add this test inside the existing `describe('POST /api/identity/auth/login', ...)` block in
`app/api/identity/auth/login/__tests__/route.test.js` (add after the last existing `it(...)`,
before the closing `});`):

```js
  it('trả 403 khi tài khoản bị khoá', async () => {
    signInMock.mockResolvedValue({
      data: {
        user: { id: 'u1' },
        session: { access_token: 'access-1', refresh_token: 'refresh-1' },
      },
      error: null,
    });
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: { id: 'u1', name: 'A', phone: '0900000000', email: 'a@simdulich.vn', role: 'customer', status: 'banned' },
      error: null,
    }));

    const response = await POST(makeRequest({ email: 'a@simdulich.vn', password: 'secret123' }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ message: 'Tài khoản của bạn đã bị khoá.' });
    expect(body.accessToken).toBeUndefined();
  });
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- app/api/identity/auth/login/__tests__/route.test.js`
Expected: FAIL — the new test expects 403, but `login` currently issues tokens regardless of
`status`.

- [ ] **Step 7: Modify `app/api/identity/auth/login/route.js`**

Change this block (currently right before the final `return NextResponse.json({accessToken...`):

```js
  if (!profile) {
    if (profileError) {
      console.error('[auth/login] profile lookup failed', profileError);
    }
    return NextResponse.json({ message: 'Không tìm thấy hồ sơ người dùng.' }, { status: 500 });
  }

  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: mapUserResponse(profile),
  });
```

to:

```js
  if (!profile) {
    if (profileError) {
      console.error('[auth/login] profile lookup failed', profileError);
    }
    return NextResponse.json({ message: 'Không tìm thấy hồ sơ người dùng.' }, { status: 500 });
  }

  if (profile.status === 'banned') {
    return NextResponse.json({ message: 'Tài khoản của bạn đã bị khoá.' }, { status: 403 });
  }

  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: mapUserResponse(profile),
  });
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- app/api/identity/auth/login/__tests__/route.test.js`
Expected: PASS (all tests in this file, including the new one).

- [ ] **Step 9: Run the full suite, then commit**

Run: `npm test`
Expected: PASS — this is the riskiest task in the plan (it modifies a function every other route
depends on), so a clean full-suite run here matters more than in any other task.

```bash
git add lib/apiAuth.js lib/__tests__/apiAuth.test.js app/api/identity/auth/login/route.js app/api/identity/auth/login/__tests__/route.test.js
git commit -m "feat: reject banned accounts at authenticate() and login"
```

---

### Task 5: Frontend — wire the real endpoint into `UsersPage.jsx`

**Files:**
- Modify: `Simdulich/src/api/authApi.js`
- Modify: `Simdulich/src/api/__tests__/authApi.test.js`
- Modify: `Simdulich/src/admin/pages/UsersPage.jsx`
- Modify: `Simdulich/src/admin/pages/__tests__/UsersPage.test.jsx`

**Interfaces:**
- Consumes: `POST /api/identity/auth/users/{id}/status` (Task 3) via the existing `apiFetch` helper
  in `Simdulich/src/api/httpClient.js` (already exists, do not modify it).
- Produces: `toggleUserStatusAdmin(token, userId)` exported from `authApi.js` — returns the updated
  user object (`{id, name, email, phone, role, status}`) or throws `ApiError` (from `httpClient.js`,
  already exists) on a non-2xx response.

Work from: `D:\SimDuLich\Simdulich` for every step in this task — this is the frontend repo, a
separate `npm test` (Vitest) from `simDulichNew`'s.

- [ ] **Step 1: Write the failing test for `toggleUserStatusAdmin`**

Add this test file `Simdulich/src/api/__tests__/authApi.test.js` — add a new `describe` block after
the existing `describe('listUsersAdmin', ...)` block, and update the top import line to also import
`toggleUserStatusAdmin`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listUsersAdmin, toggleUserStatusAdmin } from '../authApi';
```

```js
describe('toggleUserStatusAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gọi đúng endpoint POST kèm token, trả về user đã cập nhật', async () => {
    const mockResponse = {
      ok: true,
      text: async () => JSON.stringify({ id: 1, name: 'A', email: 'a@test.vn', phone: '0900000000', role: 'customer', status: 'banned' }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await toggleUserStatusAdmin('tok', 1);

    expect(result).toEqual({ id: 1, name: 'A', email: 'a@test.vn', phone: '0900000000', role: 'customer', status: 'banned' });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/identity/auth/users/1/status');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer tok');
  });

  it('ném ApiError với message từ server khi thất bại (ví dụ tự khoá chính mình)', async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: 'Không thể tự khoá tài khoản của chính mình.' }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    await expect(toggleUserStatusAdmin('tok', 1)).rejects.toMatchObject({
      message: 'Không thể tự khoá tài khoản của chính mình.',
      status: 400,
    });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- src/api/__tests__/authApi.test.js`
Expected: FAIL — `toggleUserStatusAdmin` is not exported yet.

- [ ] **Step 3: Add `toggleUserStatusAdmin` to `Simdulich/src/api/authApi.js`**

Add this export at the end of the file (keep every existing export unchanged):

```js
export function toggleUserStatusAdmin(token, userId) {
  return apiFetch(`/identity/auth/users/${userId}/status`, {
    method: 'POST',
    token,
  });
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- src/api/__tests__/authApi.test.js`
Expected: PASS (2 tests in the new `describe` block, plus the existing `listUsersAdmin` test still
passing).

- [ ] **Step 5: Write the failing test for the `UsersPage.jsx` wiring**

Add these two tests to `Simdulich/src/admin/pages/__tests__/UsersPage.test.jsx`, inside the existing
`describe('UsersPage', ...)` block, after the last existing `it(...)`:

```js
  it('bấm Khóa gọi API thật và cập nhật trạng thái hiển thị thành Mở khóa', async () => {
    authApi.toggleUserStatusAdmin.mockResolvedValue({ ...USER, status: 'banned' });
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('user-row').length).toBe(1));

    await userEvent.click(screen.getByLabelText('Khóa'));

    expect(authApi.toggleUserStatusAdmin).toHaveBeenCalledWith('tok', 1);
    await waitFor(() => expect(screen.getByLabelText('Mở khóa')).toBeInTheDocument());
  });

  it('hiển thị lỗi khi API trả lỗi (ví dụ tự khoá chính mình)', async () => {
    authApi.toggleUserStatusAdmin.mockRejectedValue(new Error('Không thể tự khoá tài khoản của chính mình.'));
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('user-row').length).toBe(1));

    await userEvent.click(screen.getByLabelText('Khóa'));

    await waitFor(() => expect(screen.getByText('Không thể tự khoá tài khoản của chính mình.')).toBeInTheDocument());
  });
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- src/admin/pages/__tests__/UsersPage.test.jsx`
Expected: FAIL — clicking "Khóa" currently calls the mock `AdminDataContext.toggleUserStatus`, so
`authApi.toggleUserStatusAdmin` is never called and the assertions fail.

- [ ] **Step 7: Rewrite `Simdulich/src/admin/pages/UsersPage.jsx`**

Replace the file's full contents with:

```jsx
import { useAuth } from '../../context/AuthContext';
import { listUsersAdmin, toggleUserStatusAdmin } from '../../api/authApi';
import { useServerPage } from '../hooks/useServerPage';
import { useState } from 'react';
import StatusBadge from '../components/StatusBadge';
import { Lock, Unlock, Eye, X } from 'lucide-react';
import Pagination from '../components/Pagination';

const ROLE_LABEL = { admin: 'Admin', staff: 'Nhân viên', customer: 'Khách hàng' };
const ROLE_CLS = { admin: 'bg-brand-light text-brand', staff: 'bg-sky-50 text-sky-600', customer: 'bg-slate-100 text-slate-600' };

export default function UsersPage() {
  const { accessToken } = useAuth();
  const [detail, setDetail] = useState(null);
  const [statusOverrides, setStatusOverrides] = useState({});
  const [actionError, setActionError] = useState('');
  const { page, setPage, totalPages, total, pageItems, pageSize, loading, error } =
    useServerPage(listUsersAdmin, accessToken, 10);

  const rows = pageItems.map(u => (statusOverrides[u.id] ? { ...u, status: statusOverrides[u.id] } : u));

  async function handleToggleStatus(u) {
    setActionError('');
    try {
      const updated = await toggleUserStatusAdmin(accessToken, u.id);
      setStatusOverrides(prev => ({ ...prev, [u.id]: updated.status }));
    } catch (err) {
      setActionError(err.message || 'Không thể đổi trạng thái, vui lòng thử lại.');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Quản lý Người dùng</h1>
      <p className="text-slate-500 text-sm mb-6">Tài khoản khách hàng, nhân viên và quản trị viên</p>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>
      )}
      {actionError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-3 mb-4">{actionError}</div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="text-left font-bold px-4 py-3">Người dùng</th>
              <th className="text-left font-bold px-4 py-3">SĐT</th>
              <th className="text-left font-bold px-4 py-3">Vai trò</th>
              <th className="text-left font-bold px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Đang tải...</td></tr>
            )}
            {!loading && rows.map(u => (
              <tr key={u.id} data-testid="user-row" className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-brand-light text-brand flex items-center justify-center font-bold text-xs">{u.name.charAt(0)}</span>
                    <div>
                      <div className="font-semibold text-slate-700">{u.name}</div>
                      <div className="text-xs text-slate-400">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{u.phone || '—'}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${ROLE_CLS[u.role]}`}>{ROLE_LABEL[u.role]}</span></td>
                <td className="px-4 py-3"><StatusBadge value={u.status} /></td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => setDetail(u)} aria-label="Chi tiết" className="p-2 text-slate-400 hover:text-brand"><Eye className="h-4 w-4" /></button>
                  <button
                    onClick={() => handleToggleStatus(u)}
                    aria-label={u.status === 'active' ? 'Khóa' : 'Mở khóa'}
                    className="p-2 text-slate-400 hover:text-rose-600"
                  >
                    {u.status === 'active' ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={setPage} />
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={() => setDetail(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md bg-white h-full overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg text-slate-900">Chi tiết người dùng</h2>
              <button onClick={() => setDetail(null)} aria-label="Đóng" className="p-1 text-slate-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-1 text-sm">
              <div><span className="text-slate-400 text-xs block">Họ tên</span>{detail.name}</div>
              <div><span className="text-slate-400 text-xs block">Email</span>{detail.email}</div>
              <div><span className="text-slate-400 text-xs block">SĐT</span>{detail.phone || '—'}</div>
              <div><span className="text-slate-400 text-xs block">Vai trò</span>{ROLE_LABEL[detail.role]}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

The only functional changes from the current file: `useAdminData`/`toggleUserStatus` (the mock) are
no longer imported or used; two new pieces of local state (`statusOverrides`, `actionError`); a new
`handleToggleStatus` function that calls the real API and applies the returned status as a local
override (since `pageItems` comes from `useServerPage`, which has no refetch/mutate escape hatch —
overriding locally by id is the minimal-diff way to reflect the change without touching that shared
hook); the toggle button's `onClick` now calls `handleToggleStatus(u)` instead of
`toggleUserStatus(u.id)`; an `actionError` banner rendered next to the existing `error` banner.

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- src/admin/pages/__tests__/UsersPage.test.jsx`
Expected: PASS (all 4 tests: the 2 pre-existing plus the 2 new ones).

- [ ] **Step 9: Run the full frontend suite, then commit**

Run: `npm test`
Expected: PASS — this touches a shared admin page, so confirm nothing else in the frontend suite
regressed.

```bash
git add src/api/authApi.js src/api/__tests__/authApi.test.js src/admin/pages/UsersPage.jsx src/admin/pages/__tests__/UsersPage.test.jsx
git commit -m "feat: wire admin user-status toggle to the real backend endpoint"
```

---

### Task 6: Manual verification against the real Supabase project + real frontend

**Files:** none (verification only).

**Interfaces:**
- Consumes: the running `simDulichNew` dev server and `Simdulich`'s admin Users page.
- Produces: nothing.

- [ ] **Step 1: Apply the new migration**

In the Supabase Dashboard SQL Editor, run `supabase/migrations/0009_profiles_admin_status_update.sql`.

- [ ] **Step 2: Start both dev servers**

`simDulichNew`: `npm run dev`. `Simdulich`: `npm run dev`.

- [ ] **Step 3: Verify the toggle endpoint directly**

Log in as an admin (`POST /api/identity/auth/login`), then call
`POST /api/identity/auth/users/{some-other-user-id}/status` with that admin's token. Confirm the
response is 200 with `status` flipped. Call it again — confirm it flips back.

- [ ] **Step 4: Verify the self-lock guard**

Call `POST /api/identity/auth/users/{the-admin's-own-id}/status` with that same admin's own token.
Confirm 400 `{message: "Không thể tự khoá tài khoản của chính mình."}`, and confirm (via Step 3's
target user) that no OTHER user's status changed.

- [ ] **Step 5: Verify banned enforcement**

Toggle a real test user (not the admin) to `banned`. Attempt to log in as that user — confirm 403.
If that user already had a valid access token from before being banned, call any authenticated
endpoint (e.g. `GET /api/identity/auth/me`) with that old token — confirm it now also returns 403,
not the previously-valid response. Toggle them back to `active` — confirm login works again.

- [ ] **Step 6: Verify the admin UI**

In the running `Simdulich` frontend, log in as admin, go to the Users page, click the "Khóa" icon
on a non-admin row — confirm the icon flips to "Mở khóa" and no page reload was needed. Click it
again — confirm it flips back. Attempt to click it on the admin's own row (if visible in the list)
— confirm the error banner shows the self-lock message.

- [ ] **Step 7: Report results**

Summarize pass/fail for each step back to the user. Fix any failing step by reading the relevant
route/lib/component file and re-running its automated test before re-verifying manually.

---

## Self-Review

**Spec coverage:**
- Toggle-only endpoint, no explicit-set — Task 3. ✓
- Status vocabulary `active`/`banned` — Tasks 1-5, consistent throughout. ✓
- Self-lock guard (400, before DB access) — Task 2. ✓
- `requireRole(['admin','staff'])`, no finer-grained rule — Task 3. ✓
- Banned enforcement at exactly `authenticate()` + `login`, no other route touched — Task 4. ✓
- `{message}` error shape everywhere — Tasks 3, 4. ✓
- `mapUserResponse` response shape reused, not reinvented — Tasks 2, 3. ✓
- Frontend change scoped to exactly `authApi.js` + `UsersPage.jsx` — Task 5. ✓
- Manual verification — Task 6. ✓

**Placeholder scan:** No TBD/TODO markers; every step has runnable code or an exact command with
expected output.

**Type consistency:** `lib/adminUsers.js`'s `toggleUserStatus(supabase, {targetId,
actingUserId})` (Task 2) is consumed identically by Task 3's route (`{targetId: id, actingUserId:
user.id}`). `AdminUsersError` (Task 2) is imported and matched via `instanceof` identically in Task
3's route. `mapUserResponse`'s existing `{id, name, email, phone, role, status}` shape (unchanged,
from `lib/apiAuth.js`) flows unmodified through Task 2's return value, Task 3's response body, and
Task 5's `toggleUserStatusAdmin` return value and `UsersPage.jsx`'s `statusOverrides` usage — no
task reshapes it.

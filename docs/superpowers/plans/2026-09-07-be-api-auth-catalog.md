# BE API (Auth + Catalog công khai) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `simDulichNew` into an API-only Next.js backend that replicates the old Java backend's REST contract exactly, so the existing Vite frontend (`Simdulich`) works unchanged except for `VITE_API_BASE_URL`.

**Architecture:** Next.js 16 Route Handlers under `app/api/...`, one per old endpoint path (including the `catalog/catalog/...` double-segment quirk). Auth is 100% Supabase Auth (`supabase.auth.*`) plus the existing `profiles` table. Public catalog reads go through `lib/catalog.js` (query layer over `products_public`/`categories`/`category_countries`, already schema'd and seeded with real data). CORS is handled entirely in `proxy.js` since the allowed-origins list has two specific values that `next.config.mjs`'s static `headers()` cannot conditionally reflect.

**Tech Stack:** Next.js 16.3.4 (App Router, Route Handlers), `@supabase/supabase-js` (stateless client, no `@supabase/ssr`), Vitest + `vi.mock`.

## Global Constraints

- Route paths must match the old Java BE exactly — see the endpoint list in `docs/superpowers/specs/2026-09-07-be-api-auth-catalog-design.md`. The frontend must work by only changing `VITE_API_BASE_URL`; never change a path or field name to "clean it up."
- Every error response is minimally `{ message: "..." }` with the right status code (400/401/403/404/500) — this is the only field `Simdulich/src/api/httpClient.js`'s `apiFetch()` reads from an error body.
- `GET /api/identity/auth/users` returns its page number in a field called **`number`** (Spring `Page` convention — `Simdulich/src/api/authApi.js`'s `listUsersAdmin()` reads `data.number`). `GET /api/catalog/catalog/products/search` returns its page number in a field called **`page`** (custom `PagedResponse` convention). Do not swap these.
- CORS allowed origins are exactly `https://simdulich.vn` and `http://localhost:5173` — no wildcard, no other origins.
- Any Supabase query against an RLS-protected table that depends on *who* the caller is (e.g. `profiles`) must run through a client scoped with that caller's access token (`createApiClient(token)` — see Task 2), never the bare anon client. The bare anon client has no `auth.uid()`, so RLS policies keyed on it silently return zero rows instead of erroring.
- Next.js 16: Route Handler `params` is a `Promise` — always `await params`. There is no injected `searchParams` argument for Route Handlers; read query strings via `new URL(request.url).searchParams`. `middleware.js` is deprecated in favor of `proxy.js` (exported function must be named `proxy`, config export unchanged).
- Vitest: mock the Supabase client with the chainable query-builder pattern already used in this repo's plan drafts (`select/eq/in/order/range/... → then(resolve)`); each test file defines its own local builder mock, don't add a shared test-only module for it.
- Never commit real values into `.env.local`; only `.env.example` documents variable names.
- `.jsx` extension is required for any file containing JSX that a Vitest test imports directly — not applicable to this plan (no JSX files are created), but do not reintroduce that mistake if a task is later modified.

---

### Task 1: Cleanup — remove Phase 1/2 UI, minimal layout, CORS via `proxy.js`

**Files:**
- Delete: `app/(auth)/` (entire directory: `authUI.js`, `login/page.jsx`, `login/__tests__/page.test.jsx`, `register/page.jsx`, `register/__tests__/page.test.jsx`)
- Delete: `app/account/page.js`
- Delete: `components/Header.jsx`, `components/__tests__/Header.test.jsx`
- Delete: `components/Footer.jsx`
- Delete: `context/AuthProvider.jsx`, `context/__tests__/AuthProvider.test.jsx`
- Delete: `lib/supabase/client.js`, `lib/supabase/__tests__/client.test.js`
- Delete: `lib/supabase/server.js`
- Delete: `lib/supabase/middleware.js`
- Delete: `__tests__/proxy.test.js` (replaced by a new one below)
- Modify: `app/layout.js`
- Modify: `app/page.js`
- Modify: `proxy.js`
- Create: `__tests__/proxy.test.js`

**Interfaces:**
- Consumes: nothing (pure cleanup + a self-contained CORS proxy).
- Produces: a `proxy` function with `config.matcher` scoped to `/api/:path*` — later tasks' route handlers rely on this to receive CORS headers; they do not set CORS headers themselves.

- [ ] **Step 1: Delete the Phase 1/2 UI files**

```bash
git rm -r "app/(auth)" app/account/page.js components/Header.jsx components/__tests__/Header.test.jsx components/Footer.jsx context/AuthProvider.jsx context/__tests__/AuthProvider.test.jsx lib/supabase/client.js lib/supabase/__tests__/client.test.js lib/supabase/server.js lib/supabase/middleware.js __tests__/proxy.test.js
```

- [ ] **Step 2: Replace `app/layout.js` with a plain layout (no Header/Footer/AuthProvider)**

```js
import './globals.css';

export const metadata = {
  title: 'SIMDULICH.VN API',
  description: 'Backend API cho SIMDULICH.VN',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Replace `app/page.js` with a minimal status page**

```js
export default function HomePage() {
  return (
    <div style={{ fontFamily: 'sans-serif', padding: 32 }}>
      <h1>SIMDULICH.VN API</h1>
      <p>Backend đang chạy. Đây không phải trang giao diện người dùng.</p>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `proxy.js` to only handle CORS for `/api/*`**

```js
import { NextResponse } from 'next/server';

const ALLOWED_ORIGINS = ['https://simdulich.vn', 'http://localhost:5173'];

function buildCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function proxy(request) {
  const origin = request.headers.get('origin');
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: isAllowed ? buildCorsHeaders(origin) : {},
    });
  }

  const response = NextResponse.next();
  if (isAllowed) {
    const headers = buildCorsHeaders(origin);
    Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
```

- [ ] **Step 5: Write the new `__tests__/proxy.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

describe('proxy (CORS)', () => {
  it('phản hồi preflight OPTIONS với header CORS khi origin được phép', () => {
    const request = new NextRequest('http://localhost:3000/api/identity/auth/login', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173' },
    });

    const response = proxy(request);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('phản hồi preflight OPTIONS không có header CORS khi origin không được phép', () => {
    const request = new NextRequest('http://localhost:3000/api/identity/auth/login', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });

    const response = proxy(request);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('gắn header CORS vào request GET thường khi origin production được phép', () => {
    const request = new NextRequest('http://localhost:3000/api/catalog/catalog/categories', {
      method: 'GET',
      headers: { origin: 'https://simdulich.vn' },
    });

    const response = proxy(request);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://simdulich.vn');
  });

  it('không gắn header CORS khi không có origin (vd gọi trực tiếp server-to-server)', () => {
    const request = new NextRequest('http://localhost:3000/api/catalog/catalog/categories', {
      method: 'GET',
    });

    const response = proxy(request);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
```

- [ ] **Step 6: Run tests, confirm the suite passes with the old UI tests gone**

Run: `npm test`
Expected: PASS — only `__tests__/proxy.test.js` remains from the old test set (the deleted files' tests are gone with them).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: strip Next.js UI layer, keep proxy.js as CORS-only gate for /api"
```

---

### Task 2: Stateless Supabase client + shared auth helper + profile schema fixes

**Files:**
- Create: `lib/supabase/apiClient.js`
- Create: `lib/supabase/__tests__/apiClient.test.js`
- Create: `lib/apiAuth.js`
- Create: `lib/__tests__/apiAuth.test.js`
- Create: `supabase/migrations/0003_profiles_admin_and_email.sql`

**Interfaces:**
- Consumes: `profiles` table from `supabase/migrations/0001_profiles.sql` (columns `id, name, phone, role, status` — this task adds `email`).
- Produces: `createApiClient(accessToken?)` (sync, returns a `@supabase/supabase-js` client or `null` if env vars are missing; when `accessToken` is passed, every request from that client carries `Authorization: Bearer <accessToken>` so RLS's `auth.uid()` resolves to that user) — Tasks 3, 4, 5 all import this instead of the deleted `lib/supabase/server.js`. `authenticate(request)` (async, returns `{ user, supabase }` or throws `AuthError`), `requireRole(user, roles)` (throws `AuthError` on mismatch), `authErrorResponse(error)` (returns a `NextResponse` for any thrown error), `mapUserResponse(profile)` (maps a `profiles` row to the `UserResponse` shape `{id, name, email, phone, role, status}`) — Task 4's Auth API routes import all four.

- [ ] **Step 1: Write the migration for the profile schema fixes**

The old Java BE's `UserResponse` includes `email`, but `profiles` doesn't store it (only `auth.users` does) — and a plain anon-key client can't join `auth.users`. Denormalize `email` onto `profiles` via the existing signup trigger instead of introducing a service-role key. Separately, `GET /api/identity/auth/users` needs an admin/staff caller to see every profile, but the existing RLS policy only allows a user to see their own row — add a second policy for admin/staff.

Create `supabase/migrations/0003_profiles_admin_and_email.sql`:

```sql
alter table public.profiles add column email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'phone',
    new.email
  );
  return new;
end;
$$;

create policy "Admins can view all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'staff')
    )
  );
```

This is additive (new column, replaced function body, new policy) — it does not touch the already-applied `0001_profiles.sql`/`0002_catalog.sql` files.

- [ ] **Step 2: Write the failing test for `lib/supabase/apiClient.js`**

Create `lib/supabase/__tests__/apiClient.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiClient } from '../apiClient';

describe('createApiClient', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it('trả về null khi thiếu biến môi trường Supabase', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(createApiClient()).toBeNull();
  });

  it('tạo client không kèm header Authorization khi không truyền token', () => {
    const client = createApiClient();
    expect(client).not.toBeNull();
    expect(client.auth.autoRefreshToken).toBe(false);
  });

  it('tạo client kèm header Authorization Bearer khi truyền token', () => {
    const client = createApiClient('user-access-token');
    expect(client.rest.headers.Authorization).toBe('Bearer user-access-token');
  });
});
```

- [ ] **Step 3: Run test, confirm it fails**

Run: `npm test -- apiClient.test.js`
Expected: FAIL with "Cannot find module '../apiClient'".

- [ ] **Step 4: Create `lib/supabase/apiClient.js`**

```js
import { createClient } from '@supabase/supabase-js';

export function createApiClient(accessToken) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `npm test -- apiClient.test.js`
Expected: PASS (3 tests). Note: `client.rest.headers.Authorization` reflects `@supabase/supabase-js`'s internal PostgREST client config — if this specific property path doesn't exist in the installed version, inspect `client.auth.headers` or `client.supabaseUrl`/`client.supabaseKey` alongside a `console.log(client)` in a scratch script to find the right assertion, then update the test to check whatever field actually carries the header. The behavior under test (the header is set) matters more than the exact property path.

- [ ] **Step 6: Write the failing test for `lib/apiAuth.js`**

Create `lib/__tests__/apiAuth.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    single: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const getUserMock = vi.fn();
const supabaseMock = { from: fromMock, auth: { getUser: getUserMock } };
const createApiClientMock = vi.fn(() => supabaseMock);

vi.mock('../supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));

import { authenticate, requireRole, authErrorResponse, mapUserResponse, AuthError } from '../apiAuth';

function makeRequest(headers = {}) {
  return { headers: { get: (key) => headers[key.toLowerCase()] ?? null } };
}

describe('lib/apiAuth', () => {
  beforeEach(() => {
    fromMock.mockReset();
    getUserMock.mockReset();
    createApiClientMock.mockClear();
  });

  describe('authenticate', () => {
    it('ném AuthError 401 khi thiếu header Authorization', async () => {
      await expect(authenticate(makeRequest())).rejects.toMatchObject({ status: 401 });
    });

    it('ném AuthError 401 khi token không hợp lệ', async () => {
      getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });

      await expect(authenticate(makeRequest({ authorization: 'Bearer bad-token' })))
        .rejects.toMatchObject({ status: 401 });
    });

    it('trả về user + supabase client được gán token khi xác thực thành công', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@simdulich.vn' } }, error: null });
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: { id: 'u1', name: 'A', phone: '0900000000', email: 'a@simdulich.vn', role: 'customer', status: 'active' },
        error: null,
      }));

      const result = await authenticate(makeRequest({ authorization: 'Bearer good-token' }));

      expect(createApiClientMock).toHaveBeenCalledWith('good-token');
      expect(result.user).toEqual({
        id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active',
      });
      expect(result.supabase).toBe(supabaseMock);
    });
  });

  describe('requireRole', () => {
    it('không ném lỗi khi role khớp', () => {
      expect(() => requireRole({ role: 'admin' }, ['admin', 'staff'])).not.toThrow();
    });

    it('ném AuthError 403 khi role không khớp', () => {
      expect(() => requireRole({ role: 'customer' }, ['admin', 'staff'])).toThrow(AuthError);
    });
  });

  describe('authErrorResponse', () => {
    it('trả NextResponse với status và message từ AuthError', async () => {
      const response = authErrorResponse(new AuthError('Không đủ quyền truy cập.', 403));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
    });

    it('trả 500 với message mặc định khi không phải AuthError', async () => {
      const response = authErrorResponse(new Error('boom'));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.message).toBe('Có lỗi xảy ra, vui lòng thử lại.');
    });
  });

  describe('mapUserResponse', () => {
    it('map đúng field từ profiles row sang UserResponse', () => {
      const result = mapUserResponse({
        id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active', created_at: 'x',
      });

      expect(result).toEqual({
        id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active',
      });
    });
  });
});
```

- [ ] **Step 7: Run test, confirm it fails**

Run: `npm test -- apiAuth.test.js`
Expected: FAIL with "Cannot find module '../apiAuth'".

- [ ] **Step 8: Create `lib/apiAuth.js`**

```js
import { NextResponse } from 'next/server';
import { createApiClient } from './supabase/apiClient';

export class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function mapUserResponse(profile) {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    role: profile.role,
    status: profile.status,
  };
}

export function authErrorResponse(error) {
  if (error instanceof AuthError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  return NextResponse.json({ message: 'Có lỗi xảy ra, vui lòng thử lại.' }, { status: 500 });
}

export async function authenticate(request) {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) {
    throw new AuthError('Thiếu token xác thực.', 401);
  }
  const token = match[1];

  const supabase = createApiClient(token);
  if (!supabase) {
    throw new AuthError('Máy chủ chưa cấu hình Supabase.', 500);
  }

  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) {
    throw new AuthError('Token không hợp lệ hoặc đã hết hạn.', 401);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, phone, email, role, status')
    .eq('id', userData.user.id)
    .single();

  if (!profile) {
    throw new AuthError('Không tìm thấy hồ sơ người dùng.', 401);
  }

  return { user: mapUserResponse(profile), supabase };
}

export function requireRole(user, roles) {
  if (!roles.includes(user.role)) {
    throw new AuthError('Không đủ quyền truy cập.', 403);
  }
}
```

- [ ] **Step 9: Run test, confirm it passes**

Run: `npm test -- apiAuth.test.js`
Expected: PASS (7 tests).

- [ ] **Step 10: Commit**

```bash
git add lib/supabase/apiClient.js lib/supabase/__tests__/apiClient.test.js lib/apiAuth.js lib/__tests__/apiAuth.test.js supabase/migrations/0003_profiles_admin_and_email.sql
git commit -m "feat: add stateless Supabase client + shared Bearer-token auth helper"
```

---

### Task 3: `lib/catalog.js` — query layer for the public Catalog API

**Files:**
- Create: `lib/catalog.js`
- Create: `lib/__tests__/catalog.test.js`

**Interfaces:**
- Consumes: `createApiClient()` from `lib/supabase/apiClient.js` (Task 2). `products_public` view and `categories`/`category_countries` tables from `supabase/migrations/0002_catalog.sql`.
- Produces: `listCategories()`, `listProductsByCountry(countryCode)`, `listProductsByCategory(categorySlug)`, `listAllProducts()`, `getProductBySlug(slug)`, `getProductById(id)`, `getMinPriceByCountry()`, `searchProducts({simType, search, countryCodes, types, durations, capacities, maxPrice, sortBy, page, size})` — Task 5's Catalog API routes call these directly. All return plain arrays/objects (never throw); `getProductBySlug`/`getProductById` return `null` when not found.

- [ ] **Step 1: Write the failing test for `lib/catalog.js`**

Create `lib/__tests__/catalog.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const rpcMock = vi.fn();
const supabaseMock = { from: fromMock, rpc: rpcMock };

vi.mock('../supabase/apiClient', () => ({
  createApiClient: vi.fn(() => supabaseMock),
}));

import {
  listCategories,
  listProductsByCountry,
  listProductsByCategory,
  listAllProducts,
  getProductBySlug,
  getProductById,
  getMinPriceByCountry,
  searchProducts,
} from '../catalog';

const sampleProductRow = {
  id: 10, category_id: 1, title: 'eSIM Nhật Bản', slug: 'esim-nb', sim_type: 'esim',
  price_buy: 89000, data_info: '1GB/ngày', duration_days: 3, package_type: 'daily',
  capacity_bucket: '1gb', status: 'active',
};
const sampleProductMapped = {
  id: 10, categoryId: 1, title: 'eSIM Nhật Bản', slug: 'esim-nb', simType: 'esim',
  priceBuy: 89000, dataInfo: '1GB/ngày', durationDays: 3, packageType: 'daily',
  capacityBucket: '1gb', status: 'active',
};

describe('lib/catalog', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  describe('listCategories', () => {
    it('map dữ liệu category_countries lồng nhau thành coveredCountries', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: [
          { id: 1, name: 'Nhật Bản', slug: 'nhat-ban', image_url: null, status: 'active', category_countries: [{ country_code: 'jp' }] },
        ],
        error: null,
      }));

      const result = await listCategories();

      expect(fromMock).toHaveBeenCalledWith('categories');
      expect(result).toEqual([
        { id: 1, name: 'Nhật Bản', slug: 'nhat-ban', imageUrl: null, status: 'active', coveredCountries: ['jp'] },
      ]);
    });
  });

  describe('listProductsByCountry', () => {
    it('tra category_countries trước, rồi lọc products_public theo category_id', async () => {
      const countryQuery = createQueryBuilderMock({ data: [{ category_id: 1 }, { category_id: 2 }], error: null });
      const productsQuery = createQueryBuilderMock({ data: [sampleProductRow], error: null });
      fromMock.mockImplementation((table) => (table === 'category_countries' ? countryQuery : productsQuery));

      const result = await listProductsByCountry('jp');

      expect(countryQuery.in).toHaveBeenCalledWith('country_code', ['jp']);
      expect(productsQuery.in).toHaveBeenCalledWith('category_id', [1, 2]);
      expect(result).toEqual([sampleProductMapped]);
    });

    it('trả mảng rỗng nếu không quốc gia nào khớp category nào', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

      const result = await listProductsByCountry('zz');

      expect(result).toEqual([]);
    });
  });

  describe('listProductsByCategory', () => {
    it('tra category theo slug trước, rồi lọc products_public theo category_id', async () => {
      const categoryQuery = createQueryBuilderMock({ data: [{ id: 5 }], error: null });
      const productsQuery = createQueryBuilderMock({ data: [], error: null });
      fromMock.mockImplementation((table) => (table === 'categories' ? categoryQuery : productsQuery));

      await listProductsByCategory('singapore');

      expect(categoryQuery.eq).toHaveBeenCalledWith('slug', 'singapore');
      expect(productsQuery.eq).toHaveBeenCalledWith('category_id', 5);
    });

    it('trả mảng rỗng nếu không tìm thấy category theo slug', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

      const result = await listProductsByCategory('khong-ton-tai');

      expect(result).toEqual([]);
    });
  });

  describe('listAllProducts', () => {
    it('trả toàn bộ sản phẩm active, không lọc theo category', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [sampleProductRow], error: null }));

      const result = await listAllProducts();

      expect(fromMock).toHaveBeenCalledWith('products_public');
      expect(result).toEqual([sampleProductMapped]);
    });
  });

  describe('getProductBySlug', () => {
    it('trả sản phẩm khi tìm thấy slug', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: sampleProductRow, error: null }));

      const result = await getProductBySlug('esim-nb');

      expect(result).toEqual(sampleProductMapped);
    });

    it('trả null khi không tìm thấy slug', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await getProductBySlug('khong-ton-tai');

      expect(result).toBeNull();
    });
  });

  describe('getProductById', () => {
    it('trả sản phẩm khi tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: sampleProductRow, error: null }));

      const result = await getProductById(10);

      expect(result).toEqual(sampleProductMapped);
    });

    it('trả null khi không tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await getProductById(999);

      expect(result).toBeNull();
    });
  });

  describe('searchProducts', () => {
    it('áp bộ lọc mặc định: sim_type=esim, giá tối đa 1.000.000, phân trang 12/trang từ trang 1', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await searchProducts({});

      expect(query.eq).toHaveBeenCalledWith('sim_type', 'esim');
      expect(query.lte).toHaveBeenCalledWith('price_buy', 1000000);
      expect(query.range).toHaveBeenCalledWith(0, 11);
      expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
    });

    it('sortBy=price-asc sắp xếp tăng dần theo giá', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await searchProducts({ sortBy: 'price-asc' });

      expect(query.order).toHaveBeenCalledWith('price_buy', { ascending: true });
    });

    it('sortBy=price-desc sắp xếp giảm dần theo giá', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await searchProducts({ sortBy: 'price-desc' });

      expect(query.order).toHaveBeenCalledWith('price_buy', { ascending: false });
    });

    it('lọc types/capacities bằng .in() đúng cột', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await searchProducts({ types: ['daily', 'unlimited'], capacities: ['1gb'] });

      expect(query.in).toHaveBeenCalledWith('package_type', ['daily', 'unlimited']);
      expect(query.in).toHaveBeenCalledWith('capacity_bucket', ['1gb']);
    });

    it('tính totalPages từ totalElements và size', async () => {
      const query = createQueryBuilderMock({ data: [], count: 25, error: null });
      fromMock.mockReturnValue(query);

      const result = await searchProducts({ size: 12 });

      expect(result.totalElements).toBe(25);
      expect(result.totalPages).toBe(3);
    });

    it('countryCodes không khớp category nào trả về ngay kết quả rỗng, không query products', async () => {
      const countryQuery = createQueryBuilderMock({ data: [], error: null });
      fromMock.mockReturnValue(countryQuery);

      const result = await searchProducts({ countryCodes: ['zz'] });

      expect(result).toEqual({ content: [], page: 1, size: 12, totalElements: 0, totalPages: 0 });
    });
  });

  describe('getMinPriceByCountry', () => {
    it('gọi RPC min_price_by_country và map thành object { [code]: giá }', async () => {
      rpcMock.mockResolvedValue({ data: [{ country_code: 'jp', min_price: 89000 }, { country_code: 'kr', min_price: 129000 }], error: null });

      const result = await getMinPriceByCountry();

      expect(rpcMock).toHaveBeenCalledWith('min_price_by_country');
      expect(result).toEqual({ jp: 89000, kr: 129000 });
    });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- catalog.test.js`
Expected: FAIL with "Cannot find module '../catalog'".

- [ ] **Step 3: Create `lib/catalog.js`**

```js
import { createApiClient } from './supabase/apiClient';

const DURATION_BRACKETS = {
  '1-5': [1, 5],
  '6-10': [6, 10],
  '11-15': [11, 15],
  '16-30': [16, 30],
  '31+': [31, null],
};

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    imageUrl: row.image_url,
    status: row.status,
    coveredCountries: (row.category_countries || []).map((c) => c.country_code),
  };
}

function mapProduct(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    slug: row.slug,
    simType: row.sim_type,
    priceBuy: Number(row.price_buy),
    dataInfo: row.data_info,
    durationDays: row.duration_days,
    packageType: row.package_type,
    capacityBucket: row.capacity_bucket,
    status: row.status,
  };
}

async function resolveCategoryIdsForCountries(supabase, countryCodes) {
  const { data } = await supabase
    .from('category_countries')
    .select('category_id')
    .in('country_code', countryCodes);
  return [...new Set((data || []).map((row) => row.category_id))];
}

export async function listCategories() {
  const supabase = createApiClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from('categories')
    .select('id, name, slug, image_url, status, category_countries(country_code)')
    .eq('status', 'active');
  return (data || []).map(mapCategory);
}

export async function listProductsByCountry(countryCode) {
  const supabase = createApiClient();
  if (!supabase) return [];

  const categoryIds = await resolveCategoryIdsForCountries(supabase, [countryCode]);
  if (categoryIds.length === 0) return [];

  const { data } = await supabase
    .from('products_public')
    .select('*')
    .in('category_id', categoryIds);
  return (data || []).map(mapProduct);
}

export async function listProductsByCategory(categorySlug) {
  const supabase = createApiClient();
  if (!supabase) return [];

  const { data: categoryRows } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', categorySlug)
    .limit(1);
  const category = (categoryRows || [])[0];
  if (!category) return [];

  const { data } = await supabase
    .from('products_public')
    .select('*')
    .eq('category_id', category.id);
  return (data || []).map(mapProduct);
}

export async function listAllProducts() {
  const supabase = createApiClient();
  if (!supabase) return [];
  const { data } = await supabase.from('products_public').select('*');
  return (data || []).map(mapProduct);
}

export async function getProductBySlug(slug) {
  const supabase = createApiClient();
  if (!supabase) return null;
  const { data } = await supabase.from('products_public').select('*').eq('slug', slug).maybeSingle();
  return data ? mapProduct(data) : null;
}

export async function getProductById(id) {
  const supabase = createApiClient();
  if (!supabase) return null;
  const { data } = await supabase.from('products_public').select('*').eq('id', id).maybeSingle();
  return data ? mapProduct(data) : null;
}

export async function getMinPriceByCountry() {
  const supabase = createApiClient();
  if (!supabase) return {};
  const { data } = await supabase.rpc('min_price_by_country');
  const result = {};
  (data || []).forEach((row) => {
    result[row.country_code] = Number(row.min_price);
  });
  return result;
}

export async function searchProducts({
  simType = 'esim',
  search = '',
  countryCodes = [],
  types = [],
  durations = [],
  capacities = [],
  maxPrice = 1000000,
  sortBy = 'default',
  page = 1,
  size = 12,
} = {}) {
  const supabase = createApiClient();
  const safePage = Math.max(1, page);
  const safeSize = Math.max(1, size);
  const empty = { content: [], page: safePage, size: safeSize, totalElements: 0, totalPages: 0 };
  if (!supabase) return empty;

  let categoryIdFilter = null;
  if (countryCodes.length > 0) {
    categoryIdFilter = await resolveCategoryIdsForCountries(supabase, countryCodes);
    if (categoryIdFilter.length === 0) return empty;
  }

  let query = supabase
    .from('products_public')
    .select('*', { count: 'exact' })
    .eq('sim_type', simType)
    .lte('price_buy', maxPrice);

  if (categoryIdFilter) {
    query = query.in('category_id', categoryIdFilter);
  }
  if (types.length > 0) {
    query = query.in('package_type', types);
  }
  if (capacities.length > 0) {
    query = query.in('capacity_bucket', capacities);
  }
  if (durations.length > 0) {
    const ranges = durations.map((bracket) => DURATION_BRACKETS[bracket]).filter(Boolean);
    if (ranges.length > 0) {
      const orExpr = ranges
        .map(([min, max]) => (max == null ? `duration_days.gte.${min}` : `and(duration_days.gte.${min},duration_days.lte.${max})`))
        .join(',');
      query = query.or(orExpr);
    }
  }
  if (search) {
    const { data: matchingCategories } = await supabase
      .from('categories')
      .select('id')
      .ilike('name', `%${search}%`);
    const nameMatchIds = (matchingCategories || []).map((c) => c.id);
    const orParts = [`title.ilike.%${search}%`];
    if (nameMatchIds.length > 0) {
      orParts.push(`category_id.in.(${nameMatchIds.join(',')})`);
    }
    query = query.or(orParts.join(','));
  }

  if (sortBy === 'price-asc') {
    query = query.order('price_buy', { ascending: true });
  } else if (sortBy === 'price-desc') {
    query = query.order('price_buy', { ascending: false });
  } else {
    query = query.order('id', { ascending: true });
  }

  const from = (safePage - 1) * safeSize;
  const to = from + safeSize - 1;
  query = query.range(from, to);

  const { data, count } = await query;
  const totalElements = count || 0;

  return {
    content: (data || []).map(mapProduct),
    page: safePage,
    size: safeSize,
    totalElements,
    totalPages: Math.ceil(totalElements / safeSize),
  };
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- catalog.test.js`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/catalog.js lib/__tests__/catalog.test.js
git commit -m "feat: add lib/catalog.js query layer with full test coverage"
```

---

### Task 4: Auth API routes (`/api/identity/auth/...`)

**Files:**
- Create: `app/api/identity/auth/register/route.js`
- Create: `app/api/identity/auth/register/__tests__/route.test.js`
- Create: `app/api/identity/auth/login/route.js`
- Create: `app/api/identity/auth/login/__tests__/route.test.js`
- Create: `app/api/identity/auth/refresh/route.js`
- Create: `app/api/identity/auth/refresh/__tests__/route.test.js`
- Create: `app/api/identity/auth/me/route.js`
- Create: `app/api/identity/auth/me/__tests__/route.test.js`
- Create: `app/api/identity/auth/users/route.js`
- Create: `app/api/identity/auth/users/__tests__/route.test.js`

**Interfaces:**
- Consumes: `createApiClient` (`lib/supabase/apiClient.js`), `authenticate`/`requireRole`/`authErrorResponse`/`mapUserResponse` (`lib/apiAuth.js`) — both from Task 2.
- Produces: nothing consumed by later tasks (these are leaf endpoints).

- [ ] **Step 1: Write the failing test for register**

Create `app/api/identity/auth/register/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const signUpMock = vi.fn();
const supabaseMock = { auth: { signUp: signUpMock } };

vi.mock('../../../../../../lib/supabase/apiClient', () => ({
  createApiClient: vi.fn(() => supabaseMock),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/identity/auth/register', () => {
  beforeEach(() => {
    signUpMock.mockReset();
  });

  it('trả 201 với UserResponse khi đăng ký thành công', async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@simdulich.vn' } },
      error: null,
    });

    const response = await POST(makeRequest({ name: 'A', email: 'a@simdulich.vn', phone: '0900000000', password: 'secret123' }));
    const body = await response.json();

    expect(signUpMock).toHaveBeenCalledWith({
      email: 'a@simdulich.vn',
      password: 'secret123',
      options: { data: { name: 'A', phone: '0900000000' } },
    });
    expect(response.status).toBe(201);
    expect(body).toEqual({ id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active' });
  });

  it('trả lỗi kèm message khi email đã tồn tại', async () => {
    signUpMock.mockResolvedValue({ data: {}, error: { message: 'User already registered', status: 400 } });

    const response = await POST(makeRequest({ name: 'A', email: 'a@simdulich.vn', phone: '', password: 'secret123' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'User already registered' });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- app/api/identity/auth/register`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 3: Create `app/api/identity/auth/register/route.js`**

```js
import { NextResponse } from 'next/server';
import { createApiClient } from '../../../../../lib/supabase/apiClient';

export async function POST(request) {
  const { name, email, phone, password } = await request.json();

  const supabase = createApiClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, phone } },
  });

  if (error) {
    return NextResponse.json({ message: error.message }, { status: error.status || 400 });
  }

  return NextResponse.json(
    {
      id: data.user.id,
      name,
      email: data.user.email,
      phone: phone || null,
      role: 'customer',
      status: 'active',
    },
    { status: 201 },
  );
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- app/api/identity/auth/register`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for login**

Create `app/api/identity/auth/login/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const signInMock = vi.fn();
const fromMock = vi.fn();
const createApiClientMock = vi.fn(() => ({ auth: { signInWithPassword: signInMock }, from: fromMock }));

vi.mock('../../../../../../lib/supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/identity/auth/login', () => {
  beforeEach(() => {
    signInMock.mockReset();
    fromMock.mockReset();
    createApiClientMock.mockClear();
  });

  it('trả accessToken/refreshToken/user khi đăng nhập đúng', async () => {
    signInMock.mockResolvedValue({
      data: {
        user: { id: 'u1' },
        session: { access_token: 'access-1', refresh_token: 'refresh-1' },
      },
      error: null,
    });
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: { id: 'u1', name: 'A', phone: '0900000000', email: 'a@simdulich.vn', role: 'customer', status: 'active' },
      error: null,
    }));

    const response = await POST(makeRequest({ email: 'a@simdulich.vn', password: 'secret123' }));
    const body = await response.json();

    expect(createApiClientMock).toHaveBeenCalledWith('access-1');
    expect(body).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: { id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active' },
    });
  });

  it('trả 401 khi sai email/mật khẩu', async () => {
    signInMock.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials' } });

    const response = await POST(makeRequest({ email: 'a@simdulich.vn', password: 'wrong' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: 'Email hoặc mật khẩu không đúng.' });
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- app/api/identity/auth/login`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 7: Create `app/api/identity/auth/login/route.js`**

```js
import { NextResponse } from 'next/server';
import { createApiClient } from '../../../../../lib/supabase/apiClient';
import { mapUserResponse } from '../../../../../lib/apiAuth';

export async function POST(request) {
  const { email, password } = await request.json();

  const anonClient = createApiClient();
  if (!anonClient) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return NextResponse.json({ message: 'Email hoặc mật khẩu không đúng.' }, { status: 401 });
  }

  const scopedClient = createApiClient(data.session.access_token);
  const { data: profile } = await scopedClient
    .from('profiles')
    .select('id, name, phone, email, role, status')
    .eq('id', data.user.id)
    .single();

  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: mapUserResponse(profile),
  });
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- app/api/identity/auth/login`
Expected: PASS (2 tests).

- [ ] **Step 9: Write the failing test for refresh**

Create `app/api/identity/auth/refresh/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const refreshSessionMock = vi.fn();
const fromMock = vi.fn();
const createApiClientMock = vi.fn(() => ({ auth: { refreshSession: refreshSessionMock }, from: fromMock }));

vi.mock('../../../../../../lib/supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/identity/auth/refresh', () => {
  beforeEach(() => {
    refreshSessionMock.mockReset();
    fromMock.mockReset();
    createApiClientMock.mockClear();
  });

  it('trả accessToken/refreshToken/user mới khi refresh token hợp lệ', async () => {
    refreshSessionMock.mockResolvedValue({
      data: {
        user: { id: 'u1' },
        session: { access_token: 'access-2', refresh_token: 'refresh-2' },
      },
      error: null,
    });
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: { id: 'u1', name: 'A', phone: '0900000000', email: 'a@simdulich.vn', role: 'customer', status: 'active' },
      error: null,
    }));

    const response = await POST(makeRequest({ refreshToken: 'refresh-1' }));
    const body = await response.json();

    expect(refreshSessionMock).toHaveBeenCalledWith({ refresh_token: 'refresh-1' });
    expect(body.accessToken).toBe('access-2');
    expect(body.user.id).toBe('u1');
  });

  it('trả 401 khi refresh token không hợp lệ', async () => {
    refreshSessionMock.mockResolvedValue({ data: { session: null }, error: { message: 'invalid' } });

    const response = await POST(makeRequest({ refreshToken: 'bad' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: 'Refresh token không hợp lệ hoặc đã hết hạn.' });
  });
});
```

- [ ] **Step 10: Run test, confirm it fails**

Run: `npm test -- app/api/identity/auth/refresh`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 11: Create `app/api/identity/auth/refresh/route.js`**

```js
import { NextResponse } from 'next/server';
import { createApiClient } from '../../../../../lib/supabase/apiClient';
import { mapUserResponse } from '../../../../../lib/apiAuth';

export async function POST(request) {
  const { refreshToken } = await request.json();

  const anonClient = createApiClient();
  if (!anonClient) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const { data, error } = await anonClient.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    return NextResponse.json({ message: 'Refresh token không hợp lệ hoặc đã hết hạn.' }, { status: 401 });
  }

  const scopedClient = createApiClient(data.session.access_token);
  const { data: profile } = await scopedClient
    .from('profiles')
    .select('id, name, phone, email, role, status')
    .eq('id', data.user.id)
    .single();

  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: mapUserResponse(profile),
  });
}
```

- [ ] **Step 12: Run test, confirm it passes**

Run: `npm test -- app/api/identity/auth/refresh`
Expected: PASS (2 tests).

- [ ] **Step 13: Write the failing test for me**

Create `app/api/identity/auth/me/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();

vi.mock('../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});

import { GET } from '../route';

describe('GET /api/identity/auth/me', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
  });

  it('trả UserResponse khi token hợp lệ', async () => {
    authenticateMock.mockResolvedValue({
      user: { id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active' },
      supabase: {},
    });

    const response = await GET({ headers: { get: () => 'Bearer good-token' } });
    const body = await response.json();

    expect(body.id).toBe('u1');
  });

  it('trả lỗi 401 khi authenticate ném AuthError', async () => {
    const { AuthError } = await import('../../../../../lib/apiAuth');
    authenticateMock.mockRejectedValue(new AuthError('Thiếu token xác thực.', 401));

    const response = await GET({ headers: { get: () => null } });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: 'Thiếu token xác thực.' });
  });
});
```

- [ ] **Step 14: Run test, confirm it fails**

Run: `npm test -- app/api/identity/auth/me`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 15: Create `app/api/identity/auth/me/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse } from '../../../../../lib/apiAuth';

export async function GET(request) {
  try {
    const { user } = await authenticate(request);
    return NextResponse.json(user);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 16: Run test, confirm it passes**

Run: `npm test -- app/api/identity/auth/me`
Expected: PASS (2 tests).

- [ ] **Step 17: Write the failing test for users**

Create `app/api/identity/auth/users/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const authenticateMock = vi.fn();

vi.mock('../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/identity/auth/users', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
  });

  it('trả { content, number, totalElements, totalPages } khi caller là admin', async () => {
    const fromMock = vi.fn(() => createQueryBuilderMock({
      data: [{ id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active' }],
      count: 21,
      error: null,
    }));
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: { from: fromMock } });

    const response = await GET(makeRequest('http://localhost:3000/api/identity/auth/users?page=0&size=20'));
    const body = await response.json();

    expect(body.number).toBe(0);
    expect(body.totalElements).toBe(21);
    expect(body.totalPages).toBe(2);
    expect(body.content).toEqual([{ id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active' }]);
  });

  it('trả 403 khi caller không phải admin/staff', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'customer' }, supabase: {} });

    const response = await GET(makeRequest('http://localhost:3000/api/identity/auth/users'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
  });
});
```

- [ ] **Step 18: Run test, confirm it fails**

Run: `npm test -- app/api/identity/auth/users`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 19: Create `app/api/identity/auth/users/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole, mapUserResponse } from '../../../../../lib/apiAuth';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get('page') ?? 0);
    const size = Number(searchParams.get('size') ?? 20);
    const from = page * size;
    const to = from + size - 1;

    const { data, count } = await supabase
      .from('profiles')
      .select('id, name, phone, email, role, status', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    const totalElements = count || 0;

    return NextResponse.json({
      content: (data || []).map(mapUserResponse),
      number: page,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 20: Run test, confirm it passes**

Run: `npm test -- app/api/identity/auth/users`
Expected: PASS (2 tests).

- [ ] **Step 21: Run the full suite, then commit**

Run: `npm test`
Expected: PASS — all previous tests plus these 5 new route suites.

```bash
git add app/api/identity
git commit -m "feat: add Auth API routes (register, login, refresh, me, users)"
```

---

### Task 5: Catalog API routes (`/api/catalog/catalog/...`)

**Files:**
- Create: `app/api/catalog/catalog/categories/route.js`
- Create: `app/api/catalog/catalog/categories/__tests__/route.test.js`
- Create: `app/api/catalog/catalog/min-price-by-country/route.js`
- Create: `app/api/catalog/catalog/min-price-by-country/__tests__/route.test.js`
- Create: `app/api/catalog/catalog/products/route.js`
- Create: `app/api/catalog/catalog/products/__tests__/route.test.js`
- Create: `app/api/catalog/catalog/products/search/route.js`
- Create: `app/api/catalog/catalog/products/search/__tests__/route.test.js`
- Create: `app/api/catalog/catalog/products/by-country/[countryCode]/route.js`
- Create: `app/api/catalog/catalog/products/by-country/[countryCode]/__tests__/route.test.js`
- Create: `app/api/catalog/catalog/products/[slug]/route.js`
- Create: `app/api/catalog/catalog/products/[slug]/__tests__/route.test.js`
- Create: `app/api/catalog/catalog/products/id/[id]/route.js`
- Create: `app/api/catalog/catalog/products/id/[id]/__tests__/route.test.js`

**Interfaces:**
- Consumes: all 8 functions exported by `lib/catalog.js` (Task 3).
- Produces: nothing consumed by later tasks (these are leaf endpoints).

- [ ] **Step 1: Write the failing test for categories**

Create `app/api/catalog/catalog/categories/__tests__/route.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';

const listCategoriesMock = vi.fn();

vi.mock('../../../../../lib/catalog', () => ({
  listCategories: (...args) => listCategoriesMock(...args),
}));

import { GET } from '../route';

describe('GET /api/catalog/catalog/categories', () => {
  it('trả danh sách category từ listCategories()', async () => {
    listCategoriesMock.mockResolvedValue([{ id: 1, name: 'Nhật Bản', slug: 'nhat-ban', imageUrl: null, status: 'active', coveredCountries: ['jp'] }]);

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual([{ id: 1, name: 'Nhật Bản', slug: 'nhat-ban', imageUrl: null, status: 'active', coveredCountries: ['jp'] }]);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- app/api/catalog/catalog/categories`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 3: Create `app/api/catalog/catalog/categories/route.js`**

```js
import { NextResponse } from 'next/server';
import { listCategories } from '../../../../../lib/catalog';

export async function GET() {
  const categories = await listCategories();
  return NextResponse.json(categories);
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- app/api/catalog/catalog/categories`
Expected: PASS (1 test).

- [ ] **Step 5: Write the failing test for min-price-by-country**

Create `app/api/catalog/catalog/min-price-by-country/__tests__/route.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';

const getMinPriceByCountryMock = vi.fn();

vi.mock('../../../../../lib/catalog', () => ({
  getMinPriceByCountry: (...args) => getMinPriceByCountryMock(...args),
}));

import { GET } from '../route';

describe('GET /api/catalog/catalog/min-price-by-country', () => {
  it('trả object { [countryCode]: giá } từ getMinPriceByCountry()', async () => {
    getMinPriceByCountryMock.mockResolvedValue({ jp: 89000, kr: 129000 });

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({ jp: 89000, kr: 129000 });
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- app/api/catalog/catalog/min-price-by-country`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 7: Create `app/api/catalog/catalog/min-price-by-country/route.js`**

```js
import { NextResponse } from 'next/server';
import { getMinPriceByCountry } from '../../../../../lib/catalog';

export async function GET() {
  const result = await getMinPriceByCountry();
  return NextResponse.json(result);
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- app/api/catalog/catalog/min-price-by-country`
Expected: PASS (1 test).

- [ ] **Step 9: Write the failing test for products (list-all / by-categorySlug)**

Create `app/api/catalog/catalog/products/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listAllProductsMock = vi.fn();
const listProductsByCategoryMock = vi.fn();

vi.mock('../../../../../lib/catalog', () => ({
  listAllProducts: (...args) => listAllProductsMock(...args),
  listProductsByCategory: (...args) => listProductsByCategoryMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url };
}

describe('GET /api/catalog/catalog/products', () => {
  beforeEach(() => {
    listAllProductsMock.mockReset();
    listProductsByCategoryMock.mockReset();
  });

  it('gọi listAllProducts() khi không có categorySlug', async () => {
    listAllProductsMock.mockResolvedValue([{ id: 1 }]);

    const response = await GET(makeRequest('http://localhost:3000/api/catalog/catalog/products'));
    const body = await response.json();

    expect(listAllProductsMock).toHaveBeenCalled();
    expect(listProductsByCategoryMock).not.toHaveBeenCalled();
    expect(body).toEqual([{ id: 1 }]);
  });

  it('gọi listProductsByCategory(slug) khi có categorySlug', async () => {
    listProductsByCategoryMock.mockResolvedValue([{ id: 2 }]);

    const response = await GET(makeRequest('http://localhost:3000/api/catalog/catalog/products?categorySlug=singapore'));
    const body = await response.json();

    expect(listProductsByCategoryMock).toHaveBeenCalledWith('singapore');
    expect(body).toEqual([{ id: 2 }]);
  });
});
```

- [ ] **Step 10: Run test, confirm it fails**

Run: `npm test -- app/api/catalog/catalog/products/__tests__/route.test.js`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 11: Create `app/api/catalog/catalog/products/route.js`**

```js
import { NextResponse } from 'next/server';
import { listAllProducts, listProductsByCategory } from '../../../../../lib/catalog';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const categorySlug = searchParams.get('categorySlug');
  const products = categorySlug ? await listProductsByCategory(categorySlug) : await listAllProducts();
  return NextResponse.json(products);
}
```

- [ ] **Step 12: Run test, confirm it passes**

Run: `npm test -- app/api/catalog/catalog/products/__tests__/route.test.js`
Expected: PASS (2 tests).

- [ ] **Step 13: Write the failing test for products/search**

Create `app/api/catalog/catalog/products/search/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchProductsMock = vi.fn();

vi.mock('../../../../../../lib/catalog', () => ({
  searchProducts: (...args) => searchProductsMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url };
}

describe('GET /api/catalog/catalog/products/search', () => {
  beforeEach(() => {
    searchProductsMock.mockReset();
  });

  it('đọc filter từ query string và truyền cho searchProducts()', async () => {
    searchProductsMock.mockResolvedValue({ content: [], page: 2, size: 12, totalElements: 0, totalPages: 0 });

    const response = await GET(makeRequest(
      'http://localhost:3000/api/catalog/catalog/products/search?simType=physical&search=nhat&countryCodes=jp,kr&types=daily,fixed&durations=1-5&capacities=1gb&maxPrice=200000&sortBy=price-asc&page=2&size=12',
    ));
    const body = await response.json();

    expect(searchProductsMock).toHaveBeenCalledWith({
      simType: 'physical',
      search: 'nhat',
      countryCodes: ['jp', 'kr'],
      types: ['daily', 'fixed'],
      durations: ['1-5'],
      capacities: ['1gb'],
      maxPrice: 200000,
      sortBy: 'price-asc',
      page: 2,
      size: 12,
    });
    expect(body.page).toBe(2);
  });

  it('dùng giá trị mặc định của searchProducts() khi query string trống', async () => {
    searchProductsMock.mockResolvedValue({ content: [], page: 1, size: 12, totalElements: 0, totalPages: 0 });

    await GET(makeRequest('http://localhost:3000/api/catalog/catalog/products/search'));

    expect(searchProductsMock).toHaveBeenCalledWith({
      simType: 'esim',
      search: '',
      countryCodes: [],
      types: [],
      durations: [],
      capacities: [],
      maxPrice: undefined,
      sortBy: 'default',
      page: undefined,
      size: undefined,
    });
  });
});
```

- [ ] **Step 14: Run test, confirm it fails**

Run: `npm test -- app/api/catalog/catalog/products/search`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 15: Create `app/api/catalog/catalog/products/search/route.js`**

```js
import { NextResponse } from 'next/server';
import { searchProducts } from '../../../../../../lib/catalog';

function parseList(value) {
  return value ? value.split(',').filter(Boolean) : [];
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const result = await searchProducts({
    simType: searchParams.get('simType') || 'esim',
    search: searchParams.get('search') || '',
    countryCodes: parseList(searchParams.get('countryCodes')),
    types: parseList(searchParams.get('types')),
    durations: parseList(searchParams.get('durations')),
    capacities: parseList(searchParams.get('capacities')),
    maxPrice: searchParams.get('maxPrice') != null ? Number(searchParams.get('maxPrice')) : undefined,
    sortBy: searchParams.get('sortBy') || 'default',
    page: searchParams.get('page') != null ? Number(searchParams.get('page')) : undefined,
    size: searchParams.get('size') != null ? Number(searchParams.get('size')) : undefined,
  });

  return NextResponse.json(result);
}
```

- [ ] **Step 16: Run test, confirm it passes**

Run: `npm test -- app/api/catalog/catalog/products/search`
Expected: PASS (2 tests).

- [ ] **Step 17: Write the failing test for products/by-country/[countryCode]**

Create `app/api/catalog/catalog/products/by-country/[countryCode]/__tests__/route.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';

const listProductsByCountryMock = vi.fn();

vi.mock('../../../../../../../lib/catalog', () => ({
  listProductsByCountry: (...args) => listProductsByCountryMock(...args),
}));

import { GET } from '../route';

describe('GET /api/catalog/catalog/products/by-country/[countryCode]', () => {
  it('gọi listProductsByCountry(countryCode) với countryCode từ params', async () => {
    listProductsByCountryMock.mockResolvedValue([{ id: 1 }]);

    const response = await GET({}, { params: Promise.resolve({ countryCode: 'jp' }) });
    const body = await response.json();

    expect(listProductsByCountryMock).toHaveBeenCalledWith('jp');
    expect(body).toEqual([{ id: 1 }]);
  });
});
```

- [ ] **Step 18: Run test, confirm it fails**

Run: `npm test -- app/api/catalog/catalog/products/by-country`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 19: Create `app/api/catalog/catalog/products/by-country/[countryCode]/route.js`**

```js
import { NextResponse } from 'next/server';
import { listProductsByCountry } from '../../../../../../../lib/catalog';

export async function GET(request, { params }) {
  const { countryCode } = await params;
  const products = await listProductsByCountry(countryCode);
  return NextResponse.json(products);
}
```

- [ ] **Step 20: Run test, confirm it passes**

Run: `npm test -- app/api/catalog/catalog/products/by-country`
Expected: PASS (1 test).

- [ ] **Step 21: Write the failing test for products/[slug]**

Create `app/api/catalog/catalog/products/[slug]/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProductBySlugMock = vi.fn();

vi.mock('../../../../../../lib/catalog', () => ({
  getProductBySlug: (...args) => getProductBySlugMock(...args),
}));

import { GET } from '../route';

describe('GET /api/catalog/catalog/products/[slug]', () => {
  beforeEach(() => {
    getProductBySlugMock.mockReset();
  });

  it('trả sản phẩm khi getProductBySlug() tìm thấy', async () => {
    getProductBySlugMock.mockResolvedValue({ id: 1, slug: 'esim-nb' });

    const response = await GET({}, { params: Promise.resolve({ slug: 'esim-nb' }) });
    const body = await response.json();

    expect(getProductBySlugMock).toHaveBeenCalledWith('esim-nb');
    expect(body).toEqual({ id: 1, slug: 'esim-nb' });
  });

  it('trả 404 khi getProductBySlug() trả null', async () => {
    getProductBySlugMock.mockResolvedValue(null);

    const response = await GET({}, { params: Promise.resolve({ slug: 'khong-ton-tai' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy sản phẩm.' });
  });
});
```

- [ ] **Step 22: Run test, confirm it fails**

Run: `npm test -- "app/api/catalog/catalog/products/\[slug\]"`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 23: Create `app/api/catalog/catalog/products/[slug]/route.js`**

```js
import { NextResponse } from 'next/server';
import { getProductBySlug } from '../../../../../../lib/catalog';

export async function GET(request, { params }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) {
    return NextResponse.json({ message: 'Không tìm thấy sản phẩm.' }, { status: 404 });
  }
  return NextResponse.json(product);
}
```

- [ ] **Step 24: Run test, confirm it passes**

Run: `npm test -- "app/api/catalog/catalog/products/\[slug\]"`
Expected: PASS (2 tests).

- [ ] **Step 25: Write the failing test for products/id/[id]**

Create `app/api/catalog/catalog/products/id/[id]/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProductByIdMock = vi.fn();

vi.mock('../../../../../../../lib/catalog', () => ({
  getProductById: (...args) => getProductByIdMock(...args),
}));

import { GET } from '../route';

describe('GET /api/catalog/catalog/products/id/[id]', () => {
  beforeEach(() => {
    getProductByIdMock.mockReset();
  });

  it('trả sản phẩm khi getProductById() tìm thấy', async () => {
    getProductByIdMock.mockResolvedValue({ id: 7 });

    const response = await GET({}, { params: Promise.resolve({ id: '7' }) });
    const body = await response.json();

    expect(getProductByIdMock).toHaveBeenCalledWith('7');
    expect(body).toEqual({ id: 7 });
  });

  it('trả 404 khi getProductById() trả null', async () => {
    getProductByIdMock.mockResolvedValue(null);

    const response = await GET({}, { params: Promise.resolve({ id: '999' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy sản phẩm.' });
  });
});
```

- [ ] **Step 26: Run test, confirm it fails**

Run: `npm test -- "app/api/catalog/catalog/products/id/\[id\]"`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 27: Create `app/api/catalog/catalog/products/id/[id]/route.js`**

```js
import { NextResponse } from 'next/server';
import { getProductById } from '../../../../../../../lib/catalog';

export async function GET(request, { params }) {
  const { id } = await params;
  const product = await getProductById(id);
  if (!product) {
    return NextResponse.json({ message: 'Không tìm thấy sản phẩm.' }, { status: 404 });
  }
  return NextResponse.json(product);
}
```

- [ ] **Step 28: Run test, confirm it passes**

Run: `npm test -- "app/api/catalog/catalog/products/id/\[id\]"`
Expected: PASS (2 tests).

- [ ] **Step 29: Run the full suite, then commit**

Run: `npm test`
Expected: PASS — every suite from Tasks 1-5 green.

```bash
git add app/api/catalog
git commit -m "feat: add public Catalog API routes"
```

---

### Task 6: Manual end-to-end verification against the old Vite frontend

**Files:**
- Modify (locally only, do not commit): `Simdulich/.env.local` (or wherever `VITE_API_BASE_URL` is read from)

**Interfaces:**
- Consumes: the running `simDulichNew` dev server (`npm run dev`, default `http://localhost:3000`) and `Simdulich` dev server (`npm run dev`, default `http://localhost:5173`).
- Produces: nothing (verification only).

- [ ] **Step 1: Apply the pending Supabase migration and seed data**

In the Supabase Dashboard SQL Editor for the real project, run in order (skip any already applied):
1. `supabase/migrations/0002_catalog.sql` (if not already applied)
2. `supabase/seed/catalog_real_data_import.sql` (per `supabase/seed/README.md` — split by the three top-level `insert into` statements if it times out)
3. `supabase/migrations/0003_profiles_admin_and_email.sql` (from Task 2 of this plan)

- [ ] **Step 2: Start the new backend locally**

```bash
npm run dev
```

Verify it starts on `http://localhost:3000` with no errors in the terminal.

- [ ] **Step 3: Point the old frontend at the new backend**

In `Simdulich/.env.local` (create if missing), set:

```
VITE_API_BASE_URL=http://localhost:3000/api
```

- [ ] **Step 4: Start the old frontend and verify auth flow**

```bash
npm --prefix ../Simdulich run dev
```

In the browser at `http://localhost:5173`:
1. Register a new account — confirm no CORS error in the browser console, and the app either logs the user in or shows the Vietnamese "check your email" message (matches existing register-page behavior).
2. Log in with that account — confirm `/account` loads with the correct name/email.
3. Refresh the page — confirm the session persists (frontend calls `/identity/auth/refresh` or re-reads `/identity/auth/me` without forcing a re-login).

- [ ] **Step 5: Verify catalog browsing**

In the browser:
1. Visit the homepage — confirm "Quốc gia phổ biến" or equivalent pricing data loads (backed by `/catalog/catalog/min-price-by-country`).
2. Visit `/esim` — confirm the product list loads and that filtering by country/type/capacity/price still works (backed by `/catalog/catalog/products/search`).
3. Visit `/esim/jp` (or another seeded country code) — confirm country-specific products load (backed by `/catalog/catalog/products/by-country/jp`).

- [ ] **Step 6: Verify admin user listing**

Using an account whose `profiles.role` you've manually set to `'admin'` in the Supabase table editor, log in and visit the admin users page — confirm the list loads with correct pagination (backed by `/identity/auth/users`, field `number`).

- [ ] **Step 7: Report results**

Summarize pass/fail for each of Steps 4-6 back to the user. Fix any failing step by reading the relevant route/lib file and re-running the automated test for that file before re-verifying manually — do not move on with a known-broken flow.

---

## Self-Review

**Spec coverage:**
- Auth API (register/login/refresh/me/users) — Task 4. ✓
- Catalog API (categories/min-price-by-country/products/products-search/products-by-country/product-by-slug/product-by-id) — Task 5. ✓
- Exact old-BE paths (`catalog/catalog/...` double segment included) — Task 5 file paths. ✓
- `number` vs `page` field distinction — Task 4 Step 19 (`number`), Task 3's `searchProducts()` (`page`). ✓
- Error shape `{message}` — every route's error branches. ✓
- CORS for the two named origins — Task 1 `proxy.js`. ✓
- Discard Phase 1/2 UI, keep backend logic — Task 1. ✓
- Manual verification against old FE — Task 6. ✓
- Admin Catalog API, Order/Payment API — explicitly out of scope per spec, not included. ✓

**Placeholder scan:** No TBD/TODO markers; every step has runnable code or an exact command with expected output.

**Type consistency:** `lib/catalog.js`'s 8 exported function names/signatures (Task 3) match exactly what Task 5's routes import. `lib/apiAuth.js`'s `authenticate`/`requireRole`/`authErrorResponse`/`mapUserResponse` (Task 2) match exactly what Task 4's routes import. `createApiClient(accessToken)` (Task 2) is the only Supabase entry point used by Tasks 3, 4, and 5 — `lib/supabase/server.js` and `client.js` are deleted in Task 1 and never referenced again.

**Deviation from the spec's literal wording (resolved during this plan):** the spec said CORS is "handled via `headers()` in `next.config.mjs`." While verifying against `node_modules/next/dist/docs/`, `headers()` can only set a *static* header value per matched path — it cannot reflect one of two specific allowed origins back conditionally (only a wildcard `*` is static-safe, which the spec explicitly rules out). `proxy.js` is the officially documented alternative for exactly this case (per `node_modules/next/dist/docs/.../proxy.md`'s CORS section) and is what Task 1 implements instead. The spec's *intent* (allow exactly `https://simdulich.vn` and `http://localhost:5173`) is preserved; only the mechanism changed.

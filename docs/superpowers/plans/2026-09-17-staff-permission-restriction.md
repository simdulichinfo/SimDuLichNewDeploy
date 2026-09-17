# Giới hạn quyền Staff trong Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giới hạn quyền của role `staff` trong admin panel — chặn hoàn toàn quyền quản lý người
dùng/thanh toán/API logs, và giới hạn staff chỉ được xem (không sửa/thêm/xoá) sản phẩm/danh
mục/kho SIM — ở cả 3 lớp: RLS (Supabase), API (Next.js route), và frontend (React).

**Architecture:** Sửa RLS policy trong Supabase (thêm hàm `is_admin()` mới, tách policy `for all`
hiện có thành policy view + policy modify riêng cho nhóm "cho xem chặn sửa", đổi thẳng sang
`is_admin()` cho nhóm "chặn hoàn toàn"). Mirror đúng quyết định đó ở tầng API bằng cách đổi tham số
`requireRole(user, [...])` tại từng route. Ở frontend, ẩn hẳn (không disable) nav item và nút
thao tác ghi cho role `staff`.

**Tech Stack:** Next.js Route Handlers, Supabase Postgres + RLS, React (Vite), Vitest.

## Global Constraints

- Không tạo role mới ngoài `admin`/`staff` đã có.
- `lib/apiAuth.js`'s `requireRole(user, roles)` giữ nguyên chữ ký — chỉ đổi tham số `roles` truyền
  vào ở từng route, không sửa hàm.
- Mọi hàm RLS mới (`is_admin()`) phải dùng `security definer set search_path = public` giống
  `is_admin_or_staff()` hiện có — nếu không, query lại `public.profiles` từ trong policy của chính
  bảng `profiles` sẽ gây đệ quy vô hạn (lỗi Postgres 42P17).
- Postgres RLS: nhiều policy permissive cùng loại lệnh được OR với nhau — 1 policy `for select` +
  1 policy `for all` trên cùng bảng nghĩa là SELECT được phép nếu MỘT TRONG HAI điều kiện đúng.
  Dùng đúng cơ chế này để tách "ai xem được" khỏi "ai sửa được" mà không cần policy riêng cho từng
  lệnh insert/update/delete.
- Nav item/nút thao tác bị giới hạn phải **ẩn hẳn** cho staff, không phải disable/làm mờ.
- Giữ nguyên quy ước `{message}` cho mọi response lỗi, giữ nguyên style code hiện có trong từng
  file (không refactor ngoài phạm vi).
- 2 repo, cùng tên nhánh `feature/staff-permissions`: backend tại `D:\SimDuLich\simDulichNew`,
  frontend tại `D:\SimDuLich\Simdulich`. Ledger riêng từng repo tại `.superpowers/sdd/progress.md`.

---

### Task 1: RLS migration — `is_admin()` + tách/đổi policy

**Repo:** `simDulichNew` (branch `feature/staff-permissions`, tạo mới từ `main`)

**Files:**
- Create: `supabase/migrations/0011_staff_permission_restriction.sql`

**Interfaces:**
- Produces: hàm SQL `public.is_admin()` — dùng trong các policy RLS ở Task này; không được JS
  code nào gọi trực tiếp (chỉ Postgres RLS dùng).

- [ ] **Step 1: Viết migration đầy đủ**

```sql
-- Staff (role='staff') vẫn giữ full quyền trên orders/order_items/blog_*, nhưng bị giới hạn ở các
-- bảng nhạy cảm hơn: xem toàn bộ / khoá tài khoản người dùng khác, xem giao dịch thanh toán +
-- api_logs — chỉ còn admin làm được. Trên catalog/kho, staff vẫn SELECT được để tra cứu khi hỗ
-- trợ khách, nhưng insert/update/delete chỉ còn admin.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ── Chặn hoàn toàn: Người dùng, Thanh toán, API logs ────────────────────────

drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin());

drop policy if exists "Admins can update any profile status" on public.profiles;
create policy "Admins can update any profile status"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage payment transactions" on public.payment_transactions;
create policy "Admins can manage payment transactions"
  on public.payment_transactions for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage api logs" on public.api_logs;
create policy "Admins can manage api logs"
  on public.api_logs for all
  using (public.is_admin())
  with check (public.is_admin());

-- profiles_freeze_privileged_columns (migration 0003) exempt bất kỳ ai is_admin_or_staff() khỏi
-- việc bị đóng băng cột role/status khi tự sửa hồ sơ của chính mình. Một khi staff mất quyền admin
-- ở policy "Admins can update any profile status" (trên), nếu không sửa luôn hàm trigger này thì
-- staff vẫn có thể tự PATCH hồ sơ của chính mình (được phép qua policy "Users can update own
-- profile" có sẵn, không đổi) và lén đổi role/status — vì trigger không còn đóng băng 2 cột đó cho
-- họ nữa. Bắt buộc đổi is_admin_or_staff() -> is_admin() ở đây để không mở ra lỗ hổng tự nâng
-- quyền mới khi triển khai tính năng này.
create or replace function public.profiles_freeze_privileged_columns()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Exemption for direct/service-role/dashboard connections (auth.uid() is
  -- null there): needed to bootstrap the very first admin, since no
  -- PostgREST-originated update (anon/authenticated key) can ever reach this
  -- trigger with a null auth.uid() — the 0001 UPDATE policy's
  -- `using (auth.uid() = id)` can never match when auth.uid() is null. Do
  -- not remove this or the first admin can never be promoted.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

-- ── Cho xem, chặn sửa: Gói cước, Danh mục quốc gia, Kho SIM vật lý ──────────

drop policy if exists "Admins can manage categories" on public.categories;
create policy "Staff can view categories" on public.categories
  for select using (public.is_admin_or_staff());
create policy "Admins can modify categories" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage products" on public.products;
create policy "Staff can view products" on public.products
  for select using (public.is_admin_or_staff());
create policy "Admins can modify products" on public.products
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage category_countries" on public.category_countries;
create policy "Staff can view category_countries" on public.category_countries
  for select using (public.is_admin_or_staff());
create policy "Admins can modify category_countries" on public.category_countries
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage inventory" on public.physical_sim_inventory;
create policy "Staff can view inventory" on public.physical_sim_inventory
  for select using (public.is_admin_or_staff());
create policy "Admins can modify inventory" on public.physical_sim_inventory
  for all using (public.is_admin()) with check (public.is_admin());
```

- [ ] **Step 2: Tự rà lại migration (không có test tự động cho RLS — xác nhận bằng đọc lại)**

Đối chiếu từng policy bị đổi/tách với đúng tên bảng + tên policy hiện có trong các migration cũ:
`0003_profiles_admin_and_email.sql` ("Admins can view all profiles"), `0009_profiles_admin_status_update.sql`
("Admins can update any profile status"), `0007_orders_payments.sql` ("Admins can manage payment
transactions", "Admins can manage api logs" — **không đổi** "Admins can manage orders"/"...order
items"), `0004_admin_catalog_rls.sql` ("Admins can manage categories/products/category_countries"),
`0005_physical_sim_inventory.sql` ("Admins can manage inventory"). Xác nhận không đụng tới
`blog_categories`/`blog_posts` (migration `0010_blog.sql`) — nhóm Blog không nằm trong phạm vi.

- [ ] **Step 3: Commit**

```bash
git checkout -b feature/staff-permissions
git add supabase/migrations/0011_staff_permission_restriction.sql
git commit -m "feat: restrict staff RLS access to users/payments/api_logs and catalog writes"
```

---

### Task 2: API layer — chặn hoàn toàn (Người dùng, Thanh toán, API logs)

**Repo:** `simDulichNew` (branch `feature/staff-permissions`, đã tạo ở Task 1)

**Files:**
- Modify: `app/api/identity/auth/users/route.js:7`
- Modify: `app/api/identity/auth/users/[id]/status/route.js:8`
- Modify: `app/api/payments/admin/payments/route.js:8`
- Modify: `app/api/payments/admin/payments/confirm/route.js:8`
- Modify: `app/api/payments/admin/api-logs/route.js:8`
- Test: `app/api/identity/auth/users/__tests__/route.test.js`
- Test: `app/api/identity/auth/users/[id]/status/__tests__/route.test.js`
- Test: `app/api/payments/admin/payments/__tests__/route.test.js`
- Test: `app/api/payments/admin/payments/confirm/__tests__/route.test.js`
- Test: `app/api/payments/admin/api-logs/__tests__/route.test.js`

**Interfaces:**
- Consumes: `requireRole(user, roles)` từ `lib/apiAuth.js` (không đổi, chỉ đổi tham số `roles`).

- [ ] **Step 1: Sửa từng route — đổi `['admin', 'staff']` thành `['admin']`**

`app/api/identity/auth/users/route.js:7`:
```js
    requireRole(user, ['admin']);
```

`app/api/identity/auth/users/[id]/status/route.js:8`:
```js
    requireRole(user, ['admin']);
```

`app/api/payments/admin/payments/route.js:8`:
```js
    requireRole(user, ['admin']);
```

`app/api/payments/admin/payments/confirm/route.js:8`:
```js
    requireRole(user, ['admin']);
```

`app/api/payments/admin/api-logs/route.js:8`:
```js
    requireRole(user, ['admin']);
```

- [ ] **Step 2: Sửa test file `app/api/payments/admin/api-logs/__tests__/route.test.js`**

Test hiện có ở đây dùng `role: 'staff'` và mong đợi THÀNH CÔNG — giờ phải đổi thành `'admin'` (vì
staff không còn qua được nữa), rồi thêm 1 test case staff → 403 riêng:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listApiLogsAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminPayments', () => ({
  listApiLogsAdmin: (...args) => listApiLogsAdminMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/payments/admin/api-logs', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listApiLogsAdminMock.mockReset();
  });

  it('đọc orderId từ query string', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listApiLogsAdminMock.mockResolvedValue({ data: { content: [], number: 0, size: 20, totalElements: 0, totalPages: 0 }, error: null });

    await GET(makeRequest('http://localhost:3000/api/payments/admin/api-logs?orderId=5'));

    expect(listApiLogsAdminMock).toHaveBeenCalledWith({}, { page: undefined, size: undefined, orderId: '5' });
  });

  it('trả 403 khi caller là staff (chỉ admin mới xem được api logs)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await GET(makeRequest('http://localhost:3000/api/payments/admin/api-logs'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
    expect(listApiLogsAdminMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Thêm test case staff → 403 vào 4 file còn lại**

`app/api/identity/auth/users/__tests__/route.test.js` — thêm vào cuối `describe` block (sau test
"trả 500 kèm message..."):
```js

  it('trả 403 khi caller là staff (chỉ admin mới xem danh sách người dùng)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await GET(makeRequest('http://localhost:3000/api/identity/auth/users'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
  });
```

`app/api/identity/auth/users/[id]/status/__tests__/route.test.js` — thêm vào cuối `describe`
block (sau test "trả 403 khi caller không phải admin/staff..." — đổi luôn tên test đó thành "trả
403 khi caller là customer" để rõ nghĩa, rồi thêm test case staff mới ngay sau):
```js

  it('trả 403 khi caller là staff (chỉ admin mới khoá/mở khoá tài khoản)', async () => {
    authenticateMock.mockResolvedValue({ user: { id: 'staff1', role: 'staff' }, supabase: {} });

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'u2' }) });

    expect(response.status).toBe(403);
    expect(toggleUserStatusMock).not.toHaveBeenCalled();
  });
```

`app/api/payments/admin/payments/__tests__/route.test.js` — thêm vào cuối `describe` block:
```js

  it('trả 403 khi caller là staff (chỉ admin mới xem giao dịch thanh toán)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await GET(makeRequest('http://localhost:3000/api/payments/admin/payments'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
    expect(listPaymentsAdminMock).not.toHaveBeenCalled();
  });
```

`app/api/payments/admin/payments/confirm/__tests__/route.test.js` — thêm vào cuối `describe`
block (sau test "trả 403 khi caller không phải admin/staff"):
```js

  it('trả 403 khi caller là staff (chỉ admin mới xác nhận thanh toán thủ công)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await POST(makeRequest({ orderCode: 'SDL2345ABCD' }));

    expect(response.status).toBe(403);
    expect(confirmPaymentAdminMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Chạy toàn bộ 5 test file, xác nhận pass**

Run: `npx vitest run app/api/identity/auth/users app/api/payments/admin`
Expected: tất cả PASS, không còn test nào assert staff thành công trên 5 route này.

- [ ] **Step 5: Commit**

```bash
git add app/api/identity/auth/users app/api/payments/admin
git commit -m "feat: restrict users/payments/api-logs routes to admin only"
```

---

### Task 3: API layer — cho xem chặn sửa (Gói cước, Danh mục, Kho SIM, Nhập Excel)

**Repo:** `simDulichNew` (branch `feature/staff-permissions`)

**Files:**
- Modify: `app/api/catalog/admin/categories/route.js:23` (POST only — GET dòng 8 không đổi)
- Modify: `app/api/catalog/admin/categories/[id]/route.js:8,35` (PUT + DELETE)
- Modify: `app/api/catalog/admin/products/route.js:44` (POST only — GET dòng 29 không đổi)
- Modify: `app/api/catalog/admin/products/[id]/route.js:29,60` (PUT + DELETE)
- Modify: `app/api/catalog/admin/inventory/[id]/status/route.js:8` (PUT)
- Modify: `app/api/catalog/admin/inventory/import/route.js:8` (POST)
- Modify: `app/api/catalog/admin/products/import/route.js:17` (POST)
- Modify: `app/api/catalog/admin/products/smart-import/analyze/route.js:17` (POST)
- Modify: `app/api/catalog/admin/products/smart-import/commit/route.js:17` (POST)
- Test: file test tương ứng của từng route trên (đã tồn tại sẵn)

**Interfaces:**
- Consumes: `requireRole(user, roles)` từ `lib/apiAuth.js` (không đổi).
- Không đổi: `app/api/catalog/admin/categories/route.js` GET, `products/route.js` GET,
  `products/search/route.js` GET, `inventory/route.js` GET — 4 route này giữ nguyên
  `['admin', 'staff']`, staff vẫn xem được.

- [ ] **Step 1: Sửa `categories/route.js` — chỉ đổi POST**

Dòng 23 (`requireRole(user, ['admin', 'staff']);` bên trong `export async function POST`):
```js
    requireRole(user, ['admin']);
```
Dòng 8 (bên trong `GET`) giữ nguyên `requireRole(user, ['admin', 'staff']);`.

- [ ] **Step 2: Sửa `categories/[id]/route.js` — cả PUT và DELETE**

Dòng 8 (trong `PUT`) và dòng 35 (trong `DELETE`), cả hai đổi thành:
```js
    requireRole(user, ['admin']);
```

- [ ] **Step 3: Sửa `products/route.js` — chỉ đổi POST**

Dòng 44 (trong `POST`):
```js
    requireRole(user, ['admin']);
```
Dòng 29 (trong `GET`) giữ nguyên.

- [ ] **Step 4: Sửa `products/[id]/route.js` — cả PUT và DELETE**

Dòng 29 (trong `PUT`) và dòng 60 (trong `DELETE`), cả hai đổi thành:
```js
    requireRole(user, ['admin']);
```

- [ ] **Step 5: Sửa `inventory/[id]/status/route.js`, `inventory/import/route.js`,
  `products/import/route.js`, `products/smart-import/analyze/route.js`,
  `products/smart-import/commit/route.js`**

Cả 5 file này chỉ có đúng 1 method (`PUT` hoặc `POST`), đổi dòng `requireRole(user, ['admin', 'staff']);`
duy nhất trong mỗi file thành:
```js
    requireRole(user, ['admin']);
```

- [ ] **Step 6: Thêm test case staff → 403 vào `categories/__tests__/route.test.js`**

Test hiện có "trả 403 khi caller không phải admin/staff" trong `describe('GET ...')` giữ nguyên
(GET không đổi). Thêm vào cuối `describe('POST /api/catalog/admin/categories', ...)`:
```js

  it('trả 403 khi caller là staff (chỉ admin mới tạo danh mục)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await POST(makePostRequest({ name: 'Lào', slug: 'lao', status: 'active' }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
    expect(createCategoryAdminMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 7: Thêm test case staff → 403 vào `categories/[id]/__tests__/route.test.js`**

Thêm vào cuối `describe('PUT /api/catalog/admin/categories/[id]', ...)`:
```js

  it('trả 403 khi caller là staff (chỉ admin mới sửa danh mục)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await PUT(makePutRequest({ name: 'X', slug: 'x', status: 'active' }), { params: Promise.resolve({ id: '5' }) });

    expect(response.status).toBe(403);
    expect(updateCategoryAdminMock).not.toHaveBeenCalled();
  });
```

File này đã có sẵn `describe('DELETE /api/catalog/admin/categories/[id]', ...)` ở cuối file (với
3 test: "trả 204 khi xoá thành công", "trả 404...", "trả 400 khi bị chặn bởi khoá ngoại") — thêm
test case mới vào CUỐI describe block đó (không tạo describe mới):
```js

  it('trả 403 khi caller là staff (chỉ admin mới xoá danh mục)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '5' }) });

    expect(response.status).toBe(403);
    expect(deleteCategoryAdminMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 8: Thêm test case staff → 403 vào `products/__tests__/route.test.js`**

Cùng pattern Step 6, thêm vào cuối `describe('POST /api/catalog/admin/products', ...)`:
```js

  it('trả 403 khi caller là staff (chỉ admin mới tạo gói cước)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));

    expect(response.status).toBe(403);
    expect(createProductAdminMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 9: Thêm test case staff → 403 vào `products/[id]/__tests__/route.test.js`**

Thêm vào cuối `describe('PUT /api/catalog/admin/products/[id]', ...)`:
```js

  it('trả 403 khi caller là staff (chỉ admin mới sửa gói cước)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(403);
    expect(updateProductAdminMock).not.toHaveBeenCalled();
  });
```

File này đã có sẵn `describe('DELETE /api/catalog/admin/products/[id]', ...)` ở cuối file (với 3
test: "trả 204 khi xoá thành công", "trả 404...", "trả 400 khi bị chặn bởi khoá ngoại") — thêm test
case mới vào CUỐI describe block đó (không tạo describe mới):
```js

  it('trả 403 khi caller là staff (chỉ admin mới xoá gói cước)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(403);
    expect(deleteProductAdminMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 10: Thêm test case staff → 403 vào 5 file còn lại**

`app/api/catalog/admin/inventory/[id]/status/__tests__/route.test.js` — thêm vào cuối describe:
```js

  it('trả 403 khi caller là staff (chỉ admin mới đổi trạng thái ICCID)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await PUT(makeRequest({ status: 'sold' }), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(403);
    expect(updateInventoryStatusAdminMock).not.toHaveBeenCalled();
  });
```

`app/api/catalog/admin/inventory/import/__tests__/route.test.js` — thêm vào cuối describe:
```js

  it('trả 403 khi caller là staff (chỉ admin mới nhập kho)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await POST(makeRequest({ productId: 10, iccids: ['x'] }));

    expect(response.status).toBe(403);
    expect(importInventoryAdminMock).not.toHaveBeenCalled();
  });
```

`app/api/catalog/admin/products/import/__tests__/route.test.js` — thêm vào cuối describe (dùng
đúng cấu trúc `request` với `formData` như các test khác trong file):
```js

  it('trả 403 khi caller là staff (chỉ admin mới nhập sản phẩm hàng loạt)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([['file', fakeFile]]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(runProductImportMock).not.toHaveBeenCalled();
  });
```

`app/api/catalog/admin/products/smart-import/analyze/__tests__/route.test.js` — thêm vào cuối
describe:
```js

  it('trả 403 khi caller là staff (chỉ admin mới phân tích bảng giá)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([['file', fakeFile]]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(runSmartImportMock).not.toHaveBeenCalled();
  });
```

`app/api/catalog/admin/products/smart-import/commit/__tests__/route.test.js` — thêm vào cuối
describe:
```js

  it('trả 403 khi caller là staff (chỉ admin mới ghi bảng giá đã phân tích)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([['file', fakeFile]]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(runSmartImportMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 11: Chạy toàn bộ test catalog, xác nhận pass**

Run: `npx vitest run app/api/catalog/admin`
Expected: tất cả PASS, mỗi route mutate có đúng 1 test case staff→403 mới.

- [ ] **Step 12: Commit**

```bash
git add app/api/catalog/admin
git commit -m "feat: restrict catalog/inventory/import write routes to admin only"
```

---

### Task 4: Frontend — permissions.js + AdminLayout ẩn nav + AdminApp lưới an toàn

**Repo:** `Simdulich` (branch `feature/staff-permissions`, tạo mới từ `main`)

**Files:**
- Create: `src/admin/permissions.js`
- Test: `src/admin/__tests__/permissions.test.js`
- Modify: `src/admin/AdminLayout.jsx`
- Modify: `src/admin/AdminApp.jsx`
- Test: `src/admin/__tests__/AdminLayout.test.jsx` (đã tồn tại, sửa)

**Interfaces:**
- Produces: `ADMIN_ONLY_ROUTES` (mảng string) và `canAccessRoute(role, route)` (function trả về
  boolean) từ `src/admin/permissions.js` — dùng ở cả `AdminLayout.jsx` và `AdminApp.jsx`.

- [ ] **Step 1: Viết test cho `permissions.js`**

```js
// src/admin/__tests__/permissions.test.js
import { describe, it, expect } from 'vitest';
import { ADMIN_ONLY_ROUTES, canAccessRoute } from '../permissions';

describe('permissions', () => {
  it('ADMIN_ONLY_ROUTES chứa đúng 4 route bị giới hạn', () => {
    expect(ADMIN_ONLY_ROUTES).toEqual(['users', 'payments', 'apilogs', 'catalog-import']);
  });

  it('admin truy cập được mọi route', () => {
    expect(canAccessRoute('admin', 'users')).toBe(true);
    expect(canAccessRoute('admin', 'dashboard')).toBe(true);
  });

  it('staff không truy cập được route trong ADMIN_ONLY_ROUTES', () => {
    expect(canAccessRoute('staff', 'users')).toBe(false);
    expect(canAccessRoute('staff', 'payments')).toBe(false);
    expect(canAccessRoute('staff', 'apilogs')).toBe(false);
    expect(canAccessRoute('staff', 'catalog-import')).toBe(false);
  });

  it('staff vẫn truy cập được route không nằm trong ADMIN_ONLY_ROUTES', () => {
    expect(canAccessRoute('staff', 'dashboard')).toBe(true);
    expect(canAccessRoute('staff', 'orders')).toBe(true);
    expect(canAccessRoute('staff', 'products')).toBe(true);
    expect(canAccessRoute('staff', 'blog-posts')).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx vitest run src/admin/__tests__/permissions.test.js`
Expected: FAIL — không tìm thấy module `../permissions`.

- [ ] **Step 3: Viết `permissions.js`**

```js
// src/admin/permissions.js
export const ADMIN_ONLY_ROUTES = ['users', 'payments', 'apilogs', 'catalog-import'];

export function canAccessRoute(role, route) {
  return role === 'admin' || !ADMIN_ONLY_ROUTES.includes(route);
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npx vitest run src/admin/__tests__/permissions.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Sửa `AdminLayout.jsx` — nhận `role`, lọc `NAV` trước khi render**

Thêm import ở đầu file (dòng 1, cùng dòng với các import lucide-react hiện có, thêm 1 dòng mới
ngay dưới):
```js
import { LayoutDashboard, ShoppingCart, Smartphone, Package, Globe, Ticket, Users, CreditCard, Terminal, Bell, ChevronRight, UploadCloud, Tag, Newspaper } from 'lucide-react';
import { canAccessRoute } from './permissions';
```

Đổi chữ ký hàm (dòng 26):
```js
export default function AdminLayout({ route, role, onNavigate, onExit, children }) {
```

Đổi đoạn render nav (dòng 37-58) — lọc `group.items` qua `canAccessRoute` trước khi `.map`:
```js
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV.map(group => {
            const visibleItems = group.items.filter(item => canAccessRoute(role, item.key));
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.group}>
                <p className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{group.group}</p>
                <div className="space-y-1">
                  {visibleItems.map(item => {
                    const Icon = item.icon;
                    const active = item.key === route;
                    return (
                      <button
                        key={item.key}
                        onClick={() => onNavigate(item.key)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${active ? 'bg-brand-light text-brand' : 'text-slate-600 hover:bg-slate-100'}`}
                      >
                        <Icon className="h-4.5 w-4.5" /> {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
```

(`NAV` array ở đầu file — dòng 3-24 — giữ nguyên, không đổi.)

- [ ] **Step 6: Sửa test `AdminLayout.test.jsx` — truyền `role="admin"` vào các test hiện có, thêm
  test staff bị ẩn nav**

```js
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminLayout from '../AdminLayout';

describe('AdminLayout', () => {
  it('render children và các mục menu', () => {
    render(<AdminLayout route="dashboard" role="admin" onNavigate={() => {}} onExit={() => {}}><p>Nội dung trang</p></AdminLayout>);
    expect(screen.getByText('Nội dung trang')).toBeInTheDocument();
    expect(screen.getByText('Đơn hàng')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('tô active mục trùng route', () => {
    render(<AdminLayout route="orders" role="admin" onNavigate={() => {}} onExit={() => {}}><span /></AdminLayout>);
    expect(screen.getByRole('button', { name: /Đơn hàng/ }).className).toMatch(/brand/);
  });

  it('gọi onNavigate khi bấm mục', async () => {
    const onNavigate = vi.fn();
    render(<AdminLayout route="dashboard" role="admin" onNavigate={onNavigate} onExit={() => {}}><span /></AdminLayout>);
    await userEvent.click(screen.getByRole('button', { name: /Gói cước/ }));
    expect(onNavigate).toHaveBeenCalledWith('products');
  });

  it('admin thấy đủ mục Người dùng/Thanh toán/Nhật ký API/Nhập từ CSV', () => {
    render(<AdminLayout route="dashboard" role="admin" onNavigate={() => {}} onExit={() => {}}><span /></AdminLayout>);
    expect(screen.getByText('Người dùng')).toBeInTheDocument();
    expect(screen.getByText('Giao dịch thanh toán')).toBeInTheDocument();
    expect(screen.getByText('Nhật ký API')).toBeInTheDocument();
    expect(screen.getByText('Nhập từ CSV/Excel')).toBeInTheDocument();
  });

  it('staff không thấy mục Người dùng/Thanh toán/Nhật ký API/Nhập từ CSV, vẫn thấy Đơn hàng/Blog', () => {
    render(<AdminLayout route="dashboard" role="staff" onNavigate={() => {}} onExit={() => {}}><span /></AdminLayout>);
    expect(screen.queryByText('Người dùng')).not.toBeInTheDocument();
    expect(screen.queryByText('Giao dịch thanh toán')).not.toBeInTheDocument();
    expect(screen.queryByText('Nhật ký API')).not.toBeInTheDocument();
    expect(screen.queryByText('Nhập từ CSV/Excel')).not.toBeInTheDocument();
    expect(screen.getByText('Đơn hàng')).toBeInTheDocument();
    expect(screen.getByText('Bài viết Blog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Sửa `AdminApp.jsx` — truyền `role` xuống `AdminLayout`, thêm lưới an toàn**

Đọc lại toàn bộ file trước khi sửa — nội dung hiện tại:
```js
import { useState } from 'react';
import AdminLayout from './AdminLayout';
import DashboardPage from './pages/DashboardPage';
import OrdersListPage from './pages/OrdersListPage';
import OrderDetailPage from './pages/OrderDetailPage';
import ProductsPage from './pages/ProductsPage';
import CatalogImportPage from './pages/CatalogImportPage';
import CategoriesPage from './pages/CategoriesPage';
import InventoryPage from './pages/InventoryPage';
import EsimPage from './pages/EsimPage';
import UsersPage from './pages/UsersPage';
import PaymentsPage from './pages/PaymentsPage';
import ApiLogsPage from './pages/ApiLogsPage';
import BlogCategoriesPage from './pages/BlogCategoriesPage';
import BlogPostsPage from './pages/BlogPostsPage';
import BlogPostEditorPage from './pages/BlogPostEditorPage';

function Placeholder({ title }) {
  return <div className="text-slate-400 text-sm">{title} — Đang phát triển (Đợt 2/3).</div>;
}

export default function AdminApp({ onExit }) {
  const [route, setRoute] = useState('dashboard');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [editingPostId, setEditingPostId] = useState(undefined); // undefined = not editing, null = new post, number = editing that id

  let page;
  if (route === 'dashboard') page = <DashboardPage />;
  else if (route === 'orders') page = <OrdersListPage onOpenOrder={(id) => { setSelectedOrderId(id); setRoute('order-detail'); }} />;
  else if (route === 'order-detail' && selectedOrderId != null) page = <OrderDetailPage orderId={selectedOrderId} onBack={() => setRoute('orders')} />;
  else if (route === 'products') page = <ProductsPage />;
  else if (route === 'catalog-import') page = <CatalogImportPage />;
  else if (route === 'categories') page = <CategoriesPage />;
  else if (route === 'inventory') page = <InventoryPage />;
  else if (route === 'esim') page = <EsimPage />;
  else if (route === 'users') page = <UsersPage />;
  else if (route === 'payments') page = <PaymentsPage />;
  else if (route === 'apilogs') page = <ApiLogsPage />;
  else if (route === 'blog-categories') page = <BlogCategoriesPage />;
  else if (route === 'blog-posts') page = <BlogPostsPage onNewPost={() => { setEditingPostId(null); setRoute('blog-post-editor'); }} onEditPost={(id) => { setEditingPostId(id); setRoute('blog-post-editor'); }} />;
  else if (route === 'blog-post-editor') page = <BlogPostEditorPage postId={editingPostId} onDone={() => setRoute('blog-posts')} onBack={() => setRoute('blog-posts')} />;
  else page = <Placeholder title={route} />;

  const navRoute = route === 'order-detail' ? 'orders' : route === 'blog-post-editor' ? 'blog-posts' : route;
  return (
    <AdminLayout route={navRoute} onNavigate={setRoute} onExit={onExit}>
      {page}
    </AdminLayout>
  );
}
```

Sửa thành (thêm import `useAuth` + `canAccessRoute`, thêm `role`, thêm `useEffect` lưới an toàn,
truyền `role` xuống `AdminLayout`):
```js
import { useState, useEffect } from 'react';
import AdminLayout from './AdminLayout';
import { canAccessRoute } from './permissions';
import { useAuth } from '../context/AuthContext';
import DashboardPage from './pages/DashboardPage';
import OrdersListPage from './pages/OrdersListPage';
import OrderDetailPage from './pages/OrderDetailPage';
import ProductsPage from './pages/ProductsPage';
import CatalogImportPage from './pages/CatalogImportPage';
import CategoriesPage from './pages/CategoriesPage';
import InventoryPage from './pages/InventoryPage';
import EsimPage from './pages/EsimPage';
import UsersPage from './pages/UsersPage';
import PaymentsPage from './pages/PaymentsPage';
import ApiLogsPage from './pages/ApiLogsPage';
import BlogCategoriesPage from './pages/BlogCategoriesPage';
import BlogPostsPage from './pages/BlogPostsPage';
import BlogPostEditorPage from './pages/BlogPostEditorPage';

function Placeholder({ title }) {
  return <div className="text-slate-400 text-sm">{title} — Đang phát triển (Đợt 2/3).</div>;
}

export default function AdminApp({ onExit }) {
  const { user } = useAuth();
  const role = user?.role;
  const [route, setRoute] = useState('dashboard');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [editingPostId, setEditingPostId] = useState(undefined); // undefined = not editing, null = new post, number = editing that id

  // Lưới an toàn dự phòng: nav đã ẩn mục staff không được vào, nhưng nếu route hiện tại lỡ trỏ
  // vào 1 route staff không có quyền (state cũ còn sót lại, hoặc role đổi ngay lúc đang dùng),
  // tự chuyển về dashboard thay vì để lộ trang bị giới hạn.
  useEffect(() => {
    if (role && !canAccessRoute(role, route)) {
      setRoute('dashboard');
    }
  }, [role, route]);

  let page;
  if (route === 'dashboard') page = <DashboardPage />;
  else if (route === 'orders') page = <OrdersListPage onOpenOrder={(id) => { setSelectedOrderId(id); setRoute('order-detail'); }} />;
  else if (route === 'order-detail' && selectedOrderId != null) page = <OrderDetailPage orderId={selectedOrderId} onBack={() => setRoute('orders')} />;
  else if (route === 'products') page = <ProductsPage />;
  else if (route === 'catalog-import') page = <CatalogImportPage />;
  else if (route === 'categories') page = <CategoriesPage />;
  else if (route === 'inventory') page = <InventoryPage />;
  else if (route === 'esim') page = <EsimPage />;
  else if (route === 'users') page = <UsersPage />;
  else if (route === 'payments') page = <PaymentsPage />;
  else if (route === 'apilogs') page = <ApiLogsPage />;
  else if (route === 'blog-categories') page = <BlogCategoriesPage />;
  else if (route === 'blog-posts') page = <BlogPostsPage onNewPost={() => { setEditingPostId(null); setRoute('blog-post-editor'); }} onEditPost={(id) => { setEditingPostId(id); setRoute('blog-post-editor'); }} />;
  else if (route === 'blog-post-editor') page = <BlogPostEditorPage postId={editingPostId} onDone={() => setRoute('blog-posts')} onBack={() => setRoute('blog-posts')} />;
  else page = <Placeholder title={route} />;

  const navRoute = route === 'order-detail' ? 'orders' : route === 'blog-post-editor' ? 'blog-posts' : route;
  return (
    <AdminLayout route={navRoute} role={role} onNavigate={setRoute} onExit={onExit}>
      {page}
    </AdminLayout>
  );
}
```

(Không có test file riêng cho `AdminApp.jsx` hiện tại trong codebase — không tạo mới, hành vi của
nó được phủ gián tiếp qua test của `AdminLayout` + `permissions`.)

- [ ] **Step 8: Chạy toàn bộ test đã sửa/thêm ở Task này**

Run: `npx vitest run src/admin/__tests__/permissions.test.js src/admin/__tests__/AdminLayout.test.jsx`
Expected: tất cả PASS.

- [ ] **Step 9: Commit**

```bash
git checkout -b feature/staff-permissions
git add src/admin/permissions.js src/admin/__tests__/permissions.test.js src/admin/AdminLayout.jsx src/admin/__tests__/AdminLayout.test.jsx src/admin/AdminApp.jsx
git commit -m "feat: hide admin-only nav items and add route safety-net for staff role"
```

---

### Task 5: Frontend — ẩn nút thao tác ghi cho staff (Danh mục, Gói cước, Kho SIM)

**Repo:** `Simdulich` (branch `feature/staff-permissions`)

**Files:**
- Modify: `src/admin/pages/CategoriesPage.jsx`
- Modify: `src/admin/pages/ProductsPage.jsx`
- Modify: `src/admin/pages/InventoryPage.jsx`
- Test: `src/admin/pages/__tests__/CategoriesPage.test.jsx` (đã tồn tại, thêm test)
- Test: `src/admin/pages/__tests__/ProductsPage.test.jsx` (đã tồn tại, thêm test)
- Test: `src/admin/pages/__tests__/InventoryPage.test.jsx` (đã tồn tại, thêm test)

**Interfaces:**
- Consumes: `useAuth()` từ `src/context/AuthContext.jsx` (đã có sẵn `user.role`, không đổi).

- [ ] **Step 1: Sửa `CategoriesPage.jsx` — ẩn nút Thêm/Sửa/Xóa cho staff**

Dòng 2 và 12 hiện tại:
```js
import { useAuth } from '../../context/AuthContext';
...
  const { accessToken } = useAuth();
```
Đổi dòng 12 thành:
```js
  const { accessToken, user } = useAuth();
  const isAdmin = user?.role === 'admin';
```

Dòng 62-67 hiện tại (nút "Thêm danh mục"):
```js
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Danh mục quốc gia / Khu vực</h1>
        <button onClick={() => setForm({ ...EMPTY })} className="px-4 py-2.5 bg-brand text-white font-bold rounded-full hover:bg-brand-hover flex items-center gap-1.5 text-sm">
          <Plus className="h-4 w-4" /> Thêm danh mục
        </button>
      </div>
```
Đổi thành:
```js
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Danh mục quốc gia / Khu vực</h1>
        {isAdmin && (
          <button onClick={() => setForm({ ...EMPTY })} className="px-4 py-2.5 bg-brand text-white font-bold rounded-full hover:bg-brand-hover flex items-center gap-1.5 text-sm">
            <Plus className="h-4 w-4" /> Thêm danh mục
          </button>
        )}
      </div>
```

Dòng 87-90 hiện tại (nút Sửa/Xóa từng dòng):
```js
              <div className="flex gap-2 mt-3">
                <button onClick={() => setForm({ ...c })} className="text-xs font-bold text-brand flex items-center gap-1"><Pencil className="h-3.5 w-3.5" /> Sửa</button>
                <button onClick={() => remove(c.id)} className="text-xs font-bold text-rose-600 flex items-center gap-1"><Trash2 className="h-3.5 w-3.5" /> Xóa</button>
              </div>
```
Đổi thành:
```js
              {isAdmin && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setForm({ ...c })} className="text-xs font-bold text-brand flex items-center gap-1"><Pencil className="h-3.5 w-3.5" /> Sửa</button>
                  <button onClick={() => remove(c.id)} className="text-xs font-bold text-rose-600 flex items-center gap-1"><Trash2 className="h-3.5 w-3.5" /> Xóa</button>
                </div>
              )}
```

- [ ] **Step 2: Thêm test cho `CategoriesPage.jsx`**

Thêm vào cuối `describe('CategoriesPage', ...)` trong `src/admin/pages/__tests__/CategoriesPage.test.jsx`:
```js

  it('staff: thấy danh mục nhưng không thấy nút Thêm/Sửa/Xóa', async () => {
    localStorage.setItem('simdulich_auth', JSON.stringify({ accessToken: 'tok', refreshToken: 'r', user: { role: 'staff' } }));
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('category-card').length).toBe(1));

    expect(screen.getByText('Hàn Quốc')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Thêm danh mục/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sửa/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Xóa/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: Sửa `ProductsPage.jsx` — ẩn nút Thêm/Sửa/Xóa cho staff**

Dòng 13 hiện tại:
```js
  const { accessToken } = useAuth();
```
Đổi thành:
```js
  const { accessToken, user } = useAuth();
  const isAdmin = user?.role === 'admin';
```

Dòng 84-92 hiện tại (nút "Thêm gói cước"):
```js
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Quản lý Gói cước</h1>
          <p className="text-slate-500 text-sm">Cập nhật chi tiết các gói cước SIM/eSIM</p>
        </div>
        <button onClick={openNew} className="px-4 py-2.5 bg-brand text-white font-bold rounded-full hover:bg-brand-hover flex items-center gap-1.5 text-sm">
          <Plus className="h-4 w-4" /> Thêm gói cước
        </button>
      </div>
```
Đổi thành:
```js
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Quản lý Gói cước</h1>
          <p className="text-slate-500 text-sm">Cập nhật chi tiết các gói cước SIM/eSIM</p>
        </div>
        {isAdmin && (
          <button onClick={openNew} className="px-4 py-2.5 bg-brand text-white font-bold rounded-full hover:bg-brand-hover flex items-center gap-1.5 text-sm">
            <Plus className="h-4 w-4" /> Thêm gói cước
          </button>
        )}
      </div>
```

Dòng 125-128 hiện tại (nút Sửa/Xóa từng dòng, nằm trong ô `<td>` cuối):
```js
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => openEdit(p)} className="p-2 text-slate-400 hover:text-brand"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(p.id)} className="p-2 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                </td>
```
Đổi thành:
```js
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {isAdmin && (
                    <>
                      <button onClick={() => openEdit(p)} className="p-2 text-slate-400 hover:text-brand"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => remove(p.id)} className="p-2 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                    </>
                  )}
                </td>
```

- [ ] **Step 4: Thêm test cho `ProductsPage.jsx`**

Thêm vào cuối `describe('ProductsPage', ...)` trong `src/admin/pages/__tests__/ProductsPage.test.jsx`:
```js

  it('staff: thấy gói cước nhưng không thấy nút Thêm/Sửa/Xóa', async () => {
    localStorage.setItem('simdulich_auth', JSON.stringify({ accessToken: 'tok', refreshToken: 'r', user: { role: 'staff' } }));
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('product-row').length).toBe(1));

    expect(screen.getByText('eSIM Hàn Quốc 5GB/ngày')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Thêm gói cước/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 5: Sửa `InventoryPage.jsx` — ẩn nút "Nhập kho" cho staff**

Dòng 11 hiện tại:
```js
  const { accessToken } = useAuth();
```
Đổi thành:
```js
  const { accessToken, user } = useAuth();
  const isAdmin = user?.role === 'admin';
```

Dòng 59-64 hiện tại:
```js
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Kho SIM vật lý</h1>
        <button onClick={() => setImporting({ productId: physicalProducts[0]?.id ?? 1, text: '' })} disabled={physicalProducts.length === 0} className="px-4 py-2.5 bg-brand text-white font-bold rounded-full hover:bg-brand-hover flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
          <Plus className="h-4 w-4" /> Nhập kho
        </button>
      </div>
```
Đổi thành:
```js
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Kho SIM vật lý</h1>
        {isAdmin && (
          <button onClick={() => setImporting({ productId: physicalProducts[0]?.id ?? 1, text: '' })} disabled={physicalProducts.length === 0} className="px-4 py-2.5 bg-brand text-white font-bold rounded-full hover:bg-brand-hover flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
            <Plus className="h-4 w-4" /> Nhập kho
          </button>
        )}
      </div>
```

- [ ] **Step 6: Thêm test cho `InventoryPage.jsx`**

Thêm vào cuối `describe('InventoryPage', ...)` trong `src/admin/pages/__tests__/InventoryPage.test.jsx`:
```js

  it('staff: thấy kho SIM nhưng không thấy nút Nhập kho', async () => {
    localStorage.setItem('simdulich_auth', JSON.stringify({ accessToken: 'tok', refreshToken: 'r', user: { role: 'staff' } }));
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('inventory-row').length).toBe(1));

    expect(screen.getByText('8984011234567890123')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nhập kho/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 7: Chạy toàn bộ 3 test file, xác nhận pass**

Run: `npx vitest run src/admin/pages/__tests__/CategoriesPage.test.jsx src/admin/pages/__tests__/ProductsPage.test.jsx src/admin/pages/__tests__/InventoryPage.test.jsx`
Expected: tất cả PASS — cả test admin cũ (vẫn thấy nút) lẫn test staff mới (không thấy nút).

- [ ] **Step 8: Commit**

```bash
git add src/admin/pages/CategoriesPage.jsx src/admin/pages/ProductsPage.jsx src/admin/pages/InventoryPage.jsx src/admin/pages/__tests__/CategoriesPage.test.jsx src/admin/pages/__tests__/ProductsPage.test.jsx src/admin/pages/__tests__/InventoryPage.test.jsx
git commit -m "feat: hide catalog/inventory mutate controls from staff role"
```

---

### Task 6: Kiểm thử thủ công (cả 2 repo) — xác nhận RLS + API + UI

**Không viết code mới** — chạy migration thật, tạo tài khoản staff thật, xác nhận qua UI/API/RLS.

- [ ] **Step 1: Áp dụng migration `0011_staff_permission_restriction.sql` lên Supabase thật**

Chạy nội dung file migration trong SQL Editor của Supabase dashboard (giống cách các migration
trước đã được áp dụng). Xác nhận không có lỗi.

- [ ] **Step 2: Tạo/xác nhận có 1 tài khoản `role='staff'` thật để test**

Nếu chưa có, đăng ký 1 tài khoản mới rồi chạy SQL đổi `role` thành `'staff'`:
```sql
update public.profiles set role = 'staff' where email = 'staff-test@simdulich.vn';
```

- [ ] **Step 3: Xác nhận UI admin panel với tài khoản staff**

Đăng nhập bằng tài khoản staff, xác nhận:
- Sidebar KHÔNG có: Người dùng, Giao dịch thanh toán, Nhật ký API, Nhập từ CSV/Excel.
- Sidebar VẪN CÓ: Dashboard, Đơn hàng, eSIM đã cấp, Gói cước, Danh mục quốc gia, Kho SIM vật lý,
  Bài viết Blog, Danh mục Blog.
- Vào "Gói cước": thấy danh sách, KHÔNG thấy nút "Thêm gói cước", không thấy icon Sửa/Xóa.
- Vào "Danh mục quốc gia": thấy danh sách, KHÔNG thấy nút "Thêm danh mục"/Sửa/Xóa.
- Vào "Kho SIM vật lý": thấy danh sách, KHÔNG thấy nút "Nhập kho".
- Vào "Bài viết Blog": vẫn thấy đủ nút Viết bài mới/Sửa/Xoá (nhóm này không đổi).

- [ ] **Step 4: Xác nhận API bị chặn đúng bằng token staff thật (qua trình duyệt hoặc curl)**

Lấy access token thật của tài khoản staff (từ devtools localStorage `simdulich_auth` sau khi đăng
nhập), gọi thử các endpoint admin-only, xác nhận 403 `{"message":"Không đủ quyền truy cập."}`:
```bash
curl -H "Authorization: Bearer <STAFF_TOKEN>" https://sim-du-lich-new-deploy.vercel.app/api/identity/auth/users
curl -X POST -H "Authorization: Bearer <STAFF_TOKEN>" https://sim-du-lich-new-deploy.vercel.app/api/catalog/admin/categories -d '{}'
```
Và xác nhận GET catalog vẫn trả 200 cho staff:
```bash
curl -H "Authorization: Bearer <STAFF_TOKEN>" https://sim-du-lich-new-deploy.vercel.app/api/catalog/admin/categories
```

- [ ] **Step 5: Xác nhận RLS chặn thật ở tầng database (gọi thẳng PostgREST, bỏ qua app)**

Dùng token staff thật gọi thẳng Supabase REST API (không qua Next.js app), xác nhận bị chặn ở tầng
DB chứ không chỉ tầng route:
```bash
curl -H "Authorization: Bearer <STAFF_TOKEN>" -H "apikey: <SUPABASE_ANON_KEY>" \
  "https://<project>.supabase.co/rest/v1/profiles?select=*"
```
Expected: trả về mảng RỖNG (RLS chặn SELECT, không phải lỗi — PostgREST trả `[]` khi RLS lọc hết
hàng chứ không trả lỗi 403). Thử thêm 1 lệnh UPDATE thẳng vào `products` (đổi giá) bằng token staff,
xác nhận bị chặn (0 rows affected).

- [ ] **Step 6: Xác nhận admin không bị ảnh hưởng**

Đăng nhập lại bằng tài khoản admin, xác nhận toàn bộ sidebar + chức năng cũ vẫn hoạt động bình
thường, không có gì bị chặn nhầm.

- [ ] **Step 7: Cập nhật ledger cả 2 repo**

Ghi kết quả Task 6 vào `.superpowers/sdd/progress.md` ở cả `simDulichNew` và `Simdulich` (file này
đã gitignore, không commit — chỉ để theo dõi nội bộ, theo đúng quy ước dự án).

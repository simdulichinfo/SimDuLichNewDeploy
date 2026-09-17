# Giới hạn quyền Staff trong Admin Panel — Design Spec

## Bối cảnh

Từ khi bắt đầu rebuild (Đợt 3), mọi API admin đều dùng `requireRole(user, ['admin', 'staff'])` —
không phân biệt 2 role. Quyết định này được ghi nhận rõ ràng trong spec Đợt 5 ("Không phân biệt
quyền admin/staff khi toggle, giống mọi route admin khác"), tức là cố ý, không phải thiếu sót.
Đồng thời, các RLS policy trong Supabase (`is_admin_or_staff()`) cũng cấp full quyền đọc/ghi cho
cả 2 role trên mọi bảng liên quan. Vì mọi route admin dùng JWT của chính user để query Supabase
(không dùng service-role key — xem `lib/apiAuth.js`'s `authenticate()`), RLS mới là lớp chặn thật
sự; `requireRole()` ở tầng Next.js chỉ là kiểm tra sớm cho gọn/thông báo lỗi rõ ràng.

Sidebar admin panel (`AdminLayout.jsx`) cũng không lọc mục nào theo role — staff thấy y hệt admin.

Hiện tại điều này có nghĩa một nhân viên bình thường có thể khoá tài khoản admin khác, xem toàn bộ
log thanh toán, sửa giá gói cước — y hệt admin. Cần giới hạn lại.

## Phạm vi

**Nhóm bị chặn hoàn toàn** (staff không xem, không sửa — dữ liệu nhạy cảm nhất):
- Người dùng: danh sách tài khoản, khoá/mở khoá
- Giao dịch thanh toán
- Nhật ký API

**Nhóm cho xem, chặn sửa/thêm/xoá** (staff cần tra cứu khi hỗ trợ khách, nhưng không mutate):
- Gói cước (products)
- Danh mục quốc gia (categories + category_countries)
- Kho SIM vật lý (physical_sim_inventory)
- Riêng "Nhập từ CSV/Excel": ẩn hẳn khỏi sidebar cho staff — trang này thuần là form nhập liệu
  hàng loạt, không có giá trị "xem" nào đáng giữ lại một khi không được submit.

**Không đổi** (staff giữ nguyên full quyền, không nằm trong phạm vi lần này):
- Dashboard, Đơn hàng, eSIM đã cấp, Bài viết Blog, Danh mục Blog

**Ngoài phạm vi:** không tạo role mới nào khác ngoài `admin`/`staff` đã có; không đổi luồng
đăng nhập/gate `/admin` (vẫn cho cả admin và staff vào panel, chỉ giới hạn bên trong).

## Kiến trúc

### 1. Lớp RLS (Supabase — migration `0011_staff_permission_restriction.sql`)

Đây là lớp chặn *thật sự* vì các route dùng JWT của user, không dùng service-role key.

**Hàm mới `is_admin()`** — cùng pattern `security definer` như `is_admin_or_staff()` hiện có (bắt
buộc, để tránh Postgres đệ quy re-apply RLS của chính bảng `profiles` khi hàm này query lại
`profiles` từ trong policy của chính bảng đó):

```sql
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
```

**Nhóm chặn hoàn toàn** — đổi thẳng `is_admin_or_staff()` → `is_admin()` trên policy hiện có
(không tạo mới, chỉ sửa điều kiện):
- `profiles`: policy "Admins can view all profiles" (SELECT)
- `profiles`: policy "Admins can update any profile status" (UPDATE)
- `payment_transactions`: policy "Admins can manage payment transactions" (ALL)
- `api_logs`: policy "Admins can manage api logs" (ALL)

**Sửa lỗ hổng tự nâng quyền:** trigger `profiles_freeze_privileged_columns` (đóng băng cột
`role`/`status` khi user không phải admin/staff tự sửa hồ sơ của mình) hiện exempt bất kỳ ai
`is_admin_or_staff()`. Nếu không sửa, một khi staff mất quyền admin-status ở trên, họ vẫn có thể tự
PATCH hồ sơ của chính mình (được phép qua policy "Users can update own profile" có sẵn) và lén đổi
`role`/`status` — vì trigger sẽ không còn đóng băng 2 cột đó cho họ. Đổi điều kiện exempt trong
trigger từ `is_admin_or_staff()` → `is_admin()`.

**Nhóm cho xem, chặn sửa** — tách policy `for all` hiện có thành 2 policy riêng trên từng bảng
(`categories`, `products`, `category_countries`, `physical_sim_inventory`). Postgres cho phép
nhiều permissive policy cùng OR với nhau, nên SELECT vẫn đúng cho cả 2 role qua policy view, còn
INSERT/UPDATE/DELETE chỉ còn admin qua được policy modify:

```sql
-- ví dụ với categories — lặp lại đúng pattern cho products, category_countries,
-- physical_sim_inventory (đổi policy name + table name tương ứng)
drop policy "Admins can manage categories" on public.categories;
create policy "Staff can view categories" on public.categories
  for select using (public.is_admin_or_staff());
create policy "Admins can modify categories" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());
```

**Không đổi:** `orders`, `order_items` (policy "Admins can manage orders/order items"),
`blog_categories`, `blog_posts` — giữ nguyên `is_admin_or_staff()`.

### 2. Lớp API (Next.js route handlers)

Mirror đúng quyết định RLS, chỉ đổi tham số truyền vào `requireRole()` ở từng method — không đổi
`lib/apiAuth.js` (hàm đã đủ tổng quát).

**Chặn hoàn toàn** (`requireRole(user, ['admin'])`):
- `GET /api/identity/auth/users`
- `POST /api/identity/auth/users/[id]/status`
- `GET /api/payments/admin/payments`
- `POST /api/payments/admin/payments/confirm`
- `GET /api/payments/admin/api-logs`

**Cho xem, chặn sửa** (GET giữ `['admin', 'staff']`, method khác → `['admin']`):
- `categories/route.js`: GET shared / POST admin-only
- `categories/[id]/route.js`: PUT, DELETE → admin-only
- `products/route.js`: GET shared / POST admin-only
- `products/[id]/route.js`: PUT, DELETE → admin-only
- `products/search/route.js`: GET shared
- `inventory/route.js`: GET shared
- `inventory/[id]/status/route.js`: PUT → admin-only
- `products/import`, `products/smart-import/analyze`, `products/smart-import/commit`: toàn bộ →
  admin-only. `analyze` tự nó không ghi DB, nhưng cả luồng Nhập Excel bị ẩn khỏi UI nên chặn nhất
  quán ở backend, không dựa vào frontend để giữ an toàn.

**Không đổi:** Blog (`posts`, `categories`), Orders, `products/[id]` GET nếu có, mọi route
`['admin', 'staff']` khác không liệt kê ở trên.

### 3. Lớp Frontend

**`src/admin/permissions.js`** (file mới) — nơi định nghĩa duy nhất danh sách route admin-only,
dùng chung cho cả nav filtering và safety redirect (tránh lặp danh sách 2 nơi):
```js
export const ADMIN_ONLY_ROUTES = ['users', 'payments', 'apilogs', 'catalog-import'];
export function canAccessRoute(role, route) {
  return role === 'admin' || !ADMIN_ONLY_ROUTES.includes(route);
}
```

**`AdminLayout.jsx`** — nhận thêm `role` (từ `useAuth().user.role` ở nơi gọi), lọc mảng `NAV` qua
`canAccessRoute` trước khi render — nav item admin-only mà role không phải admin thì **ẩn hẳn**
(không disable/mờ).

**`AdminApp.jsx`** — lưới an toàn dự phòng: nếu `route` hiện tại không được `canAccessRoute` cho
phép với role hiện tại, tự chuyển `route` về `'dashboard'`. Phòng trường hợp state cũ còn sót lại.

**`CategoriesPage.jsx`, `ProductsPage.jsx`, `InventoryPage.jsx`** — thêm
`const isAdmin = user?.role === 'admin'` (từ `useAuth()` đã có sẵn), bọc nút "Thêm..." đầu trang và
nút Sửa/Xoá/đổi trạng thái trên từng dòng trong `{isAdmin && (...)}`. Phần list/xem vẫn hiển thị
bình thường cho cả 2 role — chỉ ẩn phần thao tác ghi.

**Không đổi:** `BlogPostsPage`, `BlogCategoriesPage`, `BlogPostEditorPage`, `OrdersListPage`,
`EsimPage`, luồng đăng nhập/gate `/admin`.

## Kiểm thử

**Backend:** mỗi route đổi `requireRole` cần thêm test case staff → 403 (nếu trước đó staff pass)
hoặc xác nhận staff vẫn pass (route đọc không đổi). RLS không kiểm được qua unit test (mock
Supabase), nên đúng đắn của RLS được xác nhận ở bước kiểm thử thủ công (Task cuối cùng) bằng tài
khoản staff thật, đăng nhập lấy JWT thật, gọi thẳng PostgREST (không qua app) để xác nhận bị chặn ở
tầng DB thật — không chỉ tầng Next.js.

**Frontend:** test `AdminLayout` ẩn đúng nav item theo role; test 3 trang cho-xem-chặn-sửa ẩn đúng
nút mutate cho staff nhưng vẫn hiện list; test `AdminApp` tự chuyển về dashboard khi route không
hợp lệ với role hiện tại.

**Thủ công (Task cuối):** đăng nhập bằng tài khoản staff thật, xác nhận qua UI: không thấy 4 mục
nav bị ẩn; 3 trang cho-xem thấy list nhưng không thấy nút thêm/sửa/xoá; gọi trực tiếp API bị chặn
(qua devtools hoặc curl với JWT staff) trả về 403 cho các route admin-only; gọi thẳng PostgREST với
JWT staff xác nhận RLS chặn ở tầng DB. Đăng nhập lại bằng admin xác nhận không bị ảnh hưởng gì.

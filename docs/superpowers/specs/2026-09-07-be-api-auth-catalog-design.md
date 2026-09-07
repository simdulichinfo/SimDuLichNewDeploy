# BE API (Auth + Catalog công khai) — Design

## Bối cảnh

Sau khi build xong Giai đoạn 1 (Nền tảng Next.js + Supabase Auth) và thiết kế xong Giai đoạn 2
(Catalog công khai) theo hướng gộp frontend vào Next.js, quyết định đổi hướng: **giữ nguyên
frontend React + Vite cũ** (`Simdulich`), chỉ viết lại **backend** — thay cho backend Java cũ đã
mất hạ tầng (Render/Supabase/CloudAMQP cũ). `simDulichNew` (Next.js) từ nay đóng vai trò **BE
thuần** — không còn trang giao diện, chỉ expose REST API.

Toàn bộ phần logic đã xây (schema Supabase, `lib/supabase/*`, `lib/catalog.js`, dữ liệu catalog
thật đã import — xem `docs/superpowers/specs/2026-09-04-public-catalog-design.md`) được **giữ
nguyên** — chỉ thêm 1 lớp Route Handler để expose qua HTTP. Các trang Next.js đã build ở Giai
đoạn 1 (đăng nhập/đăng ký/`/account`) và phần UI Catalog (SearchBox, ProductCard...) **không còn
dùng** — vì frontend cũ (`Simdulich`) đã có sẵn UI này rồi.

**Quyết định cốt lõi:** API mới phải **khớp đúng endpoint/field** với backend Java cũ, để
frontend Vite không cần sửa code gọi API — chỉ đổi `VITE_API_BASE_URL`.

## Phạm vi

- **Đợt 1 — Auth API**: khớp `/api/identity/auth/...` cũ, dựa trên Supabase Auth + bảng
  `profiles` đã có từ Giai đoạn 1.
- **Đợt 2 — Catalog API (công khai)**: khớp `/api/catalog/catalog/...` cũ, dựa trên
  `lib/catalog.js` + schema/dữ liệu thật đã có từ Giai đoạn 2.

**Ngoài phạm vi** (để dành đợt 3, brainstorm riêng): Admin Catalog API (`/api/catalog/admin/...`
— CRUD danh mục/sản phẩm, nhập CSV/Excel thông minh, quản lý kho SIM vật lý), Order/Payment API.

## Kiến trúc & chiến lược route

`simDulichNew` giữ cấu trúc `app/api/...` (Next.js Route Handlers, không phải trang). Mỗi route
khớp **chính xác** đường dẫn mà `Simdulich/src/api/authApi.js` và `catalogAdminApi.js` đang gọi —
kể cả đoạn lặp hơi lạ `catalog/catalog/...` (di sản từ cách api-gateway cũ nối tiền tố service +
đường dẫn nội bộ controller). Nhờ vậy frontend không cần sửa 1 dòng code gọi API nào.

`VITE_API_BASE_URL` trỏ sang `https://api.simdulich.vn/api` ở production (giả định tên miền phụ
`api.simdulich.vn` — có thể đổi khi triển khai thật nếu cần) — Route Handler tương ứng nằm ở
`app/api/identity/auth/login/route.js`, `app/api/catalog/catalog/categories/route.js`, v.v.

CORS xử lý tập trung qua `headers()` trong `next.config.mjs` cho `/api/:path*`, cho phép origin
`https://simdulich.vn` (production) và `http://localhost:5173` (dev).

**Hình dạng lỗi**: `Simdulich/src/api/httpClient.js`'s `apiFetch()` đọc `data.message` từ response
lỗi để hiển thị cho người dùng (kế thừa `GlobalExceptionHandler` cũ trả `{path, status, error,
message, timestamp}`). Route Handler mới trả tối thiểu `{ message: "..." }` kèm status code phù
hợp (400/401/403/404/500) cho mọi lỗi — không cần đủ tất cả field cũ, chỉ cần `message` vì đó là
field duy nhất FE thực sự đọc.

**Triển khai**: Docker container chạy `next start` trên VPS 1Panel (cùng chỗ với frontend tĩnh),
reverse-proxy qua Nginx/OpenResty có sẵn của 1Panel sang subdomain `api.simdulich.vn`.

## Auth API (`/api/identity/auth/...`)

Dựa hoàn toàn trên Supabase Auth + bảng `profiles` (đã có từ Giai đoạn 1) — không tự viết JWT.

- `POST /api/identity/auth/register` → `supabase.auth.signUp({email, password, options: {data:
  {name, phone}}})`, trigger `handle_new_user` tự tạo `profiles`. Trả `UserResponse
  {id, name, email, phone, role, status}`, status 201.
- `POST /api/identity/auth/login` → `supabase.auth.signInWithPassword({email, password})`, join
  `profiles` lấy `role`/`status`. Trả `{accessToken, refreshToken, user}` — `accessToken` là JWT
  gốc của Supabase, FE không biết/không cần biết bên dưới là Supabase.
- `POST /api/identity/auth/refresh` → `supabase.auth.refreshSession({refresh_token:
  body.refreshToken})`, trả token mới cùng hình dạng.
- `GET /api/identity/auth/me` → đọc header `Authorization: Bearer <accessToken>`, xác thực qua
  `supabase.auth.getUser(token)`, join `profiles`, trả `UserResponse`.
- `GET /api/identity/auth/users` (chỉ admin/staff) → phân trang `profiles`, trả `{content,
  number, totalElements, totalPages}` — **field tên `number`** (không phải `page`), vì
  `authApi.js`'s `listUsersAdmin()` phía FE đọc đúng field này (khác quy ước `page` dùng ở
  catalog search).

**Xác thực dùng chung**: `lib/apiAuth.js` — đọc Bearer token → `supabase.auth.getUser(token)` →
query `profiles` lấy `role`/`status` → trả lỗi 401 (thiếu/sai token) hoặc 403 (không đủ quyền)
đúng chuẩn. Mọi route cần đăng nhập (`/me`, `/users`, và các route Catalog sau này cần quyền admin
ở đợt 3) dùng chung helper này.

## Catalog API — công khai (`/api/catalog/catalog/...`)

Map trực tiếp vào `lib/catalog.js` (đã có từ Giai đoạn 2, cần bổ sung 3 hàm mới — xem dưới):

- `GET /api/catalog/catalog/categories` → `listCategories()`
- `GET /api/catalog/catalog/min-price-by-country` → `getMinPriceByCountry()`
- `GET /api/catalog/catalog/products?categorySlug=` → `listProductsByCategory(slug)` nếu có
  `categorySlug`, ngược lại `listAllProducts()` (**hàm mới**, trả mọi sản phẩm active không lọc)
- `GET /api/catalog/catalog/products/search` → `searchProducts({...})`, đọc filter từ query
  string, trả `PagedResponse` y hệt hình dạng cũ
- `GET /api/catalog/catalog/products/by-country/{countryCode}` → `listProductsByCountry(code)`
- `GET /api/catalog/catalog/products/{slug}` → `getProductBySlug(slug)` (**hàm mới**), 404 nếu
  không tìm thấy hoặc không active
- `GET /api/catalog/catalog/products/id/{id}` → `getProductById(id)` (**hàm mới**, dùng cho tính
  năng hiện tên sản phẩm trong chi tiết đơn hàng đã làm ở phần Admin trước đó), 404 nếu không
  active

Tất cả route công khai, không cần đăng nhập, đọc qua view `products_public` (đã có RLS cho phép
đọc công khai).

## Kiểm thử

- **Tự động (Vitest)**: mock Supabase client, test từng Route Handler — đúng status code, đúng
  field trong response (đặc biệt field `number` ở `/auth/users`), đúng lỗi 401/403 khi thiếu/sai
  quyền. Test 3 hàm mới trong `lib/catalog.js` theo đúng pattern mock đã dùng ở Giai đoạn 2.
- **Thủ công**: sau khi deploy, đổi `VITE_API_BASE_URL` của bản dev cục bộ `Simdulich` sang API
  mới, chạy `npm run dev` của FE cũ, thử đăng ký/đăng nhập/xem trang chủ/`/esim`/`/esim/[country]`
  — xác nhận FE hoạt động bình thường không cần sửa code.

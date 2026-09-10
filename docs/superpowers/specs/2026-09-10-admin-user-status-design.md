# Admin User Status (Đợt 5, phần 1) — Design Spec

## Bối cảnh

Khảo sát backend Java cũ (`D:\SimDuLich\backend`) cho thấy toàn bộ REST controller thật đã được
port sang `simDulichNew`. Các phần còn lại (cấp eSIM, cập nhật vận chuyển, huỷ đơn/hoàn tiền, cổng
thanh toán khác, quản lý trạng thái user, rate-limiting) là những chức năng **chưa từng có backend
thật** ở hệ thống cũ — chỉ tồn tại dưới dạng mock ở frontend (`AdminDataContext.jsx` +
`adminSeedData.js`, một lớp localStorage-mock có trước khi có backend thật).

Đợt 5 bắt đầu với phần nhỏ nhất: **quản lý trạng thái tài khoản user (khoá/mở khoá) cho admin**.

## Phạm vi

**Trong phạm vi:**
- 1 endpoint backend mới: `POST /api/identity/auth/users/{id}/status` — admin/staff toggle trạng
  thái `active`/`banned` cho 1 user.
- Enforce trạng thái `banned` tại lớp xác thực dùng chung (`authenticate()` trong `lib/apiAuth.js`)
  và tại `login`.
- 1 migration nhỏ: thêm CHECK constraint cho `profiles.status`.
- Sửa nhỏ ở frontend (`UsersPage.jsx`): thay lời gọi mock `toggleUserStatus()` bằng gọi API thật.

**Ngoài phạm vi (để các đợt sau):**
- Cấp eSIM / gửi email, cập nhật vận chuyển/vận đơn, huỷ đơn/hoàn tiền, cổng thanh toán khác
  (Momo/VNPay/PayOS), rate-limiting cho endpoint công khai.
- Không cho phép set trạng thái tuỳ ý (không có `PATCH` với body `{status}`) — chỉ toggle, vì đó là
  đúng nhu cầu hiện tại của FE (1 nút, 1 click, lật trạng thái). Nếu tương lai cần chọn trạng thái
  cụ thể (ví dụ thêm `suspended`), sẽ thiết kế lại khi có nhu cầu thật.
- Không phân biệt quyền admin/staff khi toggle (cả hai vai trò đều toggle được, giống mọi route
  admin khác trong dự án) — không thêm luật "chỉ admin mới khoá được admin khác".

## Kiến trúc

`profiles.status` hiện là cột `text` tự do, không có CHECK constraint, và cả backend cũ và
`simDulichNew` hiện tại chỉ từng ghi giá trị `'active'`. Frontend's mock đã dùng sẵn từ vựng
`active`/`banned` (`AdminDataContext.jsx`, `StatusBadge.jsx`) — spec này giữ đúng từ vựng đó để
khớp UI hiện có mà không cần sửa hiển thị.

Vì không cần schema mới, chỉ cần thêm 1 migration nhẹ (`supabase/migrations/0009_profiles_status_check.sql`)
gắn CHECK constraint để tránh giá trị rác trong tương lai:

```sql
alter table public.profiles
  add constraint profiles_status_check check (status in ('active', 'banned'));
```

An toàn vì dữ liệu hiện tại chỉ có `'active'`.

### Toggle logic

Đặt trong `lib/adminUsers.js` (module mới, cùng phong cách với `lib/adminOrders.js`/
`lib/adminPayments.js` đã có ở đợt 4) — hàm `toggleUserStatus(supabase, {targetId, actingUserId})`:

1. Nếu `targetId === actingUserId` → trả lỗi domain 400 ("Không thể tự khoá tài khoản của chính
   mình.") — không cho tự khoá mình để tránh tự khóa ra khỏi hệ thống.
2. Tra user theo `targetId`. Không tìm thấy → trả `{data: null, error: null}` (route map thành 404).
3. Lật giá trị: `status === 'active' ? 'banned' : 'active'`.
4. `update` cột `status`, trả về row đã cập nhật map qua `mapUserResponse` (tái dùng từ
   `lib/apiAuth.js`, đã có sẵn, không viết lại).

### Route: `POST /api/identity/auth/users/{id}/status`

- `authenticate(request)` + `requireRole(user, ['admin', 'staff'])` — giống mọi route admin khác.
- Gọi `toggleUserStatus(supabase, {targetId: id, actingUserId: user.id})`.
- Map lỗi domain (tự khoá mình) → 400; not-found → 404; DB error khác → 500; thành công → 200 với
  `mapUserResponse(...)`.

### Enforce `banned` tại lớp xác thực dùng chung

**`lib/apiAuth.js`'s `authenticate(request)`** (đã có, dùng cho MỌI route yêu cầu đăng nhập): sau
khi lấy `profile` như hiện tại, thêm kiểm tra — nếu `profile.status === 'banned'`, `throw new
AuthError('Tài khoản đã bị khoá.', 403)` trước khi trả về `{user, supabase}`. Vì mọi route admin,
order, payment đều gọi `authenticate`/`optionalAuthenticate` (mà `optionalAuthenticate` lại gọi
`authenticate` khi có token), sửa 1 chỗ này áp dụng cho toàn hệ thống — không cần sửa từng route.

**`app/api/identity/auth/login/route.js`** (đã có): sau khi lấy `profile` như hiện tại (đã có bước
này để build response), thêm kiểm tra tương tự — nếu `profile.status === 'banned'`, trả
`{message: 'Tài khoản của bạn đã bị khoá.'}` với status 403, không phát `accessToken`/`refreshToken`.
Lý do tách riêng khỏi `authenticate()`: `login` chưa có token để gọi `authenticate()`, nó tự
`signInWithPassword` rồi tra `profiles` riêng — cùng logic kiểm tra nhưng đặt tại đúng nơi dữ liệu
đã có sẵn, tránh gọi trùng.

### Response shape (không đổi)

`mapUserResponse` đã có, dùng nguyên: `{id, name, email, phone, role, status}`.

## Frontend

Sửa `UsersPage.jsx` (chỉ 1 chỗ): thay `onClick={() => toggleUserStatus(u.id)}` bằng một hàm gọi
`POST /api/identity/auth/users/{u.id}/status` (thêm 1 hàm mới trong `authApi.js`, ví dụ
`toggleUserStatusAdmin(accessToken, userId)`), sau khi thành công thì cập nhật lại state của bảng
(hoặc gọi lại `listUsersAdmin`) để hiển thị đúng trạng thái mới — không còn dùng
`AdminDataContext.toggleUserStatus` (mock) cho hành động này nữa.

## Kiểm thử

- Unit test `lib/adminUsers.js`: toggle active→banned, toggle banned→active, tự khoá mình → lỗi
  400, user không tồn tại → `{data:null, error:null}`.
- Route test: 401 (không token), 403 (không phải admin/staff), 400 (tự khoá mình), 404 (không tìm
  thấy), 200 (thành công, đúng shape).
- Test `authenticate()`: profile có `status: 'banned'` → throw `AuthError` 403; `status: 'active'`
  → không ảnh hưởng (test hiện có phải vẫn pass).
- Test `login`: profile `banned` → 403, không có `accessToken` trong response.
- Kiểm thử thủ công: khoá 1 user test qua UI thật → xác nhận họ không login được (báo lỗi rõ ràng)
  → mở lại → xác nhận login lại được bình thường.

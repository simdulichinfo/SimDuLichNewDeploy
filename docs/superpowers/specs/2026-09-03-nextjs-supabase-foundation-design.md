# Nền tảng Next.js + Supabase — Design

## Bối cảnh

Dự án SimDuLich (bán eSIM/SIM du lịch) hiện có backend Java Spring Boot (5 microservice:
identity, catalog, order, payment, api-gateway) chạy trên Render, database Postgres trên
Supabase, message queue RabbitMQ trên CloudAMQP, frontend React + Vite riêng biệt gọi API qua
gateway.

Tài khoản Google dùng chung để đăng nhập Render, Supabase, và có thể cả CloudAMQP đã bị mất
quyền truy cập. Dữ liệu trong Supabase cũ đa phần là dữ liệu test, không cần khôi phục. Quyết
định: viết lại backend bằng công nghệ khác (bỏ Java), gộp luôn frontend, dùng tài khoản/hạ tầng
mới hoàn toàn.

Vì đây là viết lại toàn bộ nền tảng (không phải 1 tính năng), phạm vi được chia thành nhiều
giai đoạn độc lập, mỗi giai đoạn có spec + plan + implementation riêng:

1. **Nền tảng** (spec này) — scaffold Next.js, Supabase Auth (email/password), layout chung.
2. Catalog công khai (trang chủ, danh sách eSIM, tìm kiếm/lọc) — port từ code React hiện có.
3. Đơn hàng + Thanh toán (checkout, webhook SePay).
4. Trang Admin (danh mục/sản phẩm/kho/đơn hàng/người dùng/giao dịch).
5. Trang phụ (Blog, Hướng dẫn, Về chúng tôi, Liên hệ...).

Giai đoạn 2-5 đều phụ thuộc giai đoạn 1, nhưng độc lập với nhau — không bắt buộc làm đúng thứ
tự 2→3→4→5.

## Quyết định phạm vi (giai đoạn 1)

- **Repo mới**: `https://github.com/sangDeyiii/simDulichNew.git` (trống, vừa tạo) — toàn bộ code
  mới nằm ở đây, tách hẳn khỏi repo `Simdulich` (React+Vite) và `backend` (Java) cũ. Cục bộ nằm
  tại `D:\SimDuLich\simDulichNew`.
- **Tận dụng lại UI React hiện có** (`D:\SimDuLich\Simdulich\src`) — port component/Tailwind
  sang cấu trúc Next.js, không viết lại giao diện từ đầu.
- **JavaScript**, không dùng TypeScript — khớp với code React hiện tại đang là `.jsx`.
- **Supabase Auth** thay hẳn cho identity-service tự viết JWT — chỉ bật provider
  **email/password** ở giai đoạn này. **Google Sign-In để lại giai đoạn sau** (kế hoạch
  `2026-07-21-google-login-design.md` ở repo `Simdulich` không còn áp dụng — Supabase Auth có
  Google provider dựng sẵn, không cần tự verify ID token/tự quản `google_sub` như kế hoạch cũ).
- **Hosting**: thử trên **Vercel** (free tier) trước để có URL xem ngay. Việc trỏ domain
  `simdulich.vn` sang để sau, độc lập với việc build — chưa xác nhận được loại server đang giữ
  domain hiện tại.
- RabbitMQ/CloudAMQP không cần cho giai đoạn này (không có logic đơn hàng/thanh toán ở đây) —
  quyết định có cần lại ở giai đoạn 3 hay không (nhiều khả năng không cần nữa vì gộp về 1 app
  Next.js, luồng "thanh toán xác nhận → cập nhật đơn hàng" có thể chỉ là gọi hàm trực tiếp thay
  vì qua message broker).

## Kiến trúc

```
Trình duyệt
   │
   ▼
Next.js (App Router) — 1 app duy nhất, cả UI lẫn API route
   │  Server Components đọc session qua @supabase/ssr
   │  Middleware chặn route cần đăng nhập
   ▼
Supabase (project mới)
   ├─ Auth (email/password) — quản lý auth.users, session, cookie
   └─ Postgres — bảng profiles (id → auth.users.id) chứa role/phone/status
```

Khác với kiến trúc microservice cũ (mỗi service tự có DB, tự phát JWT, giao tiếp qua
RabbitMQ/REST nội bộ), giai đoạn này dùng 1 app Next.js duy nhất nói chuyện trực tiếp với
Supabase — không có "gateway" hay "service-to-service call" nào cả.

## Data model

Supabase Auth tự quản bảng `auth.users` (email, password hash, id — không cần đụng vào). Tạo
thêm bảng ứng dụng:

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  role text not null default 'customer',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tự tạo 1 dòng profiles mỗi khi có user mới trong auth.users (đăng ký xong là có role/status
-- ngay, không cần app tự gọi thêm 1 API tạo profile riêng).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

`name` lấy từ `raw_user_meta_data` (Supabase cho phép gửi kèm metadata tùy ý lúc gọi
`signUp()`, ví dụ `{ data: { name: "Nguyễn Văn A" } }`).

Bật **Row Level Security (RLS)** trên `profiles`:
- Mỗi user chỉ đọc/sửa được dòng `profiles` của chính mình (`id = auth.uid()`).
- Đọc dữ liệu `role='admin'` để phân trang quản trị sẽ cần policy riêng ở giai đoạn Admin (giai
  đoạn 4) — giai đoạn 1 chỉ cần user tự đọc được profile của mình.

## Cấu trúc thư mục Next.js

Port có chọn lọc, không copy nguyên xi — chỉ mang phần dùng được ngay ở giai đoạn 1:

```
simDulichNew/
├── app/
│   ├── layout.js              # Header + Footer chung, port từ Simdulich/src/App.jsx phần layout
│   ├── page.js                 # Trang chủ tạm thời (đủ để xác nhận app chạy) — nội dung đầy đủ ở giai đoạn 2
│   ├── (auth)/
│   │   ├── login/page.js       # Port UI từ Simdulich/src/user/pages/LoginPage.jsx
│   │   └── register/page.js    # Port UI từ Simdulich/src/user/pages/RegisterPage.jsx
│   └── account/page.js         # Trang xác nhận đăng nhập thành công, hiển thị role từ profiles
├── components/
│   ├── Header.jsx               # Port từ Simdulich/src/user/components/Header.jsx
│   └── Footer.jsx               # Port từ Simdulich/src/user/components/Footer.jsx
├── lib/
│   └── supabase/
│       ├── client.js            # Supabase client phía trình duyệt (createBrowserClient)
│       ├── server.js            # Supabase client phía server component (createServerClient)
│       └── middleware.js        # Helper refresh session dùng trong middleware.js gốc
├── middleware.js                # Chặn /account nếu chưa đăng nhập, redirect /login
├── tailwind.config.js           # Port từ Simdulich/tailwind.config.js
└── docs/superpowers/            # specs/ + plans/ của dự án mới
```

## Auth flow

- **Đăng ký**: form `RegisterPage` gọi `supabase.auth.signUp({ email, password, options: { data:
  { name, phone } } })` — trigger `handle_new_user` tự tạo `profiles`. Không cần bước "gọi thêm
  API tạo user" như `authApi.register` cũ.
- **Đăng nhập**: `supabase.auth.signInWithPassword({ email, password })`. Supabase tự set cookie
  session (qua `@supabase/ssr`), không cần tự quản `localStorage`/access-refresh token thủ công
  như `AuthContext` cũ.
- **Đăng xuất**: `supabase.auth.signOut()`.
- **Đọc session ở Server Component**: dùng `lib/supabase/server.js` (`createServerClient` đọc
  cookie qua `next/headers`), lấy `user` + join thêm `profiles` để biết `role`/`status`.
- **Middleware**: route `/account` (và các route cần đăng nhập ở giai đoạn sau) redirect về
  `/login` nếu không có session hợp lệ.

## Lỗi & thông báo

Message lỗi hiển thị cho user lấy trực tiếp từ `error.message` do Supabase Auth trả về (đã có
sẵn tiếng Anh, ví dụ "Invalid login credentials") — giai đoạn 1 map một số message thường gặp
sang tiếng Việt cho khớp giọng văn hiện tại của app (ví dụ "Invalid login credentials" →
"Email hoặc mật khẩu không đúng"), các lỗi khác hiển thị nguyên văn.

## Testing

- Test tích hợp bằng Vitest + React Testing Library (giữ nguyên bộ công cụ test đang dùng ở
  `Simdulich`, port `vitest.config.js` sang) — mock `lib/supabase/client.js` để test
  `LoginPage`/`RegisterPage` không cần gọi Supabase thật.
- Kiểm thử thủ công qua trình duyệt: đăng ký → tự động có `profiles` row đúng `role='customer'`
  (kiểm tra bằng Supabase Table Editor) → đăng nhập → vào `/account` thấy đúng role → đăng xuất
  → `/account` redirect về `/login`.

## Ngoài phạm vi giai đoạn 1

- Google Sign-In (giai đoạn sau, bật provider trong Supabase dashboard).
- Toàn bộ Catalog/Đơn hàng/Thanh toán/Admin (giai đoạn 2-4).
- Trỏ domain `simdulich.vn` sang Vercel (độc lập, làm khi nào xác nhận được server domain hiện
  tại là loại gì).

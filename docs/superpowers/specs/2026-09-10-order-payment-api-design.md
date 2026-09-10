# Order/Payment API (Đợt 4) — Design

## Bối cảnh

Sau đợt 3 (Admin Catalog API), `simDulichNew` cần bổ sung **Order/Payment API** để khách hàng đặt
mua sản phẩm và thanh toán được, khớp đúng hợp đồng mà frontend cũ (`Simdulich`) đã có sẵn UI
(`CheckoutPage.jsx`, `PaymentPage.jsx`, `PaymentResultPage.jsx`, các trang admin
`OrdersListPage.jsx`/`OrderDetailPage.jsx`/`PaymentsPage.jsx`).

**Khảo sát nguồn tham chiếu:** đã đọc toàn bộ `order-service`/`payment-service` trong backend Java
cũ (`D:\SimDuLich\backend`) và `Simdulich/src/api/orderApi.js`, `paymentApi.js`, các trang
checkout/thanh toán/admin liên quan. Phát hiện quan trọng: **nhiều phần trong hệ thống cũ chưa
từng được triển khai thật** (chỉ là mock localStorage phía FE), và **một vài chỗ FE gọi API mà
backend Java chưa từng có** (lỗi hợp đồng có sẵn trong hệ thống cũ, không phải tính năng để port).

## Phạm vi

**Trong phạm vi đợt 4** — chỉ phần Order + Payment đã hoạt động thật ở hệ thống cũ, cộng 3 chỗ sửa
lỗi hợp đồng FE-BE:

1. Tạo đơn hàng, tra đơn theo mã (công khai)
2. Admin xem danh sách/chi tiết đơn hàng
3. Thanh toán qua SePay (QR chuyển khoản ngân hàng + webhook xác nhận)
4. Admin xem danh sách giao dịch/log API
5. **Sửa 3 lỗi hợp đồng có sẵn:** thêm `productName` vào từng dòng sản phẩm trong đơn; thêm
   endpoint "Xác nhận thanh toán" tay cho admin; thêm bộ lọc `orderId` cho danh sách giao dịch/log

**Ngoài phạm vi** (để dành đợt sau, các phần này **chưa từng hoạt động thật** ở hệ thống cũ — chỉ
là mock/UI aspirational, không phải tính năng có sẵn để port):

- Cấp phát ICCID (SIM vật lý) cho đơn hàng — cột `reserved_order_item_id` tồn tại nhưng chưa từng
  được set ở đâu cả
- Gửi eSIM qua email cho khách — không có code gửi mail nào trong hệ thống cũ
- Cập nhật trạng thái vận chuyển/mã vận đơn sau khi tạo đơn (`shippingStatus` chỉ set 1 lần lúc tạo,
  không bao giờ chuyển tiếp)
- Huỷ đơn, hoàn tiền — không có trạng thái/endpoint nào cho việc này ở hệ thống cũ
- Rate-limit cho các endpoint công khai (đã bàn với người dùng — để dành đợt sau, không riêng phần
  thanh toán mà là khoảng trống chung của toàn dự án)
- Tích hợp cổng thanh toán thật khác ngoài SePay (Momo/VNPay/PayOS chỉ được chấp nhận ở bước validate
  `paymentMethod`, chưa từng có luồng `initiate`/webhook thật nào)

## Kiến trúc

Không có microservices/RabbitMQ như bản Java cũ — toàn bộ nằm trong `simDulichNew`, nên tạo đơn →
xác nhận thanh toán → cập nhật trạng thái đều là gọi hàm trực tiếp trong cùng process (Route Handler
gọi thẳng hàm ghi DB), không cần event queue.

**Path giữ nguyên "lặp" như cũ** để FE không cần sửa: `/api/orders/orders/...`,
`/api/payments/payments/...` (khớp đúng cách gateway cũ nối tiền tố service + path nội bộ controller).

**Phân quyền dữ liệu (RLS):**
- Bảng `orders`/`order_items`: cho phép **INSERT công khai** (khách vãng lai đặt hàng không cần
  đăng nhập, khớp `permitAll()` cũ) nhưng **không cho SELECT trực tiếp qua bảng** — tránh lộ toàn
  bộ đơn hàng nếu có ai gọi thẳng Supabase REST API bằng anon key (RLS mới là lớp bảo vệ thật, giới
  hạn chỉ ở code Route Handler không đủ). Tra đơn theo mã (`GET /orders/{orderCode}`, công khai)
  dùng **RPC `get_order_by_code()`** kiểu `security definer` (giống `min_price_by_country()` đã
  làm ở đợt 2) — trả đúng 1 đơn khớp mã, không cho phép liệt kê.
- Admin xem danh sách/chi tiết đơn + thanh toán + log: dùng token-scoped client + policy admin
  (`is_admin_or_staff()`), đúng pattern đã dùng cho toàn bộ đợt 2-3.
- Route webhook SePay: xác thực bằng API key riêng (không phải JWT user, không có "user" nào để
  scope theo RLS) → **dùng `SUPABASE_SERVICE_ROLE_KEY`** (ngoại lệ duy nhất trong dự án — mọi route
  khác trong toàn bộ hệ thống vẫn theo đúng quy tắc token-scoped/anon, không dùng service-role key).

**Bảo mật `orderCode` là "khoá truy cập"**: giống hệt mô hình hệ thống cũ — khách vãng lai không có
tài khoản, mã đơn (`SDL` + 8 ký tự ngẫu nhiên từ bảng chữ không gây nhầm lẫn 0/O, 1/I, >1 nghìn tỷ
tổ hợp) là "khoá" duy nhất để tra/thanh toán đơn của họ. `POST /payments/initiate` không lộ thêm gì
so với những gì `GET /orders/{orderCode}` đã công khai (trả tập con dữ liệu ít nhạy cảm hơn, cộng
thông tin ngân hàng của chính doanh nghiệp — vốn dĩ phải công khai để khách chuyển khoản được). Đã
xác nhận với người dùng: giữ nguyên mức bảo mật này, rate-limit để đợt sau.

## Order API

**`POST /api/orders/orders`** — công khai (JWT tuỳ chọn qua header `Authorization: Bearer`, có thì
gắn `userId`; không có vẫn tạo đơn được — khách vãng lai). Body:
```
{ custName: string, custEmail: string, custPhone: string,
  paymentMethod: "momo"|"vnpay"|"payos"|"sepay"|"cod",
  shippingMethod: "email"|"delivery", shippingAddress?: string,
  items: [{ productId: number, quantity: number }] }
```
Validate:
- `custName`/`custEmail`/`custPhone` bắt buộc không rỗng; `custEmail` đúng định dạng email.
- `items` không rỗng; mỗi `quantity` phải > 0.
- Mỗi `productId` phải tồn tại và `status="active"` — 400 nếu không.
- Nếu **bất kỳ** sản phẩm nào có `simType="physical"` → `shippingMethod` bắt buộc `"delivery"` kèm
  `shippingAddress` không rỗng; ngược lại (toàn bộ sản phẩm là `esim`) → `shippingMethod` bắt buộc
  `"email"`.
- `totalAmount` tính lại từ giá `priceBuy` hiện tại của sản phẩm trong DB tại thời điểm đặt (không
  tin giá client gửi lên — client không hề gửi giá).

Mỗi `order_item` lưu **snapshot** `productTitle` (từ `products.title`), `unitPrice` (từ
`products.price_buy`), `simType` ngay lúc tạo đơn — vừa khớp hành vi tính giá cũ (không đổi theo
giá sản phẩm về sau), vừa sửa luôn lỗi thiếu `productName` (đơn hàng cũ vẫn hiển thị đúng tên dù
sản phẩm sau này bị sửa/xoá).

Mã đơn `SDL` + 8 ký tự ngẫu nhiên từ bảng chữ `23456789ABCDEFGHJKMNPQRSTVWXYZ` (bỏ `0,1,I,L,O,U`
để tránh nhầm lẫn khi đọc/nhập tay), thử lại tối đa 5 lần nếu trùng `order_code` đã tồn tại.

`paymentStatus` mặc định `"pending"`; `shippingStatus` mặc định `"none"` (đơn `email`) hoặc
`"pending"` (đơn `delivery"`).

Trả `201` `OrderResponse`:
```
{ id, orderCode, userId, custName, custEmail, custPhone, totalAmount,
  paymentMethod, paymentStatus, shippingMethod, shippingAddress, shippingStatus,
  carrierName, trackingCode, createdAt,
  items: [{ id, productId, productName, quantity, unitPrice, simType }] }
```

**`GET /api/orders/orders/{orderCode}`** — công khai, qua RPC `get_order_by_code()`. `404` nếu
không tìm thấy. Trả đúng `OrderResponse` như trên.

**`GET /api/orders/admin/orders?page&size`** — admin/staff, phân trang **0-indexed kiểu Spring**
(field `number`, mặc định `size=20`, sắp xếp `createdAt` giảm dần — khớp đúng cách
`listOrdersAdmin()` FE cũ đã đọc). Trả `{content, number, totalElements, totalPages}` với mỗi phần
tử là `OrderSummaryResponse` (như `OrderResponse` nhưng bỏ `custPhone`, `shippingAddress`, `items`).

**`GET /api/orders/admin/orders/{id}`** — admin/staff, trả đầy đủ `OrderResponse` kèm `items[]`
(có `productName`). `404` nếu không tìm thấy.

## Payment API

**`POST /api/payments/payments/initiate`** — công khai, body `{orderCode, provider}`. Với
`provider="sepay"`: dựng URL ảnh VietQR cục bộ (không gọi API SePay nào — SePay không có API tạo
phiên thanh toán, đúng cách hệ thống cũ làm):
```
https://qr.sepay.vn/img?acc={SEPAY_ACCOUNT_NUMBER}&bank={SEPAY_BANK_NAME}&amount={totalAmount}&des={orderCode}
```
STK/tên ngân hàng/chủ tài khoản lấy từ biến môi trường (`SEPAY_ACCOUNT_NUMBER`, `SEPAY_BANK_NAME`,
`SEPAY_ACCOUNT_HOLDER`). Trả `InitiatePaymentResponse`:
```
{ orderId, orderCode, provider, amount, payUrl, providerRef, bankName, accountNumber, accountHolder }
```
`providerRef` = `orderCode` (chưa có mã giao dịch thật cho tới khi webhook báo về). 404 nếu
`orderCode` không tồn tại.

**`POST /api/payments/payments/webhook/sepay/callback`** — xác thực header
`Authorization: Apikey <SEPAY_API_KEY>` so với biến môi trường `SEPAY_API_KEY` (không hardcode giá
trị mặc định cho dev như bản cũ — đây là điểm yếu đã ghi nhận và cần sửa). Body theo đúng payload
thật của SePay:
```
{ id, gateway, transactionDate, accountNumber, code, content,
  transferType: "in"|"out", transferAmount, accumulated, referenceCode, description }
```
Chỉ xử lý `transferType="in"` (bỏ qua giao dịch ra). Trích mã đơn từ `content` bằng regex
`SDL[A-Z0-9]{8}` (không phân biệt hoa/thường). Đối chiếu `transferAmount` với `orders.total_amount`
của đơn tìm được. Nếu khớp cả mã đơn lẫn số tiền:
- Cập nhật `orders.payment_status = "paid"` (chỉ khi đang `"pending"` — idempotent, webhook gọi lại
  không xử lý lần 2).
- Ghi `payment_transactions` với `transaction_ref = "SEPAY-" + id` (unique — trùng thì bỏ qua, coi
  như đã xử lý).

Nếu không khớp (không tìm thấy mã đơn, hoặc số tiền lệch): ghi `api_logs`
(`apiType="SEPAY_WEBHOOK_UNMATCHED"`) để đối soát tay, **không có UI xử lý các log này** (giống hệ
thống cũ, ngoài phạm vi đợt này). **Luôn trả `200 {"received": true}`** kể cả khi không khớp, để
tránh SePay dội lại webhook liên tục.

**`POST /api/payments/payments/webhook/{provider}`** — mô phỏng webhook cho dev, dùng bởi nút "🧪
Giả lập đã thanh toán (dev)" ở FE (chỉ hiện khi `import.meta.env.DEV`). Body `{orderId, amount,
transactionRef}`. **Trả `404` khi `process.env.NODE_ENV === "production"`** — không xác thực gì cả
khi được phép chạy (khớp đúng hành vi cũ, chỉ giới hạn phạm vi bằng biến môi trường thay vì để lộ
trên server thật). Khi hợp lệ: đánh dấu đơn tương ứng `paid` ngay, ghi `payment_transactions`.

**`POST /api/payments/admin/payments/confirm`** — admin/staff, body `{orderCode}`. Đánh dấu đơn
`paid` ngay không cần đối chiếu số tiền/mã giao dịch gì thêm (theo yêu cầu người dùng — dùng khi
khách chuyển khoản đúng nhưng webhook không nhận diện được nội dung). Ghi 1 dòng
`payment_transactions` với `transaction_ref = "MANUAL-" + <timestamp epoch ms>`. Nếu đơn đã
`"paid"` sẵn → trả về trạng thái hiện tại luôn, không tạo thêm giao dịch trùng (idempotent). `404`
nếu không tìm thấy `orderCode`.

**`GET /api/payments/admin/payments?page&size&orderId?`** — thêm tham số lọc `orderId` tuỳ chọn
(sửa lỗi FE gọi mà backend cũ bỏ qua tham số này). Trả `{content, number, totalElements,
totalPages}`, mỗi phần tử `PaymentTransactionResponse {id, orderId, transactionRef, amount,
rawResponse, createdAt}`.

**`GET /api/payments/admin/api-logs?page&size&orderId?`** — cùng cách thêm lọc `orderId`. Trả
`ApiLogResponse {id, orderId, apiType, endpoint, requestBody, responseBody, httpStatus, createdAt}`.

## Schema

4 bảng mới:

```sql
create table public.orders (
  id bigserial primary key,
  order_code text not null unique,
  user_id uuid references auth.users(id),
  cust_name text not null,
  cust_email text not null,
  cust_phone text not null,
  total_amount numeric(15,2) not null,
  payment_method text not null check (payment_method in ('momo','vnpay','payos','sepay','cod')),
  payment_status text not null default 'pending',
  shipping_method text not null check (shipping_method in ('email','delivery')),
  shipping_address text,
  shipping_status text not null default 'none',
  carrier_name text,
  tracking_code text,
  created_at timestamptz not null default now()
);

create table public.order_items (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint not null references public.products(id),
  product_title text not null,
  quantity int not null check (quantity > 0),
  unit_price numeric(15,2) not null,
  sim_type text not null check (sim_type in ('esim','physical'))
);

create table public.payment_transactions (
  id bigserial primary key,
  order_id bigint not null references public.orders(id),
  transaction_ref text not null unique,
  amount numeric(15,2) not null,
  raw_response text,
  created_at timestamptz not null default now()
);

create table public.api_logs (
  id bigserial primary key,
  order_id bigint references public.orders(id),
  api_type text not null,
  endpoint text,
  request_body text,
  response_body text,
  http_status int,
  created_at timestamptz not null default now()
);
```

**RLS:**
- `orders`, `order_items`: policy INSERT công khai (`for insert to anon, authenticated using (true)
  with check (true)`) — cho phép đặt hàng vãng lai. Policy admin `for all` (`is_admin_or_staff()`)
  — admin/staff toàn quyền, bao gồm cả SELECT (không có policy SELECT nào khác — public không đọc
  trực tiếp qua bảng).
- `payment_transactions`, `api_logs`: chỉ policy admin `for all` (`is_admin_or_staff()`). Không có
  policy public nào — webhook ghi qua `SUPABASE_SERVICE_ROLE_KEY` (bỏ qua RLS hoàn toàn), route
  admin-confirm dùng token-scoped client qua policy admin ở trên.

**RPC tra đơn theo mã** (thay cho SELECT công khai qua bảng, tránh liệt kê toàn bộ đơn):
```sql
create or replace function public.get_order_by_code(p_order_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'id', o.id, 'orderCode', o.order_code, 'userId', o.user_id,
    'custName', o.cust_name, 'custEmail', o.cust_email, 'custPhone', o.cust_phone,
    'totalAmount', o.total_amount, 'paymentMethod', o.payment_method, 'paymentStatus', o.payment_status,
    'shippingMethod', o.shipping_method, 'shippingAddress', o.shipping_address, 'shippingStatus', o.shipping_status,
    'carrierName', o.carrier_name, 'trackingCode', o.tracking_code, 'createdAt', o.created_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', oi.id, 'productId', oi.product_id, 'productName', oi.product_title,
        'quantity', oi.quantity, 'unitPrice', oi.unit_price, 'simType', oi.sim_type
      )) from public.order_items oi where oi.order_id = o.id), '[]'::jsonb)
  ) into result
  from public.orders o
  where o.order_code = p_order_code;
  return result;
end;
$$;

grant execute on function public.get_order_by_code(text) to anon, authenticated;
```
Trả `null` (jsonb null) khi không tìm thấy — Route Handler dịch sang `404`.

## Biến môi trường mới

`SEPAY_ACCOUNT_NUMBER`, `SEPAY_BANK_NAME`, `SEPAY_ACCOUNT_HOLDER` (thông tin ngân hàng hiển thị QR),
`SEPAY_API_KEY` (xác thực webhook, không có giá trị mặc định — thiếu biến này thì route webhook
phải từ chối request thay vì dùng giá trị đoán được), `SUPABASE_SERVICE_ROLE_KEY` (chỉ dùng trong
route webhook SePay — không dùng ở bất kỳ route nào khác trong toàn dự án).

## Kiểm thử

- **Tự động (Vitest):** mock Supabase theo đúng pattern chainable đã dùng xuyên suốt dự án. Test
  từng Route Handler: đúng status code, đúng field response, đúng validate (physical→delivery,
  esim→email), đúng tính lại `totalAmount` từ DB, đúng snapshot `productTitle`/`unitPrice`, đúng
  đối chiếu webhook (khớp mã đơn + số tiền → paid; không khớp → ghi log, vẫn trả 200), đúng
  idempotent (webhook gọi lại không tạo giao dịch trùng, confirm tay không tạo trùng khi đã paid),
  đúng ẩn `/webhook/{provider}` khi `NODE_ENV=production`.
- **Thủ công:** sau khi deploy, đổi `VITE_API_BASE_URL` của FE cũ, thử luồng đặt hàng → thanh toán
  QR (dùng nút giả lập dev vì chưa có webhook SePay thật gọi vào local) → xem đơn ở trang admin →
  xác nhận thanh toán tay cho 1 đơn khác → xem danh sách giao dịch/log lọc theo `orderId`.

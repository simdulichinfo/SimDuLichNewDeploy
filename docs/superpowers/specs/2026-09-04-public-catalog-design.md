# Catalog công khai — Design

## Bối cảnh

Giai đoạn 1 (Nền tảng) đã xong: Next.js App Router + Supabase Auth, layout Header/Footer, đăng
ký/đăng nhập, `/account`. Giai đoạn này (2) xây phần catalog công khai — trang chủ, trang "Mua
eSIM" (danh sách + tìm kiếm/lọc), trang riêng từng quốc gia — port lại từ code React + backend
Java cũ (`Simdulich`/`backend/catalog-service`), nhưng thay hẳn cách lưu trữ và lọc dữ liệu.

**Vấn đề của bản cũ** (phát hiện khi khảo sát code cũ để lập spec này): `ProductService.searchPublic()`
tải **toàn bộ** category + sản phẩm cùng `sim_type` vào bộ nhớ, rồi lọc bằng string-matching/regex
trên cột text tự do `data_info` để đoán "loại gói" (cố định/theo ngày/không giới hạn) và "mức dung
lượng" — không có cột riêng, không có index cho quốc gia/loại gói/thời hạn/dung lượng.
`covered_countries` của category cũng là 1 chuỗi CSV (`"jp,kr,th"`), phải tự tách bằng code mỗi khi
cần lọc hay tính giá thấp nhất theo quốc gia.

Quyết định: làm lại đúng ngay từ đầu — cột thật, bảng quan hệ thật, lọc bằng SQL thật — thay vì
mô phỏng lại logic cũ.

## Phạm vi

- Trang chủ: Hero (ô tìm kiếm) + khối "Quốc gia phổ biến" (giá thấp nhất thật).
- `/esim`: danh sách sản phẩm đầy đủ tính năng như bản cũ — tìm kiếm, lọc quốc gia/loại gói/thời
  hạn/dung lượng/giá, sắp xếp giá tăng/giảm, phân trang 12 sản phẩm/trang, chuyển view grid/list
  (view chỉ là UI, không gọi lại API).
- `/esim/[countryCode]`: trang riêng 1 quốc gia, filter phía client (loại SIM, số ngày) như bản cũ.
- Dữ liệu mẫu: seed ~10-12 danh mục quốc gia/khu vực phổ biến, mỗi danh mục 3-4 gói, giá/tên gần
  thực tế — vì Admin (Giai đoạn 4) chưa có, không có cách nhập liệu qua UI.
- Nội dung tiếp thị tĩnh (mô tả quốc gia, FAQ, nhà mạng...) hardcode tạm, giống cách làm
  Header/Footer ở Giai đoạn 1 — chuyển thành quản lý được qua Admin ở giai đoạn sau.

**Ngoài phạm vi**: Admin quản lý danh mục/sản phẩm (Giai đoạn 4), giỏ hàng/checkout/thanh toán
(Giai đoạn 3), sản phẩm SIM vật lý còn tồn kho thật (`physical_sim_inventory` — bảng có ở bản cũ
nhưng không dùng ở giai đoạn này).

## Kiến trúc

Tiếp tục mô hình Giai đoạn 1: Server Components trong Next.js gọi thẳng Supabase, không có
"backend service" riêng. Toàn bộ query nằm trong 1 module dùng chung `lib/catalog.js` — các trang
gọi hàm từ đây, không tự viết query rải rác.

RLS bật trên `categories`/`category_countries`/`products`, cho phép đọc công khai (kể cả chưa
đăng nhập) với điều kiện `status = 'active'` (bảng `category_countries` không có cột `status`
riêng — đọc công khai không điều kiện, join sang `categories` để lọc active khi cần). Việc ghi
khoá lại — dành cho Giai đoạn 4.

## Cấu trúc dữ liệu

```sql
categories
  id            serial primary key
  name          text not null
  slug          text not null unique
  image_url     text
  status        text not null default 'active'

category_countries
  category_id   int references categories(id) on delete cascade
  country_code  text not null              -- vd 'jp', 'kr' (lowercase ISO)
  primary key (category_id, country_code)

products
  id                bigserial primary key
  category_id       int not null references categories(id)
  title             text not null
  slug              text not null unique
  sim_type          text not null check (sim_type in ('esim','physical'))
  price_buy         numeric(15,2) not null   -- giá bán cho khách
  price_import      numeric(15,2) not null   -- giá nhập, KHÔNG public
  data_info         text not null            -- text hiển thị, vd "5GB/ngày"
  duration_days     int not null
  package_type      text not null check (package_type in ('fixed','daily','unlimited'))
  capacity_bucket   text not null check (capacity_bucket in ('under-1gb','1gb','2gb','unlimited','other-fixed'))
  status            text not null default 'active'
```

Index cần có (bản cũ thiếu): `products(category_id)`, `products(sim_type, status)`,
`category_countries(country_code)` — đây chính là các cột lọc chính.

**View công khai** `products_public` — chỉ lộ cột khách cần thấy:
`id, category_id, title, slug, sim_type, price_buy, data_info, duration_days, package_type,
capacity_bucket, status`. Không có `price_import`, `id` nội bộ khác không có ở bản cũ (không có
`api_provider`/`api_package_code` — 2 cột này của bản cũ phục vụ tích hợp API nhà cung cấp, không
cần ở giai đoạn này, để lại schema `products` gốc dùng sau nếu cần chứ view public không lộ ra).
Toàn bộ trang công khai đọc qua view này, không đọc thẳng bảng `products`.

**Vì sao `category_countries` là bảng riêng chứ không phải mảng/CSV**: cần 2 việc — (a) lọc danh
mục theo 1 tập quốc gia, (b) tính giá thấp nhất theo từng quốc gia (trang chủ) — cả hai đều là
`JOIN`/`GROUP BY` SQL bình thường với bảng quan hệ, trong khi CSV hay mảng Postgres đều cần thêm
bước xử lý phức tạp hơn cho việc (b).

## Truy vấn (`lib/catalog.js`)

```js
listCategories()
listProductsByCountry(countryCode)
listProductsByCategory(categorySlug)
getMinPriceByCountry()   // GROUP BY country_code qua category_countries join products_public
searchProducts({ simType, search, countryCodes, types, durations, capacities, maxPrice, sortBy, page, size })
```

`searchProducts` — toàn bộ tiêu chí lọc dịch sang điều kiện SQL thật trên `products_public`:

- `sim_type = simType` (mặc định `'esim'`, khớp bản cũ).
- `search` → `title ilike '%...%'` HOẶC tên category chứa từ khoá (join `categories`).
- `countryCodes` (khi có) → category của sản phẩm phải khớp ít nhất 1 quốc gia trong
  `category_countries`.
- `types` → `package_type IN (...)`.
- `durations` → mỗi mốc trong `{1-5, 6-10, 11-15, 16-30, 31+}` dịch thành
  `duration_days BETWEEN x AND y` (mốc cuối là `>= 31`), nối OR giữa các mốc được chọn.
- `capacities` → `capacity_bucket IN (...)`.
- `maxPrice` (mặc định 1.000.000đ, khớp bản cũ) → `price_buy <= maxPrice`.
- `sortBy`: `price-asc` → `ORDER BY price_buy ASC`; `price-desc` → `DESC`; `default` → `ORDER BY id`.
- Phân trang: `page` 1-indexed (khớp bản cũ), `size` mặc định 12, dùng `.range()` thật của
  Supabase (LIMIT/OFFSET ở SQL, không tải hết rồi cắt trong bộ nhớ như bản cũ).
- Trả về: `{ content, page, size, totalElements, totalPages }` — giữ nguyên shape bản cũ để không
  phải sửa gì phía UI khi port component.

## Trang & route

```
app/
├── page.js                       # Trang chủ
├── esim/
│   ├── page.js                    # Danh sách + filter đầy đủ
│   └── [countryCode]/page.js      # Trang riêng 1 quốc gia (vd /esim/jp)
components/
├── catalog/
│   ├── SearchBox.jsx               # Port từ Hero.jsx phần tìm kiếm
│   ├── PopularCountries.jsx        # Port, dùng getMinPriceByCountry() thật
│   ├── ProductCard.jsx             # Port, KHÔNG còn tự đoán type/giá gốc giả — dùng package_type thật
│   ├── FilterSidebar.jsx           # Port từ phần filter của ESIMListPage.jsx
│   └── Pagination.jsx              # Port từ buildPageNumbers() của bản cũ
lib/
└── catalog.js                     # Toàn bộ query ở mục trên
```

- **Trang chủ**: Hero với ô tìm kiếm (chọn quốc gia/số ngày → điều hướng `/esim/[code]` hoặc
  `/esim?...`), khối "Quốc gia phổ biến" hiển thị giá thấp nhất thật từ `getMinPriceByCountry()`.
- **`/esim`**: sidebar filter quốc gia/loại gói/thời hạn/dung lượng/giá, ô tìm kiếm, sort giá,
  phân trang 12/trang, chuyển view grid/list. `ProductCard` không còn tự tính "giá gốc giả" để
  gạch ngang như bản cũ (`round(price*1.15/1000)*1000`) — bỏ chi tiết này, hiển thị đúng giá thật.
- **`/esim/[countryCode]`**: danh sách gói của quốc gia đó (`listProductsByCountry`), filter phía
  client (loại SIM, số ngày) — không gọi thêm API khi đổi filter này.

## Dữ liệu mẫu (seed)

File SQL seed (`supabase/migrations/0002_catalog.sql` — bảng + view, và
`supabase/seed/catalog_sample_data.sql` — dữ liệu mẫu, chạy riêng sau migration): ~10-12 danh mục
quốc gia/khu vực phổ biến (Nhật, Hàn, Thái, Đài Loan, Singapore, Mỹ, Châu Âu, combo Đông Nam Á...),
mỗi danh mục 3-4 gói eSIM đa dạng `package_type`, giá gần thực tế thị trường Việt Nam hiện tại.

## Kiểm thử

- **Tự động (Vitest)**: unit test cho từng hàm trong `lib/catalog.js` — mock Supabase client
  (`.from().select().eq()...` chain), kiểm tra query builder được gọi đúng điều kiện tương ứng
  từng bộ filter đầu vào. Theo đúng pattern mock đã dùng ở Giai đoạn 1
  (`lib/supabase/__tests__/client.test.js`).
- **Thủ công qua trình duyệt**: sau khi seed dữ liệu, duyệt `/`, `/esim` (thử từng filter + kết
  hợp nhiều filter + phân trang + sort), `/esim/jp` — so khớp kết quả với dữ liệu seed để xác
  nhận query đúng.

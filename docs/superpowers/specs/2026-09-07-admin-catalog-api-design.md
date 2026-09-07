# Admin Catalog API (Đợt 3) — Design

## Bối cảnh

Sau khi hoàn tất đợt 1+2 (Auth API + Catalog API công khai — xem
`docs/superpowers/specs/2026-09-07-be-api-auth-catalog-design.md`), `simDulichNew` cần bổ sung
**Admin Catalog API** để khớp đúng các chức năng quản trị mà frontend cũ (`Simdulich`) đã có sẵn
UI nhưng chưa có backend tương ứng: CRUD danh mục/sản phẩm, nhập file CSV/Excel (thường và
"thông minh"), quản lý kho SIM vật lý (ICCID).

Toàn bộ route nằm dưới `app/api/catalog/admin/...` (khớp path `catalog/admin/...` cũ), dùng lại
`authenticate()`/`requireRole()` từ `lib/apiAuth.js` đã có từ đợt 1+2 — mọi route trong đợt này
đều yêu cầu role `admin` hoặc `staff`.

**Khảo sát nguồn tham chiếu:** đã đọc toàn bộ `AdminCatalogController`/`ProductAdminController`/
`InventoryAdminController` và các DTO liên quan trong backend Java cũ
(`D:\SimDuLich\backend\catalog-service`), cùng `Simdulich/src/api/catalogAdminApi.js` và các trang
admin (`CategoriesPage.jsx`, `ProductsPage.jsx`, `SmartImportSection.jsx`, `InventoryPage.jsx`) để
lấy chính xác field/path/hành vi cần khớp.

## Phạm vi

Bốn nhóm chức năng, làm chung trong một spec/plan (đã xác nhận với người dùng — không tách nhỏ
hơn):

1. Category Admin API (CRUD)
2. Product Admin API (CRUD + tìm kiếm phân trang riêng cho admin)
3. Import CSV/Excel thường (không "smart")
4. Smart Import (phân tích + commit, dựa theo cấu trúc file giá thật đang dùng)
5. Quản lý kho SIM vật lý (ICCID)

**Ngoài phạm vi:** Order/Payment API (chưa thiết kế, không đụng tới ở đợt này).

## Kiến trúc & phân quyền

- Mọi route dùng `authenticate(request)` + `requireRole(user, ['admin', 'staff'])` từ
  `lib/apiAuth.js` — không viết lại logic xác thực.
- Ghi dữ liệu (INSERT/UPDATE/DELETE) qua client được gán token của người gọi
  (`createApiClient(token)`, lấy từ `authenticate()`), **không** dùng service-role key — đúng
  pattern RLS đã thống nhất ở đợt 1+2.
- **RLS mới:** `categories`, `products`, `category_countries` hiện chỉ có policy SELECT công khai
  (`status = 'active'`). Cần thêm policy INSERT/UPDATE/DELETE giới hạn cho admin/staff, dùng lại
  helper `public.is_admin_or_staff()` đã tạo ở migration `0003`.
- **Xoá dữ liệu:** hard delete (xoá thẳng), không soft-delete — khớp đúng hành vi Java cũ. Xoá
  category đang có sản phẩm tham chiếu sẽ bị Postgres chặn bởi khoá ngoại `products.category_id`
  (không có `on delete cascade`) — route trả 400 với message dễ hiểu khi bắt được lỗi ràng buộc
  này, không cần logic kiểm tra riêng.
- **Đọc Excel/CSV trong Node:** dùng thư viện `xlsx` (SheetJS) — đọc buffer từ
  `request.formData()`, không cần lưu file tạm ra đĩa.
- **Hình dạng lỗi:** giữ đúng chuẩn đã thống nhất — mọi lỗi trả tối thiểu `{ message: "..." }` kèm
  status code phù hợp (400/401/403/404/500).

## 1. Category Admin API

Route: `app/api/catalog/admin/categories/...`

- `GET /api/catalog/admin/categories` → mọi category, **không lọc status** (khác endpoint công
  khai chỉ trả `active`) → `CategoryResponse[]`.
- `POST /api/catalog/admin/categories` → body `{ name, slug, imageUrl?, status }` (name/slug/status
  bắt buộc không rỗng) → 201 `CategoryResponse`. 400 nếu `slug` đã tồn tại (bắt lỗi unique
  constraint từ Postgres). `coveredCountries` luôn `[]` khi tạo tay qua route này — trường này chỉ
  được điền tự động bởi Smart Import commit (mục 4).
- `PUT /api/catalog/admin/categories/{id}` → cùng body → `CategoryResponse`. 404 nếu không tìm
  thấy id.
- `DELETE /api/catalog/admin/categories/{id}` → 204. 400 nếu Postgres báo lỗi khoá ngoại (còn sản
  phẩm tham chiếu). 404 nếu không tìm thấy id.

`CategoryResponse`: `{ id, name, slug, imageUrl, status, coveredCountries: string[] }` — derive
`coveredCountries` từ join `category_countries` giống hàm `listCategories()` đã có ở
`lib/catalog.js`, tái dùng logic map, không viết lại.

## 2. Product Admin API

Route: `app/api/catalog/admin/products/...`

- `GET /api/catalog/admin/products` → toàn bộ sản phẩm, **không phân trang** (khớp hành vi cũ,
  dùng cho dropdown chọn sản phẩm/tính tổng ở FE) → `ProductResponse[]`.
- `GET /api/catalog/admin/products/search?categoryId=&search=&page=&size=` → **quy ước phân trang
  khác `/catalog/catalog/products/search` công khai**: `page` ở đây là **0-indexed kiểu Spring**
  (mặc định `page=0`, `size=20`), trả `{ content, number, totalElements, totalPages, size }` —
  field tên `number` (không phải `page`), khớp đúng cách `searchProductsAdmin()` ở FE cũ đọc
  `data.number`. `categoryId` lọc chính xác; `search` lọc `title` theo `ilike %search%`
  (case-insensitive), cả hai tùy chọn.
- `POST /api/catalog/admin/products` → body `{ categoryId, title, slug, simType, priceBuy,
  priceImport, dataInfo, durationDays, apiPackageCode?, status }` (mọi field trừ `apiPackageCode`
  bắt buộc; `simType` chỉ nhận `"esim"`/`"physical"`) → 201 `ProductResponse`. 400 nếu `categoryId`
  không tồn tại hoặc `slug` đã tồn tại.
- `PUT /api/catalog/admin/products/{id}` → cùng body → `ProductResponse`. 404 nếu không tìm thấy.
- `DELETE /api/catalog/admin/products/{id}` → 204. 404 nếu không tìm thấy.

`ProductResponse`: `{ id, categoryId, title, slug, simType, priceBuy, priceImport, dataInfo,
durationDays, apiPackageCode, status }` — chú ý khác `products_public` (view công khai): admin
response có thêm `priceImport`, `apiPackageCode` (không lộ ra ngoài công khai).

**Lưu ý khác biệt với `ProductRequest` gốc bên Java:** bảng `products` ở schema này có 2 cột
`package_type`/`capacity_bucket` (NOT NULL, dùng để lọc ở `/catalog/catalog/products/search` công
khai) — cột này **không tồn tại** trong schema Java gốc, là bổ sung riêng của đợt 2. `POST`/`PUT`
**không** nhận 2 field này trong body — route tự suy ra bằng cách gọi lại hàm `classify(title,
dataInfo)` (cùng hàm sẽ port ở mục 4, dùng chung, không viết trùng lặp), y hệt cách ~10.016 sản
phẩm hiện có đã được phân loại lúc nhập ban đầu.

## 3. Import CSV/Excel thường (không "smart")

`POST /api/catalog/admin/products/import` — multipart: `file` + form field `pricingMode`
(`"manual"` | `"markupPercent"` | `"daysPlusFee"`) + `markupPercent?`/`fixedFee?`.

**Cột bắt buộc theo tên header** (không theo thứ tự cột): `categorySlug, title, slug, simType,
priceImport, dataInfo, durationDays, status`. Cột `priceBuy` tùy chọn — có thì luôn dùng giá đó,
bỏ qua công thức tính.

**3 chế độ tính giá** (khi thiếu cột `priceBuy`):
- `manual` (mặc định): bắt buộc phải có `priceBuy` trong file; thiếu → dòng đó `failed`.
- `markupPercent`: `priceBuy = priceImport × (1 + markupPercent/100)`, tròn theo HALF_UP.
- `daysPlusFee`: `priceBuy = priceImport × durationDays + fixedFee`, tròn theo HALF_UP.

**Upsert theo đúng giá trị cột `slug`** trong file (không tự sinh) — có sản phẩm cùng slug thì
update, chưa có thì tạo mới (phải khớp `categorySlug` đã tồn tại — không tìm thấy category thì
dòng đó `failed`).

**Hỗ trợ cả `.csv` và `.xlsx`** — `xlsx` (SheetJS) đọc được cả hai, không cần thư viện CSV riêng.

**Trả về** `ProductImportSummary`: `{ totalRows, created, updated, failed, rows:
[{ row, slug, status: "created"|"updated"|"failed", message }] }` — mỗi dòng xử lý độc lập, một
dòng lỗi không làm hỏng cả file.

## 4. Smart Import (phân tích + commit)

Hai route dùng chung logic phân tích, khác nhau ở bước cuối (không ghi DB vs ghi DB thật):

- `POST /api/catalog/admin/products/smart-import/analyze`
- `POST /api/catalog/admin/products/smart-import/commit`

Cả hai nhận multipart giống nhau: `file` + form field tùy chọn `esimMarkupPercent` (mặc định
`30`), `physicalFixedFee` (mặc định `14000`), `physicalNoDurationMultiplier` (mặc định `2`).

### Cấu trúc file mong đợi

Đúng cấu trúc file giá thật đang dùng (`BÁO GIÁ SIM DLQT...xlsx`), **không phải** format Java cũ
(không cần parse chuỗi title ghép nhiều thông tin):

- Sheet `"eSIM prices new"` (sim_type = `esim`), `"Sim vật lý new"` (sim_type = `physical`) — dữ
  liệu từ dòng 11, cột: STT, Mã sản phẩm, Tên sản phẩm, Quốc gia/khu vực, Mô tả, Ngày sử dụng, Hạn
  chờ, Loại sản phẩm, GIÁ THU (giá nhập), BÁN LẺ Tham khảo (giá bán), Ghi chú.
- Sheet `"eSIM apn"`, `"SIM apn"` — bảng tham chiếu nhóm quốc gia (dùng để suy ra
  `category_countries` cho danh mục mới).

### Logic tái dùng từ `import_catalog.py`

Port sang JS trong file mới `lib/smartImport.js`:

- `slugify(text)` — y hệt: lowercase, thay ký tự không phải a-z0-9 bằng `-`, rút gọn `-` liên tiếp.
- `classify(title, description)` — suy ra `packageType` (`unlimited`/`daily`/`fixed`),
  `capacityBucket` (`under-1gb`/`1gb`/`2gb`/`unlimited`/`other-fixed`), `dataInfo` — y hệt logic
  regex (`DATA_AMOUNT_RE`, kiểm tra "unlimited"/"không giới hạn"/"ayce", kiểm tra `/day`/`/ngày`).
- `resolveCountries(region, apnGroupsEsim, apnGroupsSim)` — y hệt thứ tự ưu tiên: `
  DIRECT_REGION_TO_ISO` (bảng tĩnh các vùng gộp nhiều nước không mơ hồ) → `NO_COUNTRY_MAPPING`
  (bảng tĩnh các vùng chấp nhận không có mapping, trả `[]`) → cross-reference 2 sheet apn → nếu
  không khớp gì cả, trả `null` (unresolved).
- `VN_TO_ISO` — bảng 167 dòng tên quốc gia tiếng Việt → mã ISO, port y hệt.
- `buildApnCountryGroups(workbook, sheetName)` — đọc từ dòng 15, parse cấu trúc group-header +
  các dòng quốc gia con, y hệt logic Python.

**Khác với script nhập 1 lần** (`import_catalog.py` dừng hẳn — `sys.exit(1)` — khi gặp vùng không
resolve được): Smart Import **không dừng cả batch**. Vùng mới không khớp `DIRECT_REGION_TO_ISO`,
không thuộc `NO_COUNTRY_MAPPING`, không có trong 2 sheet apn → vẫn tạo danh mục mới với
`coveredCountries: []`, nhưng được đưa vào `unverifiedNewCategoryNames` để admin tự soát lại (khớp
đúng UI cảnh báo màu vàng đã có sẵn ở `SmartImportSection.jsx`).

### Giá bán

Ưu tiên dùng thẳng giá trị cột BÁN LẺ trong file khi có. Chỉ khi dòng đó **thiếu** giá trị này mới
tính theo công thức (đã xác nhận với người dùng — khác thiết kế Java gốc luôn tính bằng công thức):
- `simType == "esim"` → `priceBuy = priceImport × (1 + esimMarkupPercent/100)`, HALF_UP, `pricingRule:
  "markupPercent"`.
- `simType == "physical"` và có `durationDays` (từ cột hoặc parse được từ mô tả) → `priceBuy =
  priceImport × durationDays + physicalFixedFee`, `pricingRule: "daysPlusFee"`.
- `simType == "physical"` và không có `durationDays` → `priceBuy = priceImport ×
  physicalNoDurationMultiplier`, `pricingRule: "noDurationMultiplier"`, kèm `warning`: `"Không tìm
  thấy số ngày trong tên gói — áp dụng giá bán = giá nhập × {physicalNoDurationMultiplier}."`.
- Khi có giá trị cột BÁN LẺ → dùng thẳng, `pricingRule: "fromFile"`, không có warning.

### Slug sản phẩm

`slugify(title) + "-" + slugify(code)` khi có `code` (mã sản phẩm), ngược lại chỉ `slugify(title)`
— **y hệt** cách đã tạo slug cho ~10.016 sản phẩm hiện có trong `catalog_real_data_import.sql`.
Nhờ vậy, lần nhập tháng sau với cùng mã sản phẩm sẽ ra **đúng cùng slug** → tự động nhận diện là
**update** (giá/thời hạn thay đổi) thay vì tạo trùng sản phẩm mới.

### `POST /smart-import/analyze` — không ghi DB

Đọc file, tra `categories` (theo tên) và `products` (theo slug) hiện có trong DB để so khớp — chỉ
đọc, không ghi. Trả đúng field FE đang đọc trực tiếp (`SmartImportSection.jsx`):

```
{
  totalRows: number, esimRows: number, physicalRows: number,
  newCategoriesCount: number, newCategoryNames: string[],
  warningCount: number, errorCount: number,
  unverifiedNewCategoryNames: string[],
  rows: [{
    row: number, sheet: string, rawTitle: string,
    categoryName: string, categorySlug: string, categoryExists: boolean,
    simType: "esim"|"physical", durationDays: number|null, dataInfo: string|null,
    priceImport: number|null, priceBuy: number|null,
    pricingRule: string|null, warning: string|null, error: string|null,
  }]
}
```

Dòng lỗi (thiếu title/region, giá trị giá không hợp lệ...) có `error` chứa message, các field khác
có thể `null`, vẫn tính vào `totalRows`/`errorCount` nhưng không được đưa vào commit.

### `POST /smart-import/commit` — ghi thật

Chạy lại đúng logic phân tích ở trên, lần này ghi DB: tạo danh mục còn thiếu (kèm `category_countries`
nếu resolve được quốc gia), upsert sản phẩm theo slug (có thì `UPDATE`, chưa có thì `INSERT`). Mỗi
dòng xử lý độc lập — một dòng lỗi không làm hỏng cả batch. Bỏ qua (không ghi) các dòng đã có
`error` từ bước phân tích.

Trả `ProductImportSummary` — cùng hình dạng với import thường (mục 3): `{ totalRows, created,
updated, failed, rows: [{ row, slug, status: "created"|"updated"|"failed", message }] }`.

## 5. Quản lý kho SIM vật lý (ICCID)

Bảng mới — migration `0004_physical_sim_inventory.sql`:

```sql
create table public.physical_sim_inventory (
  id bigserial primary key,
  product_id bigint not null references public.products(id),
  iccid text not null unique,
  status text not null default 'in_stock',
  reserved_order_item_id bigint,
  imported_at timestamptz not null default now()
);

alter table public.physical_sim_inventory enable row level security;

create policy "Admins can manage inventory"
  on public.physical_sim_inventory for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());
```

`reserved_order_item_id` không có khoá ngoại — chưa có bảng đơn hàng ở hệ thống này, giữ tương tự
cách hệ thống Java cũ tách rời order-service (chỉ lưu ID, không ràng buộc DB-level).

Route: `app/api/catalog/admin/inventory/...`

- `GET /api/catalog/admin/inventory?productId=&status=` → lọc theo 0, 1, hoặc cả 2 tham số (tùy
  chọn) → `InventoryResponse[]`.
- `POST /api/catalog/admin/inventory/import` → **JSON** (không multipart) `{ productId: number,
  iccids: string[] }` → chèn ICCID mới, **tự bỏ qua lặng lẽ** (không báo lỗi) ICCID đã tồn tại
  trong DB, trả về chỉ những dòng **mới thêm** (status luôn `"in_stock"`). 400 nếu `productId`
  không tồn tại.
- `PUT /api/catalog/admin/inventory/{id}/status` → body `{ status: string }` (chuỗi tự do, không
  ràng buộc enum ở DB — giá trị dùng trong thực tế: `in_stock`/`reserved`/`sold`) → trả
  `InventoryResponse` đã update. 404 nếu không tìm thấy `id`.

`InventoryResponse`: `{ id, productId, iccid, status, reservedOrderItemId, importedAt }`.

## Kiểm thử

- **Tự động (Vitest):** mock Supabase client theo đúng pattern chainable đã dùng ở đợt 1+2. Test
  riêng `lib/smartImport.js`'s `slugify`/`classify`/`resolveCountries`/`buildApnCountryGroups`
  bằng dữ liệu mẫu nhỏ (không cần đọc file Excel thật trong unit test — dựng object workbook giả
  hoặc test qua buffer Excel nhỏ dựng bằng `xlsx` ngay trong test). Test từng Route Handler: đúng
  status code, đúng field response, đúng lỗi 401/403 khi thiếu/sai quyền, đúng hành vi phân trang
  `number` (không phải `page`) ở `/admin/products/search`.
- **Thủ công:** sau khi deploy, thử tạo/sửa/xoá category và product qua trang admin FE cũ, thử
  nhập 1 file Excel nhỏ qua cả `/admin/products/import` và luồng Smart Import (phân tích rồi
  commit), thử nhập/đổi trạng thái ICCID ở trang Kho SIM vật lý — xác nhận FE hoạt động bình
  thường không cần sửa code.

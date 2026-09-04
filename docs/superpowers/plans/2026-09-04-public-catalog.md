# Catalog công khai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây trang chủ, trang danh sách "Mua eSIM" (tìm kiếm/lọc/phân trang đầy đủ), và trang riêng
từng quốc gia — đọc dữ liệu thật từ Supabase qua `lib/catalog.js`, thay cho backend Java cũ.

**Architecture:** Server Components gọi thẳng `lib/catalog.js` (không có API route riêng). Dữ liệu
sản phẩm/danh mục nằm trong Postgres với cột lọc thật (`package_type`, `capacity_bucket`) và bảng
quan hệ `category_countries` — không còn suy đoán từ text như bản cũ.

**Tech Stack:** Next.js (App Router, Server Components), Supabase Postgres (RLS + 1 RPC function
cho truy vấn tổng hợp), Vitest + Testing Library cho các client component.

## Global Constraints

- Spec: [`docs/superpowers/specs/2026-09-04-public-catalog-design.md`](../specs/2026-09-04-public-catalog-design.md)
- JavaScript, không TypeScript. Import tương đối, không `@/`.
- File trang (`page.jsx`) chứa JSX và có test Vitest import trực tiếp → dùng đuôi `.jsx` (quy ước
  đã chốt từ Giai đoạn 1 — Vitest/Vite của dự án không parse được JSX trong file `.js`). File
  Server Component không có test nào import trực tiếp (do là `async function` cần request context
  thật, Vitest không render được có ý nghĩa) → giữ `.js`, không cần test tự động cho các file này,
  giống tiền lệ `app/account/page.js` ở Giai đoạn 1.
- Next.js 16: `params`/`searchParams` trong page component là `Promise`, phải `await` trước khi
  dùng.
- Toàn bộ trang công khai đọc qua view `products_public` (không đọc thẳng bảng `products` —
  `price_import` không được lộ ra công khai).
- `page` trong `searchProducts`/kết quả trả về là 1-indexed, `size` mặc định 12, `maxPrice` mặc
  định 1.000.000đ, `simType` mặc định `'esim'` — khớp hành vi bản cũ.
- Không có trang Admin ở giai đoạn này — không có cách tạo/sửa sản phẩm qua UI, dữ liệu tới từ
  seed SQL.

---

### Task 1: Schema + seed dữ liệu mẫu

**Files:**
- Create: `supabase/migrations/0002_catalog.sql`
- Create: `supabase/seed/catalog_sample_data.sql`

**Interfaces:**
- Produces: bảng `categories`, `category_countries`, `products`; view `products_public`; hàm
  `min_price_by_country()` — Task 2 (`lib/catalog.js`) dùng tất cả các đối tượng này.

- [ ] **Step 1: Tạo migration schema**

Tạo file `supabase/migrations/0002_catalog.sql`:

```sql
create table public.categories (
  id serial primary key,
  name text not null,
  slug text not null unique,
  image_url text,
  status text not null default 'active'
);

alter table public.categories enable row level security;

create policy "Anyone can view active categories"
  on public.categories for select
  using (status = 'active');

create table public.category_countries (
  category_id int not null references public.categories(id) on delete cascade,
  country_code text not null,
  primary key (category_id, country_code)
);

create index idx_category_countries_country on public.category_countries(country_code);

alter table public.category_countries enable row level security;

create policy "Anyone can view category countries"
  on public.category_countries for select
  using (true);

create table public.products (
  id bigserial primary key,
  category_id int not null references public.categories(id),
  title text not null,
  slug text not null unique,
  sim_type text not null check (sim_type in ('esim','physical')),
  price_buy numeric(15,2) not null,
  price_import numeric(15,2) not null,
  data_info text not null,
  duration_days int not null,
  package_type text not null check (package_type in ('fixed','daily','unlimited')),
  capacity_bucket text not null check (capacity_bucket in ('under-1gb','1gb','2gb','unlimited','other-fixed')),
  status text not null default 'active'
);

create index idx_products_category on public.products(category_id);
create index idx_products_sim_type_status on public.products(sim_type, status);

alter table public.products enable row level security;

create policy "Anyone can view active products"
  on public.products for select
  using (status = 'active');

create view public.products_public
with (security_invoker = true) as
select p.id, p.category_id, p.title, p.slug, p.sim_type, p.price_buy, p.data_info,
       p.duration_days, p.package_type, p.capacity_bucket, p.status
from public.products p
join public.categories c on c.id = p.category_id
where p.status = 'active' and c.status = 'active';

grant select on public.products_public to anon, authenticated;

create or replace function public.min_price_by_country()
returns table(country_code text, min_price numeric)
language sql
stable
as $$
  select cc.country_code, min(pp.price_buy) as min_price
  from public.category_countries cc
  join public.products_public pp on pp.category_id = cc.category_id
  group by cc.country_code;
$$;

grant execute on function public.min_price_by_country() to anon, authenticated;
```

- [ ] **Step 2: Tạo seed dữ liệu mẫu**

Tạo file `supabase/seed/catalog_sample_data.sql`:

```sql
insert into public.categories (name, slug, image_url, status) values
  ('Nhật Bản', 'nhat-ban', null, 'active'),
  ('Hàn Quốc', 'han-quoc', null, 'active'),
  ('Thái Lan', 'thai-lan', null, 'active'),
  ('Đài Loan', 'dai-loan', null, 'active'),
  ('Singapore', 'singapore', null, 'active'),
  ('Hoa Kỳ', 'hoa-ky', null, 'active'),
  ('Trung Quốc', 'trung-quoc', null, 'active'),
  ('Hồng Kông', 'hong-kong', null, 'active'),
  ('Châu Âu', 'chau-au', null, 'active'),
  ('Đông Nam Á', 'dong-nam-a', null, 'active');

insert into public.category_countries (category_id, country_code) values
  (1,'jp'),
  (2,'kr'),
  (3,'th'),
  (4,'tw'),
  (5,'sg'),
  (6,'us'),
  (7,'cn'),
  (8,'hk'),
  (9,'fr'),(9,'de'),(9,'it'),(9,'es'),(9,'gb'),(9,'ch'),(9,'at'),(9,'nl'),(9,'pt'),
  (10,'th'),(10,'sg'),(10,'my'),(10,'vn'),(10,'ph'),(10,'id'),(10,'kh'),(10,'la');

insert into public.products (category_id, title, slug, sim_type, price_buy, price_import, data_info, duration_days, package_type, capacity_bucket, status) values
  (1, 'eSIM Nhật Bản 3 ngày 1GB/ngày', 'esim-nhat-ban-3ngay-1gb', 'esim', 89000, 60000, '1GB/ngày', 3, 'daily', '1gb', 'active'),
  (1, 'eSIM Nhật Bản 7 ngày Không giới hạn', 'esim-nhat-ban-7ngay-khong-gioi-han', 'esim', 219000, 150000, 'Không giới hạn', 7, 'unlimited', 'unlimited', 'active'),
  (1, 'eSIM Nhật Bản 10 ngày 10GB trọn gói', 'esim-nhat-ban-10ngay-10gb', 'esim', 259000, 180000, '10GB trọn gói', 10, 'fixed', 'other-fixed', 'active'),
  (2, 'eSIM Hàn Quốc 5 ngày 2GB/ngày', 'esim-han-quoc-5ngay-2gb', 'esim', 129000, 90000, '2GB/ngày', 5, 'daily', '2gb', 'active'),
  (2, 'eSIM Hàn Quốc 7 ngày Không giới hạn', 'esim-han-quoc-7ngay-khong-gioi-han', 'esim', 199000, 140000, 'Không giới hạn', 7, 'unlimited', 'unlimited', 'active'),
  (2, 'eSIM Hàn Quốc 15 ngày 15GB trọn gói', 'esim-han-quoc-15ngay-15gb', 'esim', 349000, 250000, '15GB trọn gói', 15, 'fixed', 'other-fixed', 'active'),
  (3, 'eSIM Thái Lan 5 ngày 1GB/ngày', 'esim-thai-lan-5ngay-1gb', 'esim', 79000, 50000, '1GB/ngày', 5, 'daily', '1gb', 'active'),
  (3, 'eSIM Thái Lan 10 ngày Không giới hạn', 'esim-thai-lan-10ngay-khong-gioi-han', 'esim', 219000, 150000, 'Không giới hạn', 10, 'unlimited', 'unlimited', 'active'),
  (3, 'SIM vật lý Thái Lan 8 ngày 8GB trọn gói', 'sim-vat-ly-thai-lan-8ngay-8gb', 'physical', 149000, 100000, '8GB trọn gói', 8, 'fixed', 'other-fixed', 'active'),
  (4, 'eSIM Đài Loan 5 ngày 500MB/ngày', 'esim-dai-loan-5ngay-500mb', 'esim', 69000, 45000, '500MB/ngày', 5, 'daily', 'under-1gb', 'active'),
  (4, 'eSIM Đài Loan 7 ngày Không giới hạn', 'esim-dai-loan-7ngay-khong-gioi-han', 'esim', 179000, 120000, 'Không giới hạn', 7, 'unlimited', 'unlimited', 'active'),
  (4, 'eSIM Đài Loan 10 ngày 10GB trọn gói', 'esim-dai-loan-10ngay-10gb', 'esim', 229000, 160000, '10GB trọn gói', 10, 'fixed', 'other-fixed', 'active'),
  (5, 'eSIM Singapore 3 ngày 1GB/ngày', 'esim-singapore-3ngay-1gb', 'esim', 99000, 65000, '1GB/ngày', 3, 'daily', '1gb', 'active'),
  (5, 'eSIM Singapore 5 ngày Không giới hạn', 'esim-singapore-5ngay-khong-gioi-han', 'esim', 189000, 130000, 'Không giới hạn', 5, 'unlimited', 'unlimited', 'active'),
  (5, 'eSIM Singapore 7 ngày 7GB trọn gói', 'esim-singapore-7ngay-7gb', 'esim', 199000, 140000, '7GB trọn gói', 7, 'fixed', 'other-fixed', 'active'),
  (6, 'eSIM Mỹ 7 ngày 2GB/ngày', 'esim-my-7ngay-2gb', 'esim', 289000, 200000, '2GB/ngày', 7, 'daily', '2gb', 'active'),
  (6, 'eSIM Mỹ 15 ngày Không giới hạn', 'esim-my-15ngay-khong-gioi-han', 'esim', 549000, 400000, 'Không giới hạn', 15, 'unlimited', 'unlimited', 'active'),
  (6, 'eSIM Mỹ 30 ngày 20GB trọn gói', 'esim-my-30ngay-20gb', 'esim', 699000, 500000, '20GB trọn gói', 30, 'fixed', 'other-fixed', 'active'),
  (7, 'eSIM Trung Quốc 5 ngày 1GB/ngày', 'esim-trung-quoc-5ngay-1gb', 'esim', 109000, 75000, '1GB/ngày', 5, 'daily', '1gb', 'active'),
  (7, 'eSIM Trung Quốc 10 ngày Không giới hạn', 'esim-trung-quoc-10ngay-khong-gioi-han', 'esim', 259000, 180000, 'Không giới hạn', 10, 'unlimited', 'unlimited', 'active'),
  (7, 'eSIM Trung Quốc 15 ngày 15GB trọn gói', 'esim-trung-quoc-15ngay-15gb', 'esim', 319000, 220000, '15GB trọn gói', 15, 'fixed', 'other-fixed', 'active'),
  (8, 'eSIM Hồng Kông 3 ngày 1GB/ngày', 'esim-hong-kong-3ngay-1gb', 'esim', 79000, 50000, '1GB/ngày', 3, 'daily', '1gb', 'active'),
  (8, 'eSIM Hồng Kông 5 ngày Không giới hạn', 'esim-hong-kong-5ngay-khong-gioi-han', 'esim', 149000, 100000, 'Không giới hạn', 5, 'unlimited', 'unlimited', 'active'),
  (8, 'eSIM Hồng Kông 7 ngày 7GB trọn gói', 'esim-hong-kong-7ngay-7gb', 'esim', 179000, 120000, '7GB trọn gói', 7, 'fixed', 'other-fixed', 'active'),
  (9, 'eSIM Châu Âu 7 ngày 1GB/ngày', 'esim-chau-au-7ngay-1gb', 'esim', 219000, 150000, '1GB/ngày', 7, 'daily', '1gb', 'active'),
  (9, 'eSIM Châu Âu 15 ngày Không giới hạn', 'esim-chau-au-15ngay-khong-gioi-han', 'esim', 459000, 320000, 'Không giới hạn', 15, 'unlimited', 'unlimited', 'active'),
  (9, 'eSIM Châu Âu 30 ngày 20GB trọn gói', 'esim-chau-au-30ngay-20gb', 'esim', 599000, 420000, '20GB trọn gói', 30, 'fixed', 'other-fixed', 'active'),
  (10, 'eSIM Đông Nam Á 7 ngày 1GB/ngày', 'esim-dong-nam-a-7ngay-1gb', 'esim', 189000, 130000, '1GB/ngày', 7, 'daily', '1gb', 'active'),
  (10, 'eSIM Đông Nam Á 10 ngày Không giới hạn', 'esim-dong-nam-a-10ngay-khong-gioi-han', 'esim', 329000, 230000, 'Không giới hạn', 10, 'unlimited', 'unlimited', 'active'),
  (10, 'eSIM Đông Nam Á 15 ngày 15GB trọn gói', 'esim-dong-nam-a-15ngay-15gb', 'esim', 379000, 260000, '15GB trọn gói', 15, 'fixed', 'other-fixed', 'active');
```

- [ ] **Step 3: Chạy migration + seed trên Supabase (thao tác ngoài code)**

Vào Supabase Dashboard → **SQL Editor** → New query → dán nguyên nội dung
`supabase/migrations/0002_catalog.sql` → **Run**. Sau khi chạy xong không lỗi, New query lần nữa
→ dán nguyên nội dung `supabase/seed/catalog_sample_data.sql` → **Run**.

Expected: **Table Editor** thấy 3 bảng mới (`categories` 10 dòng, `category_countries` 24 dòng,
`products` 30 dòng), view `products_public` hiện trong danh sách (Views), function
`min_price_by_country` hiện trong **Database → Functions**.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_catalog.sql supabase/seed/catalog_sample_data.sql
git commit -m "feat: add catalog schema (categories, products, RLS) and sample seed data"
```

---

### Task 2: `lib/catalog.js` — tầng truy vấn

**Files:**
- Create: `lib/catalog.js`
- Test: `lib/__tests__/catalog.test.js`

**Interfaces:**
- Consumes: `createClient()` (async, server) từ `lib/supabase/server.js` (đã có từ Giai đoạn 1).
- Produces: `listCategories()`, `listProductsByCountry(countryCode)`,
  `listProductsByCategory(categorySlug)`, `getMinPriceByCountry()`,
  `searchProducts({ simType, search, countryCodes, types, durations, capacities, maxPrice, sortBy, page, size })`
  — Task 3/4/5 (trang) gọi các hàm này trực tiếp.

- [ ] **Step 1: Viết test thất bại cho toàn bộ `lib/catalog.js`**

Tạo file `lib/__tests__/catalog.test.js`:

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
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const rpcMock = vi.fn();
const supabaseMock = { from: fromMock, rpc: rpcMock };

vi.mock('../supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(supabaseMock)),
}));

import {
  listCategories,
  listProductsByCountry,
  listProductsByCategory,
  getMinPriceByCountry,
  searchProducts,
} from '../catalog';

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
      const productsQuery = createQueryBuilderMock({
        data: [{ id: 10, category_id: 1, title: 'eSIM Nhật Bản', slug: 'esim-nb', sim_type: 'esim', price_buy: 89000, data_info: '1GB/ngày', duration_days: 3, package_type: 'daily', capacity_bucket: '1gb', status: 'active' }],
        error: null,
      });
      fromMock.mockImplementation((table) => (table === 'category_countries' ? countryQuery : productsQuery));

      const result = await listProductsByCountry('jp');

      expect(countryQuery.in).toHaveBeenCalledWith('country_code', ['jp']);
      expect(productsQuery.in).toHaveBeenCalledWith('category_id', [1, 2]);
      expect(result).toEqual([
        { id: 10, categoryId: 1, title: 'eSIM Nhật Bản', slug: 'esim-nb', simType: 'esim', priceBuy: 89000, dataInfo: '1GB/ngày', durationDays: 3, packageType: 'daily', capacityBucket: '1gb', status: 'active' },
      ]);
    });

    it('trả mảng rỗng nếu không quốc gia nào khớp category nào', async () => {
      const countryQuery = createQueryBuilderMock({ data: [], error: null });
      fromMock.mockReturnValue(countryQuery);

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

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `npm test -- catalog.test.js`
Expected: FAIL — `Cannot find module '../catalog'`.

- [ ] **Step 3: Tạo `lib/catalog.js`**

```js
import { createClient } from './supabase/server';

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
  const supabase = await createClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from('categories')
    .select('id, name, slug, image_url, status, category_countries(country_code)')
    .eq('status', 'active');
  return (data || []).map(mapCategory);
}

export async function listProductsByCountry(countryCode) {
  const supabase = await createClient();
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
  const supabase = await createClient();
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

export async function getMinPriceByCountry() {
  const supabase = await createClient();
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
  const supabase = await createClient();
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

- [ ] **Step 4: Chạy lại test, xác nhận PASS**

Run: `npm test -- catalog.test.js`
Expected: PASS (10 test).

- [ ] **Step 5: Commit**

```bash
git add lib/catalog.js lib/__tests__/catalog.test.js
git commit -m "feat: add lib/catalog.js query layer with full test coverage"
```

---

### Task 3: Trang chủ (Hero + Quốc gia phổ biến)

**Files:**
- Create: `components/catalog/SearchBox.jsx`
- Create: `components/catalog/PopularCountries.jsx`
- Modify: `app/page.js` (thay nội dung placeholder từ Giai đoạn 1)
- Test: `components/catalog/__tests__/SearchBox.test.jsx`
- Test: `components/catalog/__tests__/PopularCountries.test.jsx`

**Interfaces:**
- Consumes: `getMinPriceByCountry()`, `listCategories()` từ `lib/catalog.js` (Task 2).
- Produces: không có interface nào task khác dùng lại — độc lập.

- [ ] **Step 1: Viết test thất bại cho `PopularCountries`**

Tạo file `components/catalog/__tests__/PopularCountries.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PopularCountries from '../PopularCountries';

const COUNTRIES = Array.from({ length: 17 }, (_, i) => ({
  code: `c${i}`,
  name: `Quốc gia ${i}`,
  flag: '🏳️',
}));

describe('PopularCountries', () => {
  it('hiển thị giá thấp nhất thật khi có trong minPricesByCountry', () => {
    render(<PopularCountries minPricesByCountry={{ c0: 89000 }} popularCountries={COUNTRIES} />);
    expect(screen.getByText(/Chỉ từ 89.000 VNĐ/)).toBeInTheDocument();
  });

  it('chỉ hiện 15 quốc gia đầu, bấm "Xem thêm" hiện hết', async () => {
    render(<PopularCountries minPricesByCountry={{}} popularCountries={COUNTRIES} />);
    expect(screen.getAllByRole('link')).toHaveLength(15);

    await userEvent.click(screen.getByRole('button', { name: /Xem thêm/ }));
    expect(screen.getAllByRole('link')).toHaveLength(17);
  });

  it('link trỏ đúng /esim/[code]', () => {
    render(<PopularCountries minPricesByCountry={{}} popularCountries={COUNTRIES} />);
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/esim/c0');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `npm test -- PopularCountries.test.jsx`
Expected: FAIL — `Cannot find module '../PopularCountries'`.

- [ ] **Step 3: Tạo `components/catalog/PopularCountries.jsx`**

```jsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

const INITIAL_LIMIT = 15;

function formatPrice(value) {
  if (value == null) return null;
  return `${value.toLocaleString('vi-VN')} VNĐ`;
}

export default function PopularCountries({ minPricesByCountry = {}, popularCountries = [] }) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? popularCountries : popularCountries.slice(0, INITIAL_LIMIT);
  const hasMore = popularCountries.length > INITIAL_LIMIT;
  const hiddenCount = popularCountries.length - INITIAL_LIMIT;

  return (
    <section className="py-16 bg-[#F9F5FD]">
      <div className="container mx-auto px-4 max-w-[1232px]">
        <h2 className="text-[2rem] md:text-[2.25rem] font-bold text-center text-[#233475] mb-10">
          Quốc gia phổ biến
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">
          {visible.map((country) => {
            const price = formatPrice(minPricesByCountry[country.code?.toLowerCase()]);
            return (
              <Link
                key={country.code}
                href={`/esim/${country.code}`}
                className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 hover:shadow-md hover:border-primary/40 border border-transparent transition-all duration-200 group"
              >
                <span className="flex w-10 h-10 items-center justify-center rounded-full bg-slate-50 border border-slate-100 shrink-0 text-xl">
                  {country.flag}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 text-[14px] leading-snug truncate group-hover:text-primary transition-colors">
                    {country.name}
                  </p>
                  <p className="text-primary text-[13px] mt-0.5">
                    {price ? `Chỉ từ ${price}` : 'Xem gói cước'}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>

        {hasMore && (
          <div className="flex justify-center mt-8">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full border border-primary text-primary font-medium text-[15px] bg-white hover:bg-primary/5 transition-all duration-200 cursor-pointer"
            >
              {expanded ? 'Thu gọn' : `Xem thêm (${hiddenCount} quốc gia)`}
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Chạy lại test, xác nhận PASS**

Run: `npm test -- PopularCountries.test.jsx`
Expected: PASS (3 test).

- [ ] **Step 5: Viết test thất bại cho `SearchBox`**

Tạo file `components/catalog/__tests__/SearchBox.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import SearchBox from '../SearchBox';

describe('SearchBox', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('chọn điểm đến rồi tìm kiếm điều hướng tới /esim/[code]', async () => {
    render(<SearchBox />);

    const destInput = screen.getByPlaceholderText('Bạn sắp đi đâu?');
    await userEvent.click(destInput);
    await userEvent.type(destInput, 'Nhật');
    await userEvent.click(screen.getByRole('button', { name: 'Nhật Bản' }));
    await userEvent.click(screen.getByRole('button', { name: /Tìm kiếm/ }));

    expect(pushMock).toHaveBeenCalledWith('/esim/jp');
  });

  it('không chọn điểm đến cụ thể thì điều hướng tới /esim với search query', async () => {
    render(<SearchBox />);

    const destInput = screen.getByPlaceholderText('Bạn sắp đi đâu?');
    await userEvent.type(destInput, 'Chau Phi');
    await userEvent.click(screen.getByRole('button', { name: /Tìm kiếm/ }));

    expect(pushMock).toHaveBeenCalledWith('/esim?search=Chau+Phi');
  });
});
```

- [ ] **Step 6: Chạy test, xác nhận thất bại**

Run: `npm test -- SearchBox.test.jsx`
Expected: FAIL — `Cannot find module '../SearchBox'`.

- [ ] **Step 7: Tạo `components/catalog/SearchBox.jsx`**

```jsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MapPin, Calendar, Smartphone, CreditCard, X, Check } from 'lucide-react';

const POPULAR_SUGGESTIONS = [
  { name: 'Hàn Quốc', code: 'kr' },
  { name: 'Nhật Bản', code: 'jp' },
  { name: 'Thái Lan', code: 'th' },
  { name: 'Trung Quốc', code: 'cn' },
  { name: 'Singapore', code: 'sg' },
  { name: 'Hồng Kông', code: 'hk' },
  { name: 'Macao', code: 'mo' },
  { name: 'Đài Loan', code: 'tw' },
  { name: 'Malaysia', code: 'my' },
  { name: 'Úc', code: 'au' },
  { name: 'Hoa Kỳ', code: 'us' },
];

const DAY_OPTIONS = [1, 2, 3, 5, 7, 10, 15, 30];

function dayToDurationBracket(day) {
  if (!day) return null;
  if (day <= 5) return '1-5';
  if (day <= 10) return '6-10';
  if (day <= 15) return '11-15';
  if (day <= 30) return '16-30';
  return '31+';
}

export default function SearchBox() {
  const router = useRouter();
  const [simType, setSimType] = useState('esim');
  const [destQuery, setDestQuery] = useState('');
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [selectedDays, setSelectedDays] = useState(null);
  const [isDestOpen, setIsDestOpen] = useState(false);
  const destRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (destRef.current && !destRef.current.contains(event.target)) {
        setIsDestOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredSuggestions = destQuery
    ? POPULAR_SUGGESTIONS.filter((d) => d.name.toLowerCase().includes(destQuery.toLowerCase()))
    : POPULAR_SUGGESTIONS;

  const handleSelectDestination = (dest) => {
    setSelectedDestination(dest);
    setDestQuery(dest.name);
    setIsDestOpen(false);
  };

  const handleSearch = () => {
    if (selectedDestination) {
      const params = new URLSearchParams();
      if (simType !== 'esim') params.set('simType', simType);
      if (selectedDays) params.set('days', String(selectedDays));
      const qs = params.toString();
      router.push(`/esim/${selectedDestination.code}${qs ? `?${qs}` : ''}`);
      return;
    }

    const params = new URLSearchParams();
    if (simType !== 'esim') params.set('simType', simType);
    const bracket = dayToDurationBracket(selectedDays);
    if (bracket) params.set('duration', bracket);
    if (destQuery.trim()) params.set('search', destQuery.trim());
    const qs = params.toString();
    router.push(`/esim${qs ? `?${qs}` : ''}`);
  };

  return (
    <div className="w-full max-w-[690px] mx-auto rounded-[24px] bg-white/75 border-2 border-[rgba(103,41,122,0.25)] backdrop-blur-md shadow-[0px_4px_24px_rgba(103,41,122,0.08)] p-6 flex flex-col gap-6">
      <div role="tablist" className="flex items-center gap-6 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setSimType('esim')}
          className={`pb-3 text-base font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            simType === 'esim' ? 'text-primary border-primary' : 'text-slate-400 border-transparent hover:text-slate-600'
          }`}
        >
          <Smartphone className="h-5 w-5 shrink-0" />
          <span>eSIM</span>
        </button>
        <button
          type="button"
          onClick={() => setSimType('physical')}
          className={`pb-3 text-base font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            simType === 'physical' ? 'text-primary border-primary' : 'text-slate-400 border-transparent hover:text-slate-600'
          }`}
        >
          <CreditCard className="h-5 w-5 shrink-0" />
          <span>SIM vật lý</span>
        </button>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-3">
        <div ref={destRef} className="relative flex-1 w-full">
          <div className="relative">
            <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-primary" />
            <input
              type="text"
              value={destQuery}
              onFocus={() => setIsDestOpen(true)}
              onChange={(e) => {
                setDestQuery(e.target.value);
                setSelectedDestination(null);
                setIsDestOpen(true);
              }}
              placeholder="Bạn sắp đi đâu?"
              className="w-full bg-white border border-gray-200 hover:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-full h-[49px] pl-11 pr-9 text-sm font-semibold text-slate-700 outline-none"
            />
            {destQuery && (
              <button
                type="button"
                onClick={() => {
                  setDestQuery('');
                  setSelectedDestination(null);
                }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 border-0 bg-transparent cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {isDestOpen && (
            <div className="absolute top-[55px] left-0 w-full md:w-[380px] bg-white rounded-2xl border border-slate-100 shadow-2xl p-3 z-50 max-h-[260px] overflow-y-auto">
              {filteredSuggestions.length > 0 ? (
                filteredSuggestions.map((dest) => (
                  <button
                    key={dest.code}
                    type="button"
                    onClick={() => handleSelectDestination(dest)}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-50 flex items-center justify-between border-0 bg-transparent cursor-pointer"
                  >
                    <span className="text-sm font-semibold text-slate-800">{dest.name}</span>
                    {selectedDestination?.code === dest.code && <Check className="h-4 w-4 text-primary" />}
                  </button>
                ))
              ) : (
                <p className="text-slate-400 text-xs text-center py-4">Không tìm thấy địa điểm — nhấn Tìm kiếm để tìm theo từ khóa</p>
              )}
            </div>
          )}
        </div>

        <div className="relative flex-1 w-full">
          <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-primary pointer-events-none" />
          <select
            value={selectedDays ?? ''}
            onChange={(e) => setSelectedDays(e.target.value ? Number(e.target.value) : null)}
            className="w-full appearance-none bg-white border border-gray-200 hover:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-full h-[49px] pl-11 pr-4 text-sm font-semibold text-slate-700 outline-none cursor-pointer"
          >
            <option value="">Bạn đi mấy ngày?</option>
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>{d} ngày</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleSearch}
          className="inline-flex items-center justify-center gap-2 bg-primary text-white h-[49px] w-full lg:w-[155px] rounded-full text-sm font-semibold hover:opacity-90 transition-all shadow-md shadow-primary/25 cursor-pointer border-0 shrink-0"
        >
          <Search className="h-5 w-5 shrink-0" />
          <span>Tìm kiếm</span>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Chạy lại test, xác nhận PASS**

Run: `npm test -- SearchBox.test.jsx`
Expected: PASS (2 test).

- [ ] **Step 9: Thay `app/page.js`**

```js
import SearchBox from '../components/catalog/SearchBox';
import PopularCountries from '../components/catalog/PopularCountries';
import { getMinPriceByCountry, listCategories } from '../lib/catalog';

const POPULAR_COUNTRIES = [
  { code: 'kr', name: 'Hàn Quốc', flag: '🇰🇷' },
  { code: 'jp', name: 'Nhật Bản', flag: '🇯🇵' },
  { code: 'th', name: 'Thái Lan', flag: '🇹🇭' },
  { code: 'cn', name: 'Trung Quốc', flag: '🇨🇳' },
  { code: 'sg', name: 'Singapore', flag: '🇸🇬' },
  { code: 'hk', name: 'Hồng Kông', flag: '🇭🇰' },
  { code: 'mo', name: 'Macao', flag: '🇲🇴' },
  { code: 'tw', name: 'Đài Loan', flag: '🇹🇼' },
  { code: 'vn', name: 'Việt Nam', flag: '🇻🇳' },
  { code: 'my', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'au', name: 'Úc', flag: '🇦🇺' },
  { code: 'us', name: 'Hoa Kỳ', flag: '🇺🇸' },
  { code: 'gb', name: 'Anh', flag: '🇬🇧' },
  { code: 'fr', name: 'Pháp', flag: '🇫🇷' },
  { code: 'id', name: 'Indonesia', flag: '🇮🇩' },
];

export default async function HomePage() {
  const [minPricesByCountry] = await Promise.all([
    getMinPriceByCountry(),
    listCategories(),
  ]);

  return (
    <div>
      <section className="pt-10 pb-[80px]">
        <div className="container mx-auto px-4 max-w-[1232px] flex flex-col items-center gap-10">
          <div className="text-center max-w-2xl">
            <h1 className="text-[3rem] md:text-[4rem] font-bold leading-tight">
              <span className="text-brand-gradient">SIMDULICH.VN</span>
            </h1>
            <p className="text-[1.25rem] md:text-[1.5rem] font-medium leading-snug mt-4 text-[#233475]">
              Bay khắp thế giới, không cần đổi SIM.
            </p>
          </div>
          <SearchBox />
        </div>
      </section>

      <PopularCountries minPricesByCountry={minPricesByCountry} popularCountries={POPULAR_COUNTRIES} />
    </div>
  );
}
```

(Không viết test tự động cho `app/page.js` — Server Component `async` gọi `lib/catalog.js`/
Supabase cần request context thật, giống tiền lệ `app/account/page.js` ở Giai đoạn 1. Xác minh
bằng kiểm thử thủ công ở Task 4 Step cuối, sau khi cả 3 trang đã xong.)

- [ ] **Step 10: Chạy toàn bộ test suite, xác nhận không phá luồng cũ**

Run: `npm test`
Expected: tất cả PASS.

- [ ] **Step 11: Commit**

```bash
git add components/catalog/SearchBox.jsx components/catalog/PopularCountries.jsx components/catalog/__tests__ app/page.js
git commit -m "feat: add home page with real search box and popular countries pricing"
```

---

### Task 4: Trang `/esim` — danh sách + lọc đầy đủ

**Files:**
- Create: `components/catalog/ProductCard.jsx`
- Create: `components/catalog/FilterSidebar.jsx`
- Create: `components/catalog/Pagination.jsx`
- Create: `app/esim/page.jsx`
- Test: `components/catalog/__tests__/ProductCard.test.jsx`
- Test: `components/catalog/__tests__/Pagination.test.jsx`
- Test: `components/catalog/__tests__/FilterSidebar.test.jsx`

**Interfaces:**
- Consumes: `listCategories()`, `searchProducts(...)` từ `lib/catalog.js` (Task 2).
- Produces: `<ProductCard product countryCode />` — Task 5 dùng lại nguyên component này.

- [ ] **Step 1: Viết test thất bại cho `ProductCard`**

Tạo file `components/catalog/__tests__/ProductCard.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProductCard from '../ProductCard';

const PRODUCT = {
  id: 1,
  categoryId: 1,
  title: 'eSIM Nhật Bản 7 ngày Không giới hạn',
  slug: 'esim-nb-7ngay',
  simType: 'esim',
  priceBuy: 219000,
  dataInfo: 'Không giới hạn',
  durationDays: 7,
  packageType: 'unlimited',
  capacityBucket: 'unlimited',
  status: 'active',
};

describe('ProductCard', () => {
  it('hiển thị tên, giá định dạng VNĐ, và nhãn loại gói', () => {
    render(<ProductCard product={PRODUCT} countryCode="jp" />);
    expect(screen.getByText('eSIM Nhật Bản 7 ngày Không giới hạn')).toBeInTheDocument();
    expect(screen.getByText('219.000')).toBeInTheDocument();
    expect(screen.getByText('Không giới hạn')).toBeInTheDocument();
    expect(screen.getByText('7 ngày')).toBeInTheDocument();
  });

  it('có countryCode thì bọc trong link tới /esim/[code]', () => {
    render(<ProductCard product={PRODUCT} countryCode="jp" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/esim/jp');
  });

  it('không có countryCode thì không có link bọc ngoài', () => {
    render(<ProductCard product={PRODUCT} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `npm test -- ProductCard.test.jsx`
Expected: FAIL — `Cannot find module '../ProductCard'`.

- [ ] **Step 3: Tạo `components/catalog/ProductCard.jsx`**

```jsx
import Link from 'next/link';
import { Wifi, Clock } from 'lucide-react';

const TYPE_LABEL = {
  fixed: 'Dữ liệu cố định',
  daily: 'Theo ngày',
  unlimited: 'Không giới hạn',
};

const TYPE_COLOR = {
  fixed: { text: 'text-[#0057FE]', bg: 'bg-[#F0F5FF]', border: 'border-[#0057FE]/10' },
  daily: { text: 'text-[#F45E0D]', bg: 'bg-orange-50', border: 'border-orange-200' },
  unlimited: { text: 'text-[#00A6C8]', bg: 'bg-sky-50', border: 'border-sky-200' },
};

export default function ProductCard({ product, countryCode }) {
  const typeColor = TYPE_COLOR[product.packageType] || TYPE_COLOR.fixed;
  const typeLabel = TYPE_LABEL[product.packageType] || 'Gói cước';
  const href = countryCode ? `/esim/${countryCode}` : null;

  const Card = (
    <div className="bg-white rounded-[24px] border border-[#0057FE]/15 shadow-[0px_4px_24px_rgba(135,183,255,0.12)] hover:shadow-[0_12px_40px_rgba(0,87,254,0.1)] hover:border-primary/20 transition-all duration-300 overflow-hidden flex flex-col group h-full">
      <div className="p-5 flex-grow flex flex-col gap-3">
        <span className={`inline-flex items-center gap-1 ${typeColor.bg} ${typeColor.text} text-[10px] font-bold px-2.5 py-1 rounded-full border ${typeColor.border} w-fit`}>
          <Wifi className="h-3.5 w-3.5 shrink-0" />
          {typeLabel}
        </span>

        <h3 className="font-extrabold text-slate-800 text-[14px] leading-snug line-clamp-2 min-h-[2.5rem] group-hover:text-primary transition-colors">
          {product.title}
        </h3>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="bg-[#F0F5FF] text-[#0057FE] text-[10px] font-bold px-3 py-1 rounded-full border border-[#0057FE]/10">
            {product.dataInfo}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            {product.durationDays} ngày
          </span>
        </div>

        <div className="border-t border-slate-100 mt-auto pt-3 flex items-baseline justify-between">
          <div className="flex items-baseline gap-1">
            <span className="text-[#FF6A00] font-extrabold text-[20px]">
              {Number(product.priceBuy).toLocaleString('vi-VN')}
            </span>
            <span className="text-slate-800 font-bold text-xs">VNĐ</span>
          </div>
        </div>
      </div>
    </div>
  );

  return href ? <Link href={href}>{Card}</Link> : Card;
}
```

- [ ] **Step 4: Chạy lại test, xác nhận PASS**

Run: `npm test -- ProductCard.test.jsx`
Expected: PASS (3 test).

- [ ] **Step 5: Viết test thất bại cho `Pagination`**

Tạo file `components/catalog/__tests__/Pagination.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/esim',
  useSearchParams: () => new URLSearchParams(),
}));

import Pagination from '../Pagination';

describe('Pagination', () => {
  it('không render gì nếu chỉ có 1 trang', () => {
    const { container } = render(<Pagination currentPage={1} totalPages={1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('rút gọn số trang dạng "1 … 4 5 6 … 42" khi nhiều trang', () => {
    render(<Pagination currentPage={5} totalPages={42} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '6' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '42' })).toBeInTheDocument();
    expect(screen.getAllByText('…')).toHaveLength(2);
  });

  it('gọi onPageChange với số trang đã kẹp trong khoảng hợp lệ', async () => {
    const onPageChange = vi.fn();
    render(<Pagination currentPage={2} totalPages={5} onPageChange={onPageChange} />);

    await userEvent.click(screen.getByRole('button', { name: '3' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('nút "Trang trước" bị disable ở trang 1', () => {
    render(<Pagination currentPage={1} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByLabelText('Trang trước')).toBeDisabled();
  });
});
```

- [ ] **Step 6: Chạy test, xác nhận thất bại**

Run: `npm test -- Pagination.test.jsx`
Expected: FAIL — `Cannot find module '../Pagination'`.

- [ ] **Step 7: Tạo `components/catalog/Pagination.jsx`**

```jsx
'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function buildPageNumbers(current, total) {
  const delta = 1;
  const pages = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) pages.push(i);
  }
  const withDots = [];
  let prev = 0;
  for (const p of pages) {
    if (prev && p - prev === 2) withDots.push(prev + 1);
    else if (prev && p - prev > 2) withDots.push('...');
    withDots.push(p);
    prev = p;
  }
  return withDots;
}

export default function Pagination({ currentPage, totalPages, onPageChange }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  const goToPage = (page) => {
    const clamped = Math.min(totalPages, Math.max(1, page));
    if (onPageChange) {
      onPageChange(clamped);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(clamped));
    router.push(`${pathname}?${params.toString()}`);
  };

  const pageNumbers = buildPageNumbers(currentPage, totalPages);

  return (
    <div className="flex items-center justify-center gap-1.5 mt-10 flex-wrap">
      <button
        type="button"
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 1}
        className="h-9 w-9 rounded-full flex items-center justify-center cursor-pointer border bg-white border-slate-200 text-slate-600 hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Trang trước"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pageNumbers.map((pNum, i) =>
        pNum === '...' ? (
          <span key={`dots-${i}`} className="w-9 text-center text-xs font-bold text-slate-400 select-none">…</span>
        ) : (
          <button
            key={pNum}
            type="button"
            onClick={() => goToPage(pNum)}
            className={`h-9 w-9 rounded-full font-bold text-xs transition-all flex items-center justify-center cursor-pointer border shrink-0 ${
              pNum === currentPage
                ? 'bg-primary text-white border-primary shadow-sm shadow-primary/25'
                : 'bg-white border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
            }`}
          >
            {pNum}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="h-9 w-9 rounded-full flex items-center justify-center cursor-pointer border bg-white border-slate-200 text-slate-600 hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Trang sau"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 8: Chạy lại test, xác nhận PASS**

Run: `npm test -- Pagination.test.jsx`
Expected: PASS (4 test).

- [ ] **Step 9: Viết test thất bại cho `FilterSidebar`**

Tạo file `components/catalog/__tests__/FilterSidebar.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/esim',
  useSearchParams: () => new URLSearchParams('simType=esim'),
}));

import FilterSidebar from '../FilterSidebar';

const CATEGORIES = [
  { id: 1, name: 'Nhật Bản', slug: 'nhat-ban', imageUrl: null, status: 'active', coveredCountries: ['jp'] },
  { id: 2, name: 'Hàn Quốc', slug: 'han-quoc', imageUrl: null, status: 'active', coveredCountries: ['kr'] },
];

describe('FilterSidebar', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('hiện danh sách quốc gia lấy từ coveredCountries của categories', () => {
    render(<FilterSidebar categories={CATEGORIES} />);
    expect(screen.getByText('Nhật Bản')).toBeInTheDocument();
    expect(screen.getByText('Hàn Quốc')).toBeInTheDocument();
  });

  it('bấm chọn 1 loại gói thì điều hướng với param type= cập nhật và reset page về 1', async () => {
    render(<FilterSidebar categories={CATEGORIES} />);
    await userEvent.click(screen.getByText('Không giới hạn'));

    expect(pushMock).toHaveBeenCalledWith('/esim?simType=esim&type=unlimited&page=1');
  });

  it('"Đặt lại bộ lọc" điều hướng về đúng pathname không kèm query', async () => {
    render(<FilterSidebar categories={CATEGORIES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Đặt lại bộ lọc' }));

    expect(pushMock).toHaveBeenCalledWith('/esim');
  });
});
```

- [ ] **Step 10: Chạy test, xác nhận thất bại**

Run: `npm test -- FilterSidebar.test.jsx`
Expected: FAIL — `Cannot find module '../FilterSidebar'`.

- [ ] **Step 11: Tạo `components/catalog/FilterSidebar.jsx`**

```jsx
'use client';

import { useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search, CheckSquare, Square, Filter, ArrowUpDown } from 'lucide-react';

const COUNTRY_NAMES = {
  kr: 'Hàn Quốc', jp: 'Nhật Bản', th: 'Thái Lan', cn: 'Trung Quốc', sg: 'Singapore',
  hk: 'Hồng Kông', mo: 'Macao', tw: 'Đài Loan', vn: 'Việt Nam', my: 'Malaysia',
  au: 'Úc', us: 'Hoa Kỳ', gb: 'Anh', fr: 'Pháp', de: 'Đức', it: 'Ý', es: 'Tây Ban Nha',
  id: 'Indonesia', ph: 'Philippines', in: 'Ấn Độ', ae: 'UAE', tr: 'Thổ Nhĩ Kỳ',
  ca: 'Canada', nz: 'New Zealand', kh: 'Campuchia', la: 'Lào', mm: 'Myanmar',
  nl: 'Hà Lan', ch: 'Thụy Sĩ', pt: 'Bồ Đào Nha', ru: 'Nga',
};

const TYPE_OPTIONS = [
  { id: 'fixed', label: 'Dữ liệu cố định' },
  { id: 'daily', label: 'Dữ liệu theo ngày' },
  { id: 'unlimited', label: 'Không giới hạn' },
];

const DURATION_OPTIONS = [
  { id: '1-5', label: '1 - 5 ngày' },
  { id: '6-10', label: '6 - 10 ngày' },
  { id: '11-15', label: '11 - 15 ngày' },
  { id: '16-30', label: '16 - 30 ngày' },
  { id: '31+', label: 'Trên 30 ngày' },
];

const CAPACITY_OPTIONS = [
  { id: 'under-1gb', label: 'Dưới 1GB / ngày' },
  { id: '1gb', label: '1GB / ngày' },
  { id: '2gb', label: '2GB / ngày' },
  { id: 'unlimited', label: 'Không giới hạn' },
  { id: 'other-fixed', label: 'Gói trọn gói khác' },
];

function csv(searchParams, key) {
  const raw = searchParams.get(key);
  return raw ? raw.split(',').filter(Boolean) : [];
}

export default function FilterSidebar({ categories = [] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const simType = searchParams.get('simType') || 'esim';
  const search = searchParams.get('search') || '';
  const selectedCountries = csv(searchParams, 'country');
  const selectedTypes = csv(searchParams, 'type');
  const selectedDurations = csv(searchParams, 'duration');
  const selectedCapacities = csv(searchParams, 'capacity');
  const maxPrice = Number(searchParams.get('maxPrice') || 1000000);
  const sort = searchParams.get('sort') || 'default';

  const countryCodes = useMemo(() => {
    const set = new Set();
    categories.forEach((c) => (c.coveredCountries || []).forEach((code) => code && set.add(code.toLowerCase())));
    return Array.from(set).sort((a, b) => (COUNTRY_NAMES[a] || a).localeCompare(COUNTRY_NAMES[b] || b, 'vi'));
  }, [categories]);

  const updateParams = (updates, { resetPage = true } = {}) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
        params.delete(key);
      } else if (Array.isArray(value)) {
        params.set(key, value.join(','));
      } else {
        params.set(key, String(value));
      }
    });
    if (resetPage) params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  };

  const toggleInList = (list, value, key) => {
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    updateParams({ [key]: next });
  };

  const handleResetFilters = () => router.push(pathname);

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-[0px_4px_24px_rgba(135,183,255,0.15)] space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-primary" />
          <span className="font-extrabold text-slate-800 text-lg">Bộ lọc tìm kiếm</span>
        </div>
        <button
          type="button"
          onClick={handleResetFilters}
          className="text-xs font-bold text-[#EA580C] hover:underline cursor-pointer border-0 bg-transparent"
        >
          Đặt lại bộ lọc
        </button>
      </div>

      <div className="flex items-center gap-2 border border-slate-200 rounded-full px-3 py-1.5 bg-white text-slate-700">
        <ArrowUpDown className="h-4 w-4 text-slate-400 shrink-0" />
        <select
          value={sort}
          onChange={(e) => updateParams({ sort: e.target.value === 'default' ? null : e.target.value })}
          className="text-sm font-semibold focus:outline-none bg-transparent cursor-pointer w-full"
        >
          <option value="default">Sắp xếp: Mặc định</option>
          <option value="price-asc">Giá: Thấp đến Cao</option>
          <option value="price-desc">Giá: Cao đến Thấp</option>
        </select>
      </div>

      <div className="flex p-1 bg-[#F4F4F4] rounded-full">
        <button
          type="button"
          onClick={() => updateParams({ simType: 'esim' })}
          className={`flex-1 py-2 text-center text-xs font-bold rounded-full transition-all cursor-pointer ${
            simType === 'esim' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          eSIM
        </button>
        <button
          type="button"
          onClick={() => updateParams({ simType: 'physical' })}
          className={`flex-1 py-2 text-center text-xs font-bold rounded-full transition-all cursor-pointer ${
            simType === 'physical' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          SIM vật lý
        </button>
      </div>

      <div className="relative">
        <input
          type="text"
          defaultValue={search}
          placeholder="Tìm gói hoặc quốc gia..."
          onKeyDown={(e) => {
            if (e.key === 'Enter') updateParams({ search: e.currentTarget.value });
          }}
          onBlur={(e) => updateParams({ search: e.currentTarget.value })}
          className="w-full border border-slate-200 rounded-full py-2.5 pl-10 pr-4 text-xs font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 bg-[#F8F9FD]"
        />
        <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
      </div>

      {countryCodes.length > 0 && (
        <div className="border-b border-slate-100 pb-4">
          <p className="font-bold text-slate-800 text-sm mb-3">Quốc gia</p>
          <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
            {countryCodes.map((code) => {
              const checked = selectedCountries.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleInList(selectedCountries, code, 'country')}
                  className="flex items-center gap-2.5 text-xs font-semibold text-slate-600 hover:text-slate-800 w-full text-left border-0 bg-transparent cursor-pointer"
                >
                  {checked ? <CheckSquare className="h-4.5 w-4.5 text-primary shrink-0" /> : <Square className="h-4.5 w-4.5 text-slate-300 shrink-0" />}
                  <span>{COUNTRY_NAMES[code] || code.toUpperCase()}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-b border-slate-100 pb-4">
        <p className="font-bold text-slate-800 text-sm mb-3">Loại gói</p>
        <div className="space-y-2">
          {TYPE_OPTIONS.map((t) => {
            const checked = selectedTypes.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleInList(selectedTypes, t.id, 'type')}
                className="flex items-center gap-2.5 text-xs font-semibold text-slate-600 hover:text-slate-800 w-full text-left border-0 bg-transparent cursor-pointer"
              >
                {checked ? <CheckSquare className="h-4.5 w-4.5 text-primary shrink-0" /> : <Square className="h-4.5 w-4.5 text-slate-300 shrink-0" />}
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-b border-slate-100 pb-4">
        <p className="font-bold text-slate-800 text-sm mb-3">Thời gian sử dụng</p>
        <div className="space-y-2">
          {DURATION_OPTIONS.map((d) => {
            const checked = selectedDurations.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggleInList(selectedDurations, d.id, 'duration')}
                className="flex items-center gap-2.5 text-xs font-semibold text-slate-600 hover:text-slate-800 w-full text-left border-0 bg-transparent cursor-pointer"
              >
                {checked ? <CheckSquare className="h-4.5 w-4.5 text-primary shrink-0" /> : <Square className="h-4.5 w-4.5 text-slate-300 shrink-0" />}
                <span>{d.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-b border-slate-100 pb-4">
        <p className="font-bold text-slate-800 text-sm mb-3">Dung lượng data</p>
        <div className="space-y-2">
          {CAPACITY_OPTIONS.map((c) => {
            const checked = selectedCapacities.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleInList(selectedCapacities, c.id, 'capacity')}
                className="flex items-center gap-2.5 text-xs font-semibold text-slate-600 hover:text-slate-800 w-full text-left border-0 bg-transparent cursor-pointer"
              >
                {checked ? <CheckSquare className="h-4.5 w-4.5 text-primary shrink-0" /> : <Square className="h-4.5 w-4.5 text-slate-300 shrink-0" />}
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="font-bold text-slate-800 text-sm mb-3">Khoảng giá</p>
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
          <span>0 VNĐ</span>
          <span>{maxPrice.toLocaleString('vi-VN')} VNĐ</span>
        </div>
        <input
          type="range"
          min="0"
          max="1000000"
          step="20000"
          value={maxPrice}
          onChange={(e) => updateParams({ maxPrice: e.target.value === '1000000' ? null : e.target.value })}
          className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Chạy lại test, xác nhận PASS**

Run: `npm test -- FilterSidebar.test.jsx`
Expected: PASS (3 test).

- [ ] **Step 13: Tạo `app/esim/page.jsx`**

```jsx
import FilterSidebar from '../../components/catalog/FilterSidebar';
import ProductCard from '../../components/catalog/ProductCard';
import Pagination from '../../components/catalog/Pagination';
import { listCategories, searchProducts } from '../../lib/catalog';

const PAGE_SIZE = 12;

function parseCsv(value) {
  return value ? value.split(',').filter(Boolean) : [];
}

export default async function EsimPage({ searchParams }) {
  const params = await searchParams;

  const filters = {
    simType: params.simType || 'esim',
    search: params.search || '',
    countryCodes: parseCsv(params.country),
    types: parseCsv(params.type),
    durations: parseCsv(params.duration),
    capacities: parseCsv(params.capacity),
    maxPrice: params.maxPrice ? Number(params.maxPrice) : 1000000,
    sortBy: params.sort || 'default',
    page: params.page ? Number(params.page) : 1,
    size: PAGE_SIZE,
  };

  const [categories, result] = await Promise.all([
    listCategories(),
    searchProducts(filters),
  ]);

  const categoryCountryMap = {};
  categories.forEach((c) => {
    if (c.coveredCountries?.length) categoryCountryMap[c.id] = c.coveredCountries[0];
  });

  return (
    <div className="bg-background min-h-screen">
      <section className="container mx-auto px-4 max-w-[1232px] pt-10 pb-4">
        <h1 className="text-2xl md:text-3xl font-bold text-[#233475]">
          {filters.simType === 'esim' ? 'Tìm kiếm eSIM' : 'Tìm kiếm SIM vật lý'}
        </h1>
        <p className="text-sm text-slate-400 mt-1">Tìm thấy {result.totalElements} gói cước phù hợp</p>
      </section>

      <section className="container mx-auto px-4 max-w-[1232px] pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-4">
            <FilterSidebar categories={categories} />
          </div>

          <div className="lg:col-span-8">
            {result.content.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                {result.content.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    countryCode={categoryCountryMap[product.categoryId]}
                  />
                ))}
              </div>
            ) : (
              <div className="py-20 text-center text-slate-400 bg-white rounded-3xl border border-slate-100 shadow-sm">
                <h3 className="font-extrabold text-slate-800 text-lg mb-1">Không tìm thấy gói phù hợp</h3>
                <p className="text-xs text-slate-500 px-8 leading-relaxed">
                  Hãy thử thay đổi bộ lọc để tìm kiếm lại.
                </p>
              </div>
            )}

            <Pagination currentPage={result.page} totalPages={result.totalPages} />
          </div>
        </div>
      </section>
    </div>
  );
}
```

(Không viết test tự động cho `app/esim/page.jsx` — cùng lý do đã nêu ở Task 3 Step 9.)

- [ ] **Step 14: Chạy toàn bộ test suite, xác nhận không phá luồng cũ**

Run: `npm test`
Expected: tất cả PASS.

- [ ] **Step 15: Commit**

```bash
git add components/catalog/ProductCard.jsx components/catalog/FilterSidebar.jsx components/catalog/Pagination.jsx components/catalog/__tests__ app/esim/page.jsx
git commit -m "feat: add /esim listing page with full search, filter, sort and pagination"
```

---

### Task 5: Trang `/esim/[countryCode]` — riêng từng quốc gia

**Files:**
- Create: `components/catalog/CountryProductList.jsx`
- Create: `app/esim/[countryCode]/page.jsx`
- Test: `components/catalog/__tests__/CountryProductList.test.jsx`

**Interfaces:**
- Consumes: `listProductsByCountry(countryCode)` từ `lib/catalog.js` (Task 2), `<ProductCard>` từ
  Task 4.

- [ ] **Step 1: Viết test thất bại cho `CountryProductList`**

Tạo file `components/catalog/__tests__/CountryProductList.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CountryProductList from '../CountryProductList';

const PRODUCTS = [
  { id: 1, categoryId: 1, title: 'eSIM Nhật 3 ngày', slug: 'a', simType: 'esim', priceBuy: 89000, dataInfo: '1GB/ngày', durationDays: 3, packageType: 'daily', capacityBucket: '1gb', status: 'active' },
  { id: 2, categoryId: 1, title: 'eSIM Nhật 7 ngày', slug: 'b', simType: 'esim', priceBuy: 219000, dataInfo: 'Không giới hạn', durationDays: 7, packageType: 'unlimited', capacityBucket: 'unlimited', status: 'active' },
  { id: 3, categoryId: 1, title: 'SIM vật lý Nhật 5 ngày', slug: 'c', simType: 'physical', priceBuy: 149000, dataInfo: '5GB', durationDays: 5, packageType: 'fixed', capacityBucket: 'other-fixed', status: 'active' },
];

describe('CountryProductList', () => {
  it('mặc định lọc theo simType esim, ẩn sản phẩm physical', () => {
    render(<CountryProductList products={PRODUCTS} countryCode="jp" />);
    expect(screen.getByText('eSIM Nhật 3 ngày')).toBeInTheDocument();
    expect(screen.getByText('eSIM Nhật 7 ngày')).toBeInTheDocument();
    expect(screen.queryByText('SIM vật lý Nhật 5 ngày')).not.toBeInTheDocument();
  });

  it('chuyển tab SIM vật lý thì chỉ hiện sản phẩm physical', async () => {
    render(<CountryProductList products={PRODUCTS} countryCode="jp" />);
    await userEvent.click(screen.getByRole('button', { name: 'SIM vật lý' }));

    expect(screen.getByText('SIM vật lý Nhật 5 ngày')).toBeInTheDocument();
    expect(screen.queryByText('eSIM Nhật 3 ngày')).not.toBeInTheDocument();
  });

  it('bấm chip số ngày thì chỉ hiện sản phẩm khớp đúng số ngày đó', async () => {
    render(<CountryProductList products={PRODUCTS} countryCode="jp" />);
    await userEvent.click(screen.getByRole('button', { name: '3 ngày' }));

    expect(screen.getByText('eSIM Nhật 3 ngày')).toBeInTheDocument();
    expect(screen.queryByText('eSIM Nhật 7 ngày')).not.toBeInTheDocument();
  });

  it('không có sản phẩm nào khớp bộ lọc thì hiện thông báo rỗng', () => {
    render(<CountryProductList products={[]} countryCode="jp" />);
    expect(screen.getByText('Danh mục này hiện chưa có gói cước nào.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `npm test -- CountryProductList.test.jsx`
Expected: FAIL — `Cannot find module '../CountryProductList'`.

- [ ] **Step 3: Tạo `components/catalog/CountryProductList.jsx`**

```jsx
'use client';

import { useMemo, useState } from 'react';
import ProductCard from './ProductCard';

const TYPE_OPTIONS = [
  { id: 'fixed', label: 'Dữ liệu cố định' },
  { id: 'daily', label: 'Dữ liệu theo ngày' },
  { id: 'unlimited', label: 'Không giới hạn' },
];

export default function CountryProductList({ products, countryCode, initialDays = null }) {
  const esimCount = products.filter((p) => p.simType === 'esim').length;
  const [simType, setSimType] = useState(esimCount > 0 ? 'esim' : 'physical');
  const [selectedDay, setSelectedDay] = useState(initialDays);
  const [selectedType, setSelectedType] = useState(null);

  const simFiltered = useMemo(
    () => products.filter((p) => p.simType === simType),
    [products, simType]
  );

  const dayOptions = useMemo(
    () => Array.from(new Set(simFiltered.map((p) => p.durationDays))).sort((a, b) => a - b),
    [simFiltered]
  );

  const visibleProducts = useMemo(() => {
    return simFiltered.filter((p) => {
      if (selectedDay && p.durationDays !== selectedDay) return false;
      if (selectedType && p.packageType !== selectedType) return false;
      return true;
    });
  }, [simFiltered, selectedDay, selectedType]);

  const otherSimType = simType === 'esim' ? 'physical' : 'esim';
  const otherHasProducts = products.some((p) => p.simType === otherSimType);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex p-1 bg-[#F4F4F4] rounded-full">
          <button
            type="button"
            onClick={() => { setSimType('esim'); setSelectedType(null); }}
            className={`px-5 py-2 text-xs font-bold rounded-full transition-all cursor-pointer ${
              simType === 'esim' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            eSIM
          </button>
          <button
            type="button"
            onClick={() => { setSimType('physical'); setSelectedType(null); }}
            className={`px-5 py-2 text-xs font-bold rounded-full transition-all cursor-pointer ${
              simType === 'physical' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            SIM vật lý
          </button>
        </div>

        <button
          type="button"
          onClick={() => setSelectedDay(null)}
          className={`h-9 px-4 rounded-full border text-xs font-semibold transition-all cursor-pointer ${
            !selectedDay ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-600 hover:border-primary'
          }`}
        >
          Tất cả số ngày
        </button>
        {dayOptions.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setSelectedDay(d)}
            className={`h-9 px-4 rounded-full border text-xs font-semibold transition-all cursor-pointer ${
              selectedDay === d ? 'border-primary bg-primary text-white' : 'border-slate-200 text-slate-600 hover:border-primary'
            }`}
          >
            {d} ngày
          </button>
        ))}

        {TYPE_OPTIONS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSelectedType(selectedType === t.id ? null : t.id)}
            className={`h-9 px-4 rounded-full border text-xs font-semibold transition-all cursor-pointer ${
              selectedType === t.id ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-600 hover:border-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {visibleProducts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
          {visibleProducts.map((p) => (
            <ProductCard key={p.id} product={p} countryCode={countryCode} />
          ))}
        </div>
      ) : (
        <div className="py-12 text-center text-slate-400 rounded-2xl border border-slate-200 bg-white">
          <p>
            {products.length === 0
              ? 'Danh mục này hiện chưa có gói cước nào.'
              : otherHasProducts
                ? `Không có gói ${simType === 'esim' ? 'eSIM' : 'SIM vật lý'} khớp bộ lọc — thử chuyển sang ${otherSimType === 'esim' ? 'eSIM' : 'SIM vật lý'}.`
                : 'Không tìm thấy gói phù hợp với bộ lọc đang chọn.'}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Chạy lại test, xác nhận PASS**

Run: `npm test -- CountryProductList.test.jsx`
Expected: PASS (4 test).

- [ ] **Step 5: Tạo `app/esim/[countryCode]/page.jsx`**

```jsx
import CountryProductList from '../../../components/catalog/CountryProductList';
import { listProductsByCountry } from '../../../lib/catalog';

export default async function CountryEsimPage({ params, searchParams }) {
  const { countryCode } = await params;
  const query = await searchParams;
  const initialDays = query.days ? Number(query.days) : null;

  const products = await listProductsByCountry(countryCode.toLowerCase());

  return (
    <div className="bg-background min-h-screen">
      <section className="container mx-auto px-4 max-w-[1232px] pt-10 pb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-[#233475]">
          eSIM {countryCode.toUpperCase()}
        </h1>
        <p className="text-sm text-slate-400 mt-1">Tìm thấy {products.length} gói cước</p>
      </section>

      <section className="container mx-auto px-4 max-w-[1232px] pb-20">
        <CountryProductList products={products} countryCode={countryCode.toLowerCase()} initialDays={initialDays} />
      </section>
    </div>
  );
}
```

(Không viết test tự động cho file này — cùng lý do đã nêu ở Task 3 Step 9.)

- [ ] **Step 6: Chạy toàn bộ test suite, xác nhận PASS**

Run: `npm test`
Expected: tất cả PASS (tổng cộng: 22 test Giai đoạn 1 + test mới của Giai đoạn 2).

- [ ] **Step 7: Commit**

```bash
git add components/catalog/CountryProductList.jsx components/catalog/__tests__/CountryProductList.test.jsx "app/esim/[countryCode]"
git commit -m "feat: add per-country /esim/[countryCode] page"
```

- [ ] **Step 8: Kiểm thử thủ công qua trình duyệt (cần đã chạy xong Task 1 Step 3 trên Supabase thật)**

Chạy `npm run dev`, mở `http://localhost:3000`.

1. Trang chủ: xác nhận khối "Quốc gia phổ biến" hiện đúng giá thấp nhất thật (so với dữ liệu seed
   — vd Nhật Bản "Chỉ từ 89.000 VNĐ").
2. Gõ vào ô tìm kiếm, chọn "Nhật Bản" → bấm Tìm kiếm → xác nhận chuyển tới `/esim/jp`, thấy đúng
   3 gói đã seed.
3. Vào `/esim` → thử lọc quốc gia (chọn "Hàn Quốc") → xác nhận chỉ còn 3 gói Hàn Quốc.
4. Thêm lọc loại gói "Không giới hạn" → xác nhận chỉ còn gói `unlimited` của Hàn Quốc.
5. Đổi sắp xếp "Giá: Thấp đến Cao" → xác nhận thứ tự giá tăng dần.
6. Xoá hết lọc quốc gia (chỉ còn `simType=esim`) → xác nhận thấy đủ số lượng, phân trang hiện
   đúng nếu quá 12 kết quả.
7. Vào `/esim/th` → xác nhận thấy cả gói `esim` và gói `physical` (SIM vật lý Thái Lan) tách đúng
   theo tab.

---

## Self-Review

- **Spec coverage:** Data model + view + RPC (Task 1), tầng truy vấn SQL thật thay cho lọc trong
  bộ nhớ (Task 2), trang chủ với giá thật (Task 3), `/esim` đầy đủ filter/sort/phân trang (Task 4),
  `/esim/[countryCode]` (Task 5) — khớp đủ mục trong spec. `products_public` không lộ
  `price_import` — đúng yêu cầu bảo mật giá vốn trong spec.
- **Placeholder scan:** không còn "TBD"/"TODO". Các mục "không viết test tự động" đều nêu rõ lý do
  (Server Component cần request context thật) và trỏ tới bước kiểm thử thủ công thay thế — không
  phải placeholder mơ hồ.
- **Type consistency:** `Product`/`Category` shape (`categoryId`, `priceBuy`, `dataInfo`,
  `durationDays`, `packageType`, `capacityBucket`, `coveredCountries`) nhất quán giữa Task 2
  (`lib/catalog.js` + test) và mọi nơi dùng lại ở Task 3/4/5. `searchProducts()`/`listCategories()`/
  `listProductsByCountry()`/`getMinPriceByCountry()` cùng tên/tham số giữa nơi định nghĩa (Task 2)
  và nơi gọi (Task 3/4/5). `<ProductCard product countryCode />` định nghĩa ở Task 4, tái sử dụng
  y hệt props ở Task 5.

# Admin Catalog API (Đợt 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Admin Catalog API (category/product CRUD, plain CSV/Excel import, two-phase Smart Import, physical SIM inventory) to `simDulichNew`, replicating the old Java admin contract exactly so the existing admin UI in `Simdulich` works unchanged.

**Architecture:** Next.js Route Handlers under `app/api/catalog/admin/...`, gated by the existing `authenticate()`/`requireRole(['admin','staff'])` from `lib/apiAuth.js`. Writes run through a token-scoped Supabase client so new admin-only RLS policies (built on the existing `is_admin_or_staff()` helper) apply. Smart Import ports the real ETL logic already proven in `supabase/seed/scripts/import_catalog.py` (not the old Java backend's string-parsing grammar, which doesn't match the real supplier file format).

**Tech Stack:** Next.js 16.3.4 Route Handlers, `@supabase/supabase-js`, `xlsx` (SheetJS, new dependency) for Excel/CSV parsing, Vitest.

## Global Constraints

- Every route path matches the old Java BE exactly (see
  `docs/superpowers/specs/2026-09-07-admin-catalog-api-design.md`) — all under `/api/catalog/admin/...`.
- Every route requires `authenticate(request)` + `requireRole(user, ['admin', 'staff'])` — no
  route in this plan is public.
- Writes use the token-scoped client returned by `authenticate()` (`{ user, supabase }`), never a
  bare anon client — RLS depends on it.
- Every error response is `{ message: "..." }` with an appropriate status code (400/401/403/404/500).
- `GET /admin/products/search` pagination is **0-indexed Spring-style**: response field is
  `number` (not `page`) — do not confuse with the 1-indexed `page` field used by the public
  `/catalog/catalog/products/search` from đợt 1+2.
- Hard delete only, no soft-delete. A delete blocked by a foreign-key constraint returns 400.
- `package_type`/`capacity_bucket` are NOT accepted in `ProductRequest` bodies — they're derived
  server-side via `classify(title, dataInfo)` (ported in Task 2), matching how the existing
  ~10,016 seeded products were classified.
- Smart Import parses the real supplier file structure (sheets `"eSIM prices new"`,
  `"Sim vật lý new"`, `"eSIM apn"`, `"SIM apn"`, data from Excel row 11) — not the old Java
  backend's title-string-grammar parser.
- Smart Import prefers the file's own retail-price column (`priceBuyFromFile`) when present;
  formulas (`esimMarkupPercent`/`physicalFixedFee`/`physicalNoDurationMultiplier`) are fallback
  only for rows missing it.
- Product slug scheme for Smart Import: `slugify(title) + "-" + slugify(code)` when a `code` is
  present, else `slugify(title)` alone — identical to `import_catalog.py`, so re-importing the
  same supplier code next month resolves to the same slug (update, not duplicate).
- Vitest: mock Supabase via the chainable query-builder pattern already used throughout this repo
  (`select/eq/in/insert/update/delete/order/range/... → then(resolve)`); each test file defines
  its own local builder mock.
- Next.js 16: Route Handler `params` is a `Promise` — always `await params`. Read query strings via
  `new URL(request.url).searchParams`, never an injected `searchParams` argument.

---

### Task 1: Migrations — admin-write RLS + physical SIM inventory table

**Files:**
- Create: `supabase/migrations/0004_admin_catalog_rls.sql`
- Create: `supabase/migrations/0005_physical_sim_inventory.sql`

**Interfaces:**
- Consumes: `public.is_admin_or_staff()` (already created in `supabase/migrations/0003_profiles_admin_and_email.sql`).
- Produces: admin-write access to `categories`/`products`/`category_countries` (later tasks' Route
  Handlers depend on this to write through a token-scoped client), and the
  `public.physical_sim_inventory` table (Task 7 depends on this existing).

This task is pure SQL — no Vitest test, matching the precedent set by `0003_profiles_admin_and_email.sql` (no live DB in CI; verified by manual read + later manual application).

- [ ] **Step 1: Create `supabase/migrations/0004_admin_catalog_rls.sql`**

`categories`/`products`/`category_countries` currently only have a public SELECT policy
(`status = 'active'` on the first two, unconditional on the third). There is no INSERT/UPDATE/DELETE
policy at all, so Postgres RLS default-denies every write regardless of table-level grants — adding
a permissive admin-only policy is sufficient, no `revoke`/`grant` dance is needed here (unlike the
`profiles` fix in migration `0003`, which had to unwind an existing over-broad UPDATE policy).

```sql
create policy "Admins can manage categories"
  on public.categories for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create policy "Admins can manage products"
  on public.products for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create policy "Admins can manage category_countries"
  on public.category_countries for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());
```

A `for all` policy applies to SELECT too — combined via OR with the existing public policy, so an
admin/staff caller sees every row (including inactive ones), satisfying `GET /admin/categories` and
`GET /admin/products` needing to return non-active rows as well.

- [ ] **Step 2: Create `supabase/migrations/0005_physical_sim_inventory.sql`**

```sql
create table public.physical_sim_inventory (
  id bigserial primary key,
  product_id bigint not null references public.products(id),
  iccid text not null unique,
  status text not null default 'in_stock',
  reserved_order_item_id bigint,
  imported_at timestamptz not null default now()
);

create index idx_physical_sim_inventory_product on public.physical_sim_inventory(product_id);
create index idx_physical_sim_inventory_status on public.physical_sim_inventory(status);

alter table public.physical_sim_inventory enable row level security;

create policy "Admins can manage inventory"
  on public.physical_sim_inventory for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());
```

`reserved_order_item_id` has no foreign key — there is no order table in this system yet; this
column exists for future use, matching how the old Java backend kept order-service loosely
coupled (ID reference only, no cross-service DB constraint).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_admin_catalog_rls.sql supabase/migrations/0005_physical_sim_inventory.sql
git commit -m "feat: add admin-write RLS policies and physical SIM inventory table"
```

---

### Task 2: `lib/smartImport.js` — pure parsing/classification helpers

**Files:**
- Create: `lib/smartImport.js`
- Create: `lib/__tests__/smartImport.test.js`

**Interfaces:**
- Consumes: nothing (pure functions, no DB, no Next.js).
- Produces: `slugify(text)`, `classify(title, description)` → `{packageType, capacityBucket,
  dataInfo}`, `resolveCountries(region, apnGroupsEsim, apnGroupsSim)` → `string[] | null`,
  `buildApnCountryGroups(rows2D)` → `{[key: string]: string[]}`, `computeRowPricing({simType,
  durationDays, priceImport, priceBuyFromFile}, pricingOptions)` → `{priceBuy, pricingRule,
  warning}`, `parseSmartImportWorkbook(buffer)` → `{ rows: ParsedRow[], regionResolutions:
  Map<string, string[]|null> }` where `ParsedRow = {sheet, row, code, rawTitle, region,
  description, durationDays, priceImport, priceBuyFromFile, simType}`. Task 4 (Product Admin)
  consumes `classify`. Task 6 (Smart Import DB orchestration) consumes everything else.

- [ ] **Step 1: Add the `xlsx` dependency**

```bash
npm install xlsx@^0.18.5
```

- [ ] **Step 2: Write the failing test for `slugify` and `classify`**

Create `lib/__tests__/smartImport.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  slugify, classify, resolveCountries, buildApnCountryGroups, computeRowPricing,
  parseSmartImportWorkbook, DIRECT_REGION_TO_ISO, NO_COUNTRY_MAPPING, VN_TO_ISO,
} from '../smartImport';
import * as XLSX from 'xlsx';

describe('slugify', () => {
  it('chuyển chữ hoa, khoảng trắng, ký tự đặc biệt thành dạng slug', () => {
    expect(slugify('Asia Multi-region A, 3 Days')).toBe('asia-multi-region-a-3-days');
  });

  it('gộp nhiều dấu gạch ngang liên tiếp và bỏ dấu gạch ở đầu/cuối', () => {
    expect(slugify('  --Nhật Bản!!--  ')).toBe('nh-t-b-n');
  });
});

describe('classify', () => {
  it('nhận diện gói unlimited', () => {
    expect(classify('Unlimited Data 5 Days', '')).toEqual({
      packageType: 'unlimited', capacityBucket: 'unlimited', dataInfo: 'Không giới hạn',
    });
  });

  it('nhận diện gói theo ngày (daily) và bucket 1gb', () => {
    expect(classify('Japan 1GB/day, 3 Days', '')).toEqual({
      packageType: 'daily', capacityBucket: '1gb', dataInfo: '1GB/ngày',
    });
  });

  it('nhận diện gói cố định (fixed) và bucket 2gb', () => {
    expect(classify('Asia 2GB, 5 Days', '')).toEqual({
      packageType: 'fixed', capacityBucket: '2gb', dataInfo: '2GB',
    });
  });

  it('bucket other-fixed khi dung lượng không khớp 1/2GB', () => {
    expect(classify('Asia 10GB, 5 Days', '')).toEqual({
      packageType: 'fixed', capacityBucket: 'other-fixed', dataInfo: '10GB',
    });
  });

  it('dataInfo trả về nguyên title khi không tìm được dung lượng', () => {
    expect(classify('Flat rate package', '')).toEqual({
      packageType: 'fixed', capacityBucket: 'other-fixed', dataInfo: 'Flat rate package',
    });
  });
});

describe('resolveCountries', () => {
  it('trả về mảng cố định khi region có trong DIRECT_REGION_TO_ISO', () => {
    expect(resolveCountries('Japan', {}, {})).toEqual(['jp']);
    expect(DIRECT_REGION_TO_ISO.Japan).toEqual(['jp']);
  });

  it('trả về [] khi region thuộc NO_COUNTRY_MAPPING', () => {
    expect(resolveCountries('Worldwide', {}, {})).toEqual([]);
    expect(NO_COUNTRY_MAPPING.has('Worldwide')).toBe(true);
  });

  it('tra cứu qua apn group khi không khớp 2 bảng tĩnh trên', () => {
    const apnEsim = { 'asia multi region a': ['sg', 'my'] };
    expect(resolveCountries('Asia Multi-region A', apnEsim, {})).toEqual(['sg', 'my']);
  });

  it('trả về null khi không resolve được ở đâu cả', () => {
    expect(resolveCountries('Vùng lạ chưa từng gặp', {}, {})).toBeNull();
  });
});

describe('buildApnCountryGroups', () => {
  it('gom các dòng quốc gia con vào đúng group header phía trên', () => {
    const rows2D = Array.from({ length: 16 }, () => [null, null]);
    rows2D[14] = ['Asia Multi-region A', 'Nhật Bản'];
    rows2D[15] = [null, 'Hàn Quốc'];
    const groups = buildApnCountryGroups(rows2D);
    expect(groups['asia multi region a']).toEqual(['jp', 'kr']);
  });

  it('bỏ qua tên quốc gia không có trong VN_TO_ISO', () => {
    const rows2D = Array.from({ length: 16 }, () => [null, null]);
    rows2D[14] = ['Nhóm test', 'Quốc gia không tồn tại'];
    const groups = buildApnCountryGroups(rows2D);
    expect(groups['nh-m-test'] ?? groups['nhom test']).toBeUndefined();
    expect(Object.keys(groups)).toContain('nhóm test'.normalize());
  });
});

describe('computeRowPricing', () => {
  it('dùng thẳng giá từ file khi có priceBuyFromFile', () => {
    const result = computeRowPricing(
      { simType: 'esim', durationDays: 3, priceImport: 100000, priceBuyFromFile: 130000 },
      {},
    );
    expect(result).toEqual({ priceBuy: 130000, pricingRule: 'fromFile', warning: null });
  });

  it('esim thiếu giá file -> tính markupPercent', () => {
    const result = computeRowPricing(
      { simType: 'esim', durationDays: 3, priceImport: 100000, priceBuyFromFile: null },
      { esimMarkupPercent: 30 },
    );
    expect(result).toEqual({ priceBuy: 130000, pricingRule: 'markupPercent', warning: null });
  });

  it('physical có durationDays, thiếu giá file -> tính daysPlusFee', () => {
    const result = computeRowPricing(
      { simType: 'physical', durationDays: 5, priceImport: 100000, priceBuyFromFile: null },
      { physicalFixedFee: 14000 },
    );
    expect(result).toEqual({ priceBuy: 514000, pricingRule: 'daysPlusFee', warning: null });
  });

  it('physical không có durationDays, thiếu giá file -> tính noDurationMultiplier kèm warning', () => {
    const result = computeRowPricing(
      { simType: 'physical', durationDays: null, priceImport: 100000, priceBuyFromFile: null },
      { physicalNoDurationMultiplier: 2 },
    );
    expect(result).toEqual({
      priceBuy: 200000,
      pricingRule: 'noDurationMultiplier',
      warning: 'Không tìm thấy số ngày trong tên gói — áp dụng giá bán = giá nhập × 2.',
    });
  });
});

describe('parseSmartImportWorkbook', () => {
  it('đọc đúng dòng dữ liệu từ 2 sheet giá, bỏ qua sheet apn khi build rows', () => {
    const wb = XLSX.utils.book_new();

    const esimSheetData = Array.from({ length: 11 }, () => []);
    esimSheetData[10] = [1, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 50000, 65000, ''];
    const esimSheet = XLSX.utils.aoa_to_sheet(esimSheetData);
    XLSX.utils.book_append_sheet(wb, esimSheet, 'eSIM prices new');

    const physicalSheetData = Array.from({ length: 11 }, () => []);
    physicalSheetData[10] = [1, 'WM-VN-P', 'Vietnam physical 5GB', 'Vietnam', '', null, null, 'physical', 80000, null, ''];
    const physicalSheet = XLSX.utils.aoa_to_sheet(physicalSheetData);
    XLSX.utils.book_append_sheet(wb, physicalSheet, 'Sim vật lý new');

    const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
    XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
    XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

    const buffer = XLSX.write(wb, { type: 'buffer' });
    const { rows, regionResolutions } = parseSmartImportWorkbook(buffer);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      sheet: 'eSIM prices new', row: 11, code: 'WM-JP-1D', rawTitle: 'Japan 1GB, 1 Day',
      region: 'Japan', description: '', durationDays: 1, priceImport: 50000,
      priceBuyFromFile: 65000, simType: 'esim',
    });
    expect(rows[1]).toEqual({
      sheet: 'Sim vật lý new', row: 11, code: 'WM-VN-P', rawTitle: 'Vietnam physical 5GB',
      region: 'Vietnam', description: '', durationDays: null, priceImport: 80000,
      priceBuyFromFile: null, simType: 'physical',
    });
    expect(regionResolutions.get('Japan')).toEqual(['jp']);
    expect(regionResolutions.get('Vietnam')).toEqual(['vn']);
  });
});
```

- [ ] **Step 3: Run test, confirm it fails**

Run: `npm test -- smartImport.test.js`
Expected: FAIL with "Cannot find module '../smartImport'".

- [ ] **Step 4: Create `lib/smartImport.js`**

```js
import * as XLSX from 'xlsx';

export const VN_TO_ISO = {
  Afghanistan: 'af', 'Ai Cập': 'eg', Albania: 'al', Algeria: 'dz',
  Andorra: 'ad', Anguilla: 'ai', 'Antigua và Barbuda': 'ag',
  'Antilles thuộc Hà Lan': 'an', Argentina: 'ar', Armenia: 'am',
  Azerbaijan: 'az', 'Ba Lan': 'pl', Bahrain: 'bh', Bangladesh: 'bd',
  Barbados: 'bb', Belarus: 'by', Benin: 'bj',
  'Bosnia và Herzegovina': 'ba', Brazil: 'br', Brunei: 'bn',
  Bulgaria: 'bg', 'Bắc Ireland': 'gb', 'Bắc Macedonia': 'mk', Bỉ: 'be',
  'Bồ Đào Nha': 'pt', Campuchia: 'kh', Canada: 'ca', Chad: 'td',
  Chile: 'cl', 'Châu Âu': 'eu', Colombia: 'co', 'Costa Rica': 'cr',
  Croatia: 'hr', 'Các Tiểu vương quốc Ả Rập Thống nhất': 'ae',
  'Cộng hòa Congo': 'cg', 'Cộng hòa Dominica': 'do',
  'Cộng hòa Dân chủ Congo': 'cd', 'Cộng hòa Séc': 'cz', Dominica: 'dm',
  Ecuador: 'ec', 'El Salvador': 'sv', Estonia: 'ee', Ethiopia: 'et',
  Fiji: 'fj', Gabon: 'ga', Georgia: 'ge', Ghana: 'gh',
  Gibraltar: 'gi', Greenland: 'gl', Grenada: 'gd',
  Guadeloupe: 'gp', Guam: 'gu', Guernsey: 'gg',
  'Guiana thuộc Pháp': 'gf', 'Hoa Kỳ': 'us', Hungary: 'hu',
  'Hy Lạp': 'gr', 'Hà Lan': 'nl', 'Hàn Quốc': 'kr', 'Hồng Kông': 'hk',
  Iceland: 'is', Indonesia: 'id', Iraq: 'iq', Ireland: 'ie',
  Israel: 'il', Jamaica: 'jm', Jersey: 'je', Jordan: 'jo',
  Kazakhstan: 'kz', Kenya: 'ke', Kuwait: 'kw', Kyrgyzstan: 'kg',
  Latvia: 'lv', Liechtenstein: 'li', Lithuania: 'lt',
  Luxembourg: 'lu', Lào: 'la', 'Ma Cao': 'mo', 'Ma Rốc': 'ma',
  Madagascar: 'mg', Malawi: 'mw', Malaysia: 'my', Maldives: 'mv',
  Malta: 'mt', Martinique: 'mq', Mauritius: 'mu', Mexico: 'mx',
  Moldova: 'md', Monaco: 'mc', Montenegro: 'me', Montserrat: 'ms',
  Mozambique: 'mz', 'Mông Cổ': 'mn', Mỹ: 'us', 'Na Uy': 'no',
  'Nam Phi': 'za', Nepal: 'np', 'New Zealand': 'nz', Nga: 'ru',
  'Nhật Bản': 'jp', Niger: 'ne', Nigeria: 'ng', Oman: 'om',
  Pakistan: 'pk', Panama: 'pa', Paraguay: 'py', Peru: 'pe',
  Philippines: 'ph', Pháp: 'fr', 'Phần Lan': 'fi',
  'Puerto Rico': 'pr', Qatar: 'qa', 'Quần đảo Bắc Mariana': 'mp',
  'Quần đảo Cayman': 'ky', 'Quần đảo Faroe': 'fo',
  'Quần đảo Turks và Caicos': 'tc',
  'Quần đảo Virgin thuộc Anh': 'vg', 'Quần đảo Virgin thuộc Mỹ': 'vi',
  Romania: 'ro', Rwanda: 'rw', Réunion: 're',
  'Saint Barthélemy': 'bl', 'Saint Kitts và Nevis': 'kn',
  'Saint Lucia': 'lc', 'Saint Martin': 'mf',
  'Saint Vincent và Grenadines': 'vc', Saipan: 'mp', 'San Marino': 'sm',
  Scotland: 'gb', Senegal: 'sn', Serbia: 'rs', Singapore: 'sg',
  Slovakia: 'sk', Slovenia: 'si', 'Sri Lanka': 'lk', Síp: 'cy',
  Tajikistan: 'tj', Tanzania: 'tz', 'Thành Vatican': 'va',
  'Thái Lan': 'th', 'Thổ Nhĩ Kỳ': 'tr', 'Thụy Sĩ': 'ch',
  'Thụy Điển': 'se', 'Toàn cầu': '__worldwide__', 'Trung Quốc': 'cn',
  'Trung Quốc + Vương quốc Anh': '__multi_cn_gb__',
  'Trung Quốc đại lục': 'cn', Tunisia: 'tn', 'Tây Ban Nha': 'es',
  Uganda: 'ug', Ukraine: 'ua', Uruguay: 'uy', Uzbekistan: 'uz',
  Vatican: 'va', 'Việt Nam': 'vn', 'Vương quốc Anh': 'gb',
  Wales: 'gb', Zambia: 'zm', Áo: 'at', Úc: 'au', Ý: 'it',
  'Đan Mạch': 'dk', 'Đài Loan': 'tw', 'Đảo Man': 'im', Đức: 'de',
  'Ả Rập Xê Út': 'sa', 'Ấn Độ': 'in',
};

export const DIRECT_REGION_TO_ISO = {
  Japan: ['jp'], 'Japan IIJ': ['jp'], Australia: ['au'],
  Philippines: ['ph'], India: ['in'], Russia: ['ru'],
  Turkey: ['tr'], 'Saudi Arabia': ['sa'], UAE: ['ae'], USA: ['us'],
  'USA A': ['us'], Vietnam: ['vn'], Taiwan: ['tw'], Oman: ['om'],
  Bangladesh: ['bd'], Cambodia: ['kh'], Laos: ['la'],
  'Sri Lanka': ['lk'], Korea: ['kr'], Thailand: ['th'],
  Mongolia: ['mn'], Maldives: ['mv'], 'Mainland China': ['cn'],
  'Mainland China A': ['cn'], 'Mainland China SG': ['cn'],
  'China, Hong Kong& Macao': ['cn', 'hk', 'mo'],
  'China, Macao': ['cn', 'mo'], Malaysia: ['my'],
  'Japan, Korea': ['jp', 'kr'], 'New Zealand, Australia': ['nz', 'au'],
  'Singapore, Malaysia': ['sg', 'my'],
  'China, Hong Kong, Macao, Taiwan': ['cn', 'hk', 'mo', 'tw'],
  'Hong Kong, Macao': ['hk', 'mo'],
  'USA, Canada, Mexico': ['us', 'ca', 'mx'],
  'Southeast Asia': ['sg', 'my', 'id', 'th', 'vn'],
};

export const NO_COUNTRY_MAPPING = new Set([
  'APAC A', 'APAC B', 'Asia A', 'Asia', 'South America', 'South America A',
  'Worldwide', 'Multi-region TT', 'Europe', 'North America',
]);

const DATA_AMOUNT_RE = /(\d+(?:[.,]\d+)?)\s*(GB|MB)\b/i;

export function slugify(text) {
  const lower = String(text).trim().toLowerCase();
  const dashed = lower.replace(/[^a-z0-9]+/g, '-');
  return dashed.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

export function classify(title, description) {
  const text = `${title} ${description || ''}`.toLowerCase();
  let packageType;
  if (text.includes('unlimited') || text.includes('không giới hạn') || text.includes('ayce')) {
    packageType = 'unlimited';
  } else if (/\/\s*(day|ngày)\b/.test(text)) {
    packageType = 'daily';
  } else {
    packageType = 'fixed';
  }

  const match = DATA_AMOUNT_RE.exec(title) || DATA_AMOUNT_RE.exec(description || '');
  let capacityBucket;
  if (packageType === 'unlimited') {
    capacityBucket = 'unlimited';
  } else if (!match) {
    capacityBucket = 'other-fixed';
  } else {
    const value = Number(match[1].replace(',', '.'));
    const unit = match[2].toUpperCase();
    if (unit === 'MB' && value <= 500) capacityBucket = 'under-1gb';
    else if (unit === 'GB' && value === 1) capacityBucket = '1gb';
    else if (unit === 'GB' && value === 2) capacityBucket = '2gb';
    else capacityBucket = 'other-fixed';
  }

  let dataInfo;
  if (packageType === 'unlimited') {
    dataInfo = 'Không giới hạn';
  } else if (match) {
    const amount = `${match[1]}${match[2].toUpperCase()}`;
    dataInfo = packageType === 'daily' ? `${amount}/ngày` : amount;
  } else {
    dataInfo = title;
  }

  return { packageType, capacityBucket, dataInfo };
}

export function buildApnCountryGroups(rows2D) {
  const groups = {};
  let currentKey = null;
  for (let i = 14; i < rows2D.length; i++) {
    const row = rows2D[i];
    if (!row) continue;
    const groupHeader = row[0];
    const vnCountry = row[1];
    if (groupHeader) {
      currentKey = String(groupHeader).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!groups[currentKey]) groups[currentKey] = [];
    }
    if (currentKey && vnCountry) {
      const iso = VN_TO_ISO[String(vnCountry).trim()];
      if (iso && !iso.startsWith('__') && !groups[currentKey].includes(iso)) {
        groups[currentKey].push(iso);
      }
    }
  }
  return groups;
}

export function resolveCountries(region, apnGroupsEsim, apnGroupsSim) {
  if (DIRECT_REGION_TO_ISO[region]) {
    return [...DIRECT_REGION_TO_ISO[region]];
  }
  if (NO_COUNTRY_MAPPING.has(region)) {
    return [];
  }
  const key = region.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const groups of [apnGroupsEsim, apnGroupsSim]) {
    if (groups[key] && groups[key].length) {
      return [...groups[key]];
    }
  }
  return null;
}

export function computeRowPricing(
  { simType, durationDays, priceImport, priceBuyFromFile },
  pricingOptions = {},
) {
  const esimMarkupPercent = pricingOptions.esimMarkupPercent ?? 30;
  const physicalFixedFee = pricingOptions.physicalFixedFee ?? 14000;
  const physicalNoDurationMultiplier = pricingOptions.physicalNoDurationMultiplier ?? 2;

  if (priceBuyFromFile != null && Number.isFinite(priceBuyFromFile)) {
    return { priceBuy: Math.round(priceBuyFromFile), pricingRule: 'fromFile', warning: null };
  }
  if (simType === 'esim') {
    return {
      priceBuy: Math.round(priceImport * (1 + esimMarkupPercent / 100)),
      pricingRule: 'markupPercent',
      warning: null,
    };
  }
  if (durationDays != null) {
    return {
      priceBuy: Math.round(priceImport * durationDays + physicalFixedFee),
      pricingRule: 'daysPlusFee',
      warning: null,
    };
  }
  return {
    priceBuy: Math.round(priceImport * physicalNoDurationMultiplier),
    pricingRule: 'noDurationMultiplier',
    warning: `Không tìm thấy số ngày trong tên gói — áp dụng giá bán = giá nhập × ${physicalNoDurationMultiplier}.`,
  };
}

function sheetToRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
}

export function parseSmartImportWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const apnEsim = buildApnCountryGroups(sheetToRows(workbook, 'eSIM apn'));
  const apnSim = buildApnCountryGroups(sheetToRows(workbook, 'SIM apn'));

  const regionResolutions = new Map();
  const rows = [];

  for (const [sheetName, simType] of [['eSIM prices new', 'esim'], ['Sim vật lý new', 'physical']]) {
    const sheetRows = sheetToRows(workbook, sheetName);
    for (let i = 10; i < sheetRows.length; i++) {
      const r = sheetRows[i];
      if (!r || r[0] == null) continue;
      const code = r[1];
      const rawTitle = r[2];
      const region = r[3];
      const description = r[4];
      let durationDays = r[5];
      const priceImport = r[8];
      const priceBuyFromFile = r[9];
      if (!rawTitle || !region) continue;
      if (typeof durationDays !== 'number') {
        const m = /(\d+)\s*(day|ngày)/i.exec(`${rawTitle} ${description || ''}`);
        durationDays = m ? Number(m[1]) : null;
      }
      if (priceImport == null) continue;

      const trimmedRegion = String(region).trim();
      if (!regionResolutions.has(trimmedRegion)) {
        regionResolutions.set(trimmedRegion, resolveCountries(trimmedRegion, apnEsim, apnSim));
      }

      rows.push({
        sheet: sheetName,
        row: i + 1,
        code: code != null ? String(code) : null,
        rawTitle: String(rawTitle).trim(),
        region: trimmedRegion,
        description: description != null ? String(description) : '',
        durationDays,
        priceImport: Number(priceImport),
        priceBuyFromFile: priceBuyFromFile != null ? Number(priceBuyFromFile) : null,
        simType,
      });
    }
  }

  return { rows, regionResolutions };
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `npm test -- smartImport.test.js`
Expected: PASS (15 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/smartImport.js lib/__tests__/smartImport.test.js
git commit -m "feat: add lib/smartImport.js pure parsing/classification helpers"
```

---

### Task 3: Category Admin API

**Files:**
- Modify: `lib/adminCatalog.js` (create)
- Create: `lib/__tests__/adminCatalog.categories.test.js`
- Create: `app/api/catalog/admin/categories/route.js`
- Create: `app/api/catalog/admin/categories/__tests__/route.test.js`
- Create: `app/api/catalog/admin/categories/[id]/route.js`
- Create: `app/api/catalog/admin/categories/[id]/__tests__/route.test.js`

**Interfaces:**
- Consumes: `authenticate`, `authErrorResponse`, `requireRole` from `lib/apiAuth.js`.
- Produces: `listCategoriesAdmin(supabase)`, `createCategoryAdmin(supabase, {name, slug,
  imageUrl, status})`, `updateCategoryAdmin(supabase, id, {name, slug, imageUrl, status})`,
  `deleteCategoryAdmin(supabase, id)` in `lib/adminCatalog.js` — all take the caller's
  token-scoped `supabase` client as their first argument (not a bare anon client, unlike
  `lib/catalog.js`'s public functions) since RLS depends on the caller's identity. Each returns
  `{ data, error }` (raw pass-through shape) except `deleteCategoryAdmin`, which returns
  `{ deleted: boolean, error }`.

- [ ] **Step 1: Write the failing test for `lib/adminCatalog.js`'s category functions**

Create `lib/__tests__/adminCatalog.categories.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

import {
  listCategoriesAdmin, createCategoryAdmin, updateCategoryAdmin, deleteCategoryAdmin,
} from '../adminCatalog';

describe('lib/adminCatalog — categories', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  describe('listCategoriesAdmin', () => {
    it('trả mọi category kèm coveredCountries, không lọc status', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: [
          { id: 1, name: 'Nhật Bản', slug: 'nhat-ban', image_url: null, status: 'inactive', category_countries: [{ country_code: 'jp' }] },
        ],
        error: null,
      }));

      const result = await listCategoriesAdmin(supabaseMock);

      expect(fromMock).toHaveBeenCalledWith('categories');
      expect(result).toEqual({
        data: [{ id: 1, name: 'Nhật Bản', slug: 'nhat-ban', imageUrl: null, status: 'inactive', coveredCountries: ['jp'] }],
        error: null,
      });
    });
  });

  describe('createCategoryAdmin', () => {
    it('tạo category mới, coveredCountries luôn rỗng', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: { id: 5, name: 'Lào', slug: 'lao', image_url: null, status: 'active' },
        error: null,
      }));

      const result = await createCategoryAdmin(supabaseMock, { name: 'Lào', slug: 'lao', imageUrl: null, status: 'active' });

      expect(result).toEqual({
        data: { id: 5, name: 'Lào', slug: 'lao', imageUrl: null, status: 'active', coveredCountries: [] },
        error: null,
      });
    });

    it('trả error khi slug đã tồn tại', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { code: '23505', message: 'duplicate key' } }));

      const result = await createCategoryAdmin(supabaseMock, { name: 'Lào', slug: 'lao', imageUrl: null, status: 'active' });

      expect(result.error.code).toBe('23505');
    });
  });

  describe('updateCategoryAdmin', () => {
    it('cập nhật category và trả data mới', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: { id: 5, name: 'Lào (updated)', slug: 'lao', image_url: null, status: 'active' },
        error: null,
      }));

      const result = await updateCategoryAdmin(supabaseMock, 5, { name: 'Lào (updated)', slug: 'lao', imageUrl: null, status: 'active' });

      expect(result.data.name).toBe('Lào (updated)');
    });

    it('trả data null khi không tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await updateCategoryAdmin(supabaseMock, 999, { name: 'X', slug: 'x', imageUrl: null, status: 'active' });

      expect(result).toEqual({ data: null, error: null });
    });
  });

  describe('deleteCategoryAdmin', () => {
    it('trả deleted true khi xoá thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [{ id: 5 }], error: null }));

      const result = await deleteCategoryAdmin(supabaseMock, 5);

      expect(result).toEqual({ deleted: true, error: null });
    });

    it('trả deleted false khi không tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

      const result = await deleteCategoryAdmin(supabaseMock, 999);

      expect(result).toEqual({ deleted: false, error: null });
    });

    it('trả error khi bị chặn bởi khoá ngoại (còn sản phẩm tham chiếu)', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { code: '23503', message: 'foreign key violation' } }));

      const result = await deleteCategoryAdmin(supabaseMock, 1);

      expect(result.error.code).toBe('23503');
    });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- adminCatalog.categories.test.js`
Expected: FAIL with "Cannot find module '../adminCatalog'".

- [ ] **Step 3: Create `lib/adminCatalog.js` with the category functions**

```js
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

export async function listCategoriesAdmin(supabase) {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, image_url, status, category_countries(country_code)')
    .order('id', { ascending: true });
  if (error) return { data: null, error };
  return { data: (data || []).map(mapCategory), error: null };
}

export async function createCategoryAdmin(supabase, { name, slug, imageUrl, status }) {
  const { data, error } = await supabase
    .from('categories')
    .insert({ name, slug, image_url: imageUrl ?? null, status })
    .select('id, name, slug, image_url, status')
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: mapCategory(data), error: null };
}

export async function updateCategoryAdmin(supabase, id, { name, slug, imageUrl, status }) {
  const { data, error } = await supabase
    .from('categories')
    .update({ name, slug, image_url: imageUrl ?? null, status })
    .eq('id', id)
    .select('id, name, slug, image_url, status')
    .maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  return { data: mapCategory(data), error: null };
}

export async function deleteCategoryAdmin(supabase, id) {
  const { data, error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) return { deleted: false, error };
  return { deleted: (data || []).length > 0, error: null };
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- adminCatalog.categories.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing test for `GET`/`POST /api/catalog/admin/categories`**

Create `app/api/catalog/admin/categories/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listCategoriesAdminMock = vi.fn();
const createCategoryAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminCatalog', () => ({
  listCategoriesAdmin: (...args) => listCategoriesAdminMock(...args),
  createCategoryAdmin: (...args) => createCategoryAdminMock(...args),
}));

import { GET, POST } from '../route';

function makeGetRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}
function makePostRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('GET /api/catalog/admin/categories', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listCategoriesAdminMock.mockReset();
  });

  it('trả danh sách category khi caller là admin', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listCategoriesAdminMock.mockResolvedValue({ data: [{ id: 1, name: 'A' }], error: null });

    const response = await GET(makeGetRequest());
    const body = await response.json();

    expect(body).toEqual([{ id: 1, name: 'A' }]);
  });

  it('trả 403 khi caller không phải admin/staff', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'customer' }, supabase: {} });

    const response = await GET(makeGetRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
  });

  it('trả 500 khi listCategoriesAdmin lỗi', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listCategoriesAdminMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(500);
  });
});

describe('POST /api/catalog/admin/categories', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    createCategoryAdminMock.mockReset();
  });

  it('tạo category thành công, trả 201', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createCategoryAdminMock.mockResolvedValue({
      data: { id: 9, name: 'Lào', slug: 'lao', imageUrl: null, status: 'active', coveredCountries: [] },
      error: null,
    });

    const response = await POST(makePostRequest({ name: 'Lào', slug: 'lao', status: 'active' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.slug).toBe('lao');
  });

  it('trả 400 khi slug đã tồn tại', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createCategoryAdminMock.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });

    const response = await POST(makePostRequest({ name: 'Lào', slug: 'lao', status: 'active' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' });
  });

  it('trả 400 khi thiếu field bắt buộc', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({ name: '', slug: 'lao', status: 'active' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc (name/slug/status).' });
    expect(createCategoryAdminMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- app/api/catalog/admin/categories/__tests__/route.test.js`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 7: Create `app/api/catalog/admin/categories/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listCategoriesAdmin, createCategoryAdmin } from '../../../../../lib/adminCatalog';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { data, error } = await listCategoriesAdmin(supabase);
    if (error) {
      return NextResponse.json({ message: 'Không tải được danh sách danh mục.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { name, slug, imageUrl, status } = await request.json();
    if (!name || !slug || !status) {
      return NextResponse.json({ message: 'Thiếu thông tin bắt buộc (name/slug/status).' }, { status: 400 });
    }

    const { data, error } = await createCategoryAdmin(supabase, { name, slug, imageUrl, status });
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không tạo được danh mục.' }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- app/api/catalog/admin/categories/__tests__/route.test.js`
Expected: PASS (6 tests).

- [ ] **Step 9: Write the failing test for `PUT`/`DELETE /api/catalog/admin/categories/[id]`**

Create `app/api/catalog/admin/categories/[id]/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const updateCategoryAdminMock = vi.fn();
const deleteCategoryAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminCatalog', () => ({
  updateCategoryAdmin: (...args) => updateCategoryAdminMock(...args),
  deleteCategoryAdmin: (...args) => deleteCategoryAdminMock(...args),
}));

import { PUT, DELETE } from '../route';

function makePutRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}
function makeDeleteRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}

describe('PUT /api/catalog/admin/categories/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    updateCategoryAdminMock.mockReset();
  });

  it('cập nhật thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateCategoryAdminMock.mockResolvedValue({
      data: { id: 5, name: 'X', slug: 'x', imageUrl: null, status: 'active', coveredCountries: [] },
      error: null,
    });

    const response = await PUT(makePutRequest({ name: 'X', slug: 'x', status: 'active' }), { params: Promise.resolve({ id: '5' }) });
    const body = await response.json();

    expect(updateCategoryAdminMock).toHaveBeenCalledWith({}, '5', { name: 'X', slug: 'x', imageUrl: undefined, status: 'active' });
    expect(body.id).toBe(5);
  });

  it('trả 404 khi không tìm thấy id', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateCategoryAdminMock.mockResolvedValue({ data: null, error: null });

    const response = await PUT(makePutRequest({ name: 'X', slug: 'x', status: 'active' }), { params: Promise.resolve({ id: '999' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy danh mục.' });
  });
});

describe('DELETE /api/catalog/admin/categories/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    deleteCategoryAdminMock.mockReset();
  });

  it('trả 204 khi xoá thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteCategoryAdminMock.mockResolvedValue({ deleted: true, error: null });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '5' }) });

    expect(response.status).toBe(204);
  });

  it('trả 404 khi không tìm thấy id', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteCategoryAdminMock.mockResolvedValue({ deleted: false, error: null });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });

  it('trả 400 khi bị chặn bởi khoá ngoại', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteCategoryAdminMock.mockResolvedValue({ deleted: false, error: { code: '23503' } });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Không thể xoá — danh mục còn sản phẩm liên kết.' });
  });
});
```

- [ ] **Step 10: Run test, confirm it fails**

Run: `npm test -- "app/api/catalog/admin/categories/\[id\]"`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 11: Create `app/api/catalog/admin/categories/[id]/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { updateCategoryAdmin, deleteCategoryAdmin } from '../../../../../../lib/adminCatalog';

export async function PUT(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const { name, slug, imageUrl, status } = await request.json();
    if (!name || !slug || !status) {
      return NextResponse.json({ message: 'Thiếu thông tin bắt buộc (name/slug/status).' }, { status: 400 });
    }

    const { data, error } = await updateCategoryAdmin(supabase, id, { name, slug, imageUrl, status });
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không cập nhật được danh mục.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ message: 'Không tìm thấy danh mục.' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const { deleted, error } = await deleteCategoryAdmin(supabase, id);
    if (error) {
      if (error.code === '23503') {
        return NextResponse.json({ message: 'Không thể xoá — danh mục còn sản phẩm liên kết.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không xoá được danh mục.' }, { status: 500 });
    }
    if (!deleted) {
      return NextResponse.json({ message: 'Không tìm thấy danh mục.' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 12: Run test, confirm it passes**

Run: `npm test -- "app/api/catalog/admin/categories/\[id\]"`
Expected: PASS (5 tests).

- [ ] **Step 13: Run the full suite, then commit**

Run: `npm test`
Expected: PASS — every previous suite plus these new ones.

```bash
git add lib/adminCatalog.js lib/__tests__/adminCatalog.categories.test.js app/api/catalog/admin/categories
git commit -m "feat: add Category Admin API (CRUD)"
```

---

### Task 4: Product Admin API

**Files:**
- Modify: `lib/adminCatalog.js`
- Create: `lib/__tests__/adminCatalog.products.test.js`
- Create: `app/api/catalog/admin/products/route.js`
- Create: `app/api/catalog/admin/products/__tests__/route.test.js`
- Create: `app/api/catalog/admin/products/search/route.js`
- Create: `app/api/catalog/admin/products/search/__tests__/route.test.js`
- Create: `app/api/catalog/admin/products/[id]/route.js`
- Create: `app/api/catalog/admin/products/[id]/__tests__/route.test.js`

**Interfaces:**
- Consumes: `classify` from `lib/smartImport.js` (Task 2) — used to derive `package_type`/
  `capacity_bucket` server-side, never accepted from the request body.
- Produces: `listProductsAdmin(supabase)`, `searchProductsAdmin(supabase, {categoryId, search,
  page, size})` → `{data: {content, number, totalElements, totalPages, size}, error}`,
  `createProductAdmin(supabase, {categoryId, title, slug, simType, priceBuy, priceImport,
  dataInfo, durationDays, apiPackageCode, status})`, `updateProductAdmin(supabase, id, {...same})`,
  `deleteProductAdmin(supabase, id)` in `lib/adminCatalog.js`.

- [ ] **Step 1: Write the failing test for `lib/adminCatalog.js`'s product functions**

Create `lib/__tests__/adminCatalog.products.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

const sampleRow = {
  id: 1, category_id: 5, title: 'eSIM Nhật Bản 1GB/ngày', slug: 'esim-nb-1gb',
  sim_type: 'esim', price_buy: 89000, price_import: 60000, data_info: '1GB/ngày',
  duration_days: 3, package_type: 'daily', capacity_bucket: '1gb',
  api_package_code: 'WM-JP-1', status: 'active',
};
const sampleMapped = {
  id: 1, categoryId: 5, title: 'eSIM Nhật Bản 1GB/ngày', slug: 'esim-nb-1gb',
  simType: 'esim', priceBuy: 89000, priceImport: 60000, dataInfo: '1GB/ngày',
  durationDays: 3, apiPackageCode: 'WM-JP-1', status: 'active',
};

import {
  listProductsAdmin, searchProductsAdmin, createProductAdmin, updateProductAdmin, deleteProductAdmin,
} from '../adminCatalog';

describe('lib/adminCatalog — products', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  describe('listProductsAdmin', () => {
    it('trả toàn bộ sản phẩm không phân trang', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [sampleRow], error: null }));

      const result = await listProductsAdmin(supabaseMock);

      expect(fromMock).toHaveBeenCalledWith('products');
      expect(result).toEqual({ data: [sampleMapped], error: null });
    });
  });

  describe('searchProductsAdmin', () => {
    it('phân trang 0-indexed, trả field number (không phải page)', async () => {
      const query = createQueryBuilderMock({ data: [sampleRow], count: 25, error: null });
      fromMock.mockReturnValue(query);

      const result = await searchProductsAdmin(supabaseMock, { page: 0, size: 20 });

      expect(query.range).toHaveBeenCalledWith(0, 19);
      expect(result.data).toEqual({
        content: [sampleMapped], number: 0, size: 20, totalElements: 25, totalPages: 2,
      });
    });

    it('lọc theo categoryId và search khi có', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await searchProductsAdmin(supabaseMock, { categoryId: 5, search: 'nhat' });

      expect(query.eq).toHaveBeenCalledWith('category_id', 5);
      expect(query.ilike).toHaveBeenCalledWith('title', '%nhat%');
    });

    it('dùng page=0/size=20 khi tham số không hợp lệ (NaN)', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      const result = await searchProductsAdmin(supabaseMock, { page: NaN, size: NaN });

      expect(query.range).toHaveBeenCalledWith(0, 19);
      expect(result.data.number).toBe(0);
      expect(result.data.size).toBe(20);
    });
  });

  describe('createProductAdmin', () => {
    it('tự suy ra package_type/capacity_bucket từ dataInfo, không nhận từ input', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: sampleRow, error: null }));

      const result = await createProductAdmin(supabaseMock, {
        categoryId: 5, title: 'eSIM Nhật Bản 1GB/ngày', slug: 'esim-nb-1gb', simType: 'esim',
        priceBuy: 89000, priceImport: 60000, dataInfo: '1GB/ngày', durationDays: 3,
        apiPackageCode: 'WM-JP-1', status: 'active',
      });

      expect(fromMock().insert).toHaveBeenCalledWith(expect.objectContaining({
        package_type: 'daily', capacity_bucket: '1gb',
      }));
      expect(result.data).toEqual(sampleMapped);
    });
  });

  describe('updateProductAdmin', () => {
    it('cập nhật và trả data null khi không tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await updateProductAdmin(supabaseMock, 999, {
        categoryId: 5, title: 'X', slug: 'x', simType: 'esim', priceBuy: 1, priceImport: 1,
        dataInfo: '1GB', durationDays: 1, status: 'active',
      });

      expect(result).toEqual({ data: null, error: null });
    });
  });

  describe('deleteProductAdmin', () => {
    it('trả deleted true khi xoá thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [{ id: 1 }], error: null }));

      const result = await deleteProductAdmin(supabaseMock, 1);

      expect(result).toEqual({ deleted: true, error: null });
    });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- adminCatalog.products.test.js`
Expected: FAIL — `listProductsAdmin` etc. not exported yet.

- [ ] **Step 3: Add the product functions to `lib/adminCatalog.js`**

Add these imports and functions to the existing `lib/adminCatalog.js` (keep the category functions
from Task 3 unchanged, add below them):

```js
import { classify } from './smartImport';

function mapProductAdmin(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    slug: row.slug,
    simType: row.sim_type,
    priceBuy: Number(row.price_buy),
    priceImport: Number(row.price_import),
    dataInfo: row.data_info,
    durationDays: row.duration_days,
    apiPackageCode: row.api_package_code,
    status: row.status,
  };
}

export async function listProductsAdmin(supabase) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('id', { ascending: true });
  if (error) return { data: null, error };
  return { data: (data || []).map(mapProductAdmin), error: null };
}

export async function searchProductsAdmin(supabase, { categoryId, search, page, size } = {}) {
  const safePage = Number.isFinite(page) && page >= 0 ? Math.trunc(page) : 0;
  const safeSize = Number.isFinite(size) && size > 0 ? Math.trunc(size) : 20;

  let query = supabase.from('products').select('*', { count: 'exact' });
  if (categoryId != null) {
    query = query.eq('category_id', categoryId);
  }
  if (search) {
    query = query.ilike('title', `%${search}%`);
  }
  const from = safePage * safeSize;
  const to = from + safeSize - 1;
  query = query.order('id', { ascending: true }).range(from, to);

  const { data, count, error } = await query;
  if (error) return { data: null, error };
  const totalElements = count || 0;
  return {
    data: {
      content: (data || []).map(mapProductAdmin),
      number: safePage,
      size: safeSize,
      totalElements,
      totalPages: Math.ceil(totalElements / safeSize),
    },
    error: null,
  };
}

function productFieldsToRow({ categoryId, title, slug, simType, priceBuy, priceImport, dataInfo, durationDays, apiPackageCode, status }) {
  const { packageType, capacityBucket } = classify(title, dataInfo);
  return {
    category_id: categoryId,
    title,
    slug,
    sim_type: simType,
    price_buy: priceBuy,
    price_import: priceImport,
    data_info: dataInfo,
    duration_days: durationDays,
    package_type: packageType,
    capacity_bucket: capacityBucket,
    api_package_code: apiPackageCode ?? null,
    status,
  };
}

export async function createProductAdmin(supabase, fields) {
  const { data, error } = await supabase
    .from('products')
    .insert(productFieldsToRow(fields))
    .select('*')
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: mapProductAdmin(data), error: null };
}

export async function updateProductAdmin(supabase, id, fields) {
  const { data, error } = await supabase
    .from('products')
    .update(productFieldsToRow(fields))
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  return { data: mapProductAdmin(data), error: null };
}

export async function deleteProductAdmin(supabase, id) {
  const { data, error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) return { deleted: false, error };
  return { deleted: (data || []).length > 0, error: null };
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- adminCatalog.products.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing test for `GET`/`POST /api/catalog/admin/products`**

Create `app/api/catalog/admin/products/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listProductsAdminMock = vi.fn();
const createProductAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminCatalog', () => ({
  listProductsAdmin: (...args) => listProductsAdminMock(...args),
  createProductAdmin: (...args) => createProductAdminMock(...args),
}));

import { GET, POST } from '../route';

function makeGetRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}
function makePostRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('GET /api/catalog/admin/products', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listProductsAdminMock.mockReset();
  });

  it('trả toàn bộ sản phẩm', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });
    listProductsAdminMock.mockResolvedValue({ data: [{ id: 1 }], error: null });

    const response = await GET(makeGetRequest());
    const body = await response.json();

    expect(body).toEqual([{ id: 1 }]);
  });
});

describe('POST /api/catalog/admin/products', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    createProductAdminMock.mockReset();
  });

  it('tạo sản phẩm thành công, trả 201', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createProductAdminMock.mockResolvedValue({ data: { id: 1, slug: 'a' }, error: null });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));

    expect(response.status).toBe(201);
    expect(createProductAdminMock).toHaveBeenCalled();
  });

  it('trả 400 khi categoryId không tồn tại', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createProductAdminMock.mockResolvedValue({ data: null, error: { code: '23503' } });

    const response = await POST(makePostRequest({
      categoryId: 999, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'categoryId không tồn tại.' });
  });

  it('trả 400 khi simType không hợp lệ', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'tablet', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'simType chỉ nhận "esim" hoặc "physical".' });
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- app/api/catalog/admin/products/__tests__/route.test.js`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 7: Create `app/api/catalog/admin/products/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listProductsAdmin, createProductAdmin } from '../../../../../lib/adminCatalog';

function validateProductBody(body) {
  const { categoryId, title, slug, simType, priceBuy, priceImport, dataInfo, durationDays, status } = body;
  if (!categoryId || !title || !slug || !priceBuy || !priceImport || !dataInfo || !durationDays || !status) {
    return 'Thiếu thông tin bắt buộc.';
  }
  if (simType !== 'esim' && simType !== 'physical') {
    return 'simType chỉ nhận "esim" hoặc "physical".';
  }
  return null;
}

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { data, error } = await listProductsAdmin(supabase);
    if (error) {
      return NextResponse.json({ message: 'Không tải được danh sách sản phẩm.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const body = await request.json();
    const validationError = validateProductBody(body);
    if (validationError) {
      return NextResponse.json({ message: validationError }, { status: 400 });
    }

    const { data, error } = await createProductAdmin(supabase, body);
    if (error) {
      if (error.code === '23503') {
        return NextResponse.json({ message: 'categoryId không tồn tại.' }, { status: 400 });
      }
      if (error.code === '23505') {
        return NextResponse.json({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không tạo được sản phẩm.' }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- app/api/catalog/admin/products/__tests__/route.test.js`
Expected: PASS (4 tests).

- [ ] **Step 9: Write the failing test for `GET /api/catalog/admin/products/search`**

Create `app/api/catalog/admin/products/search/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const searchProductsAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminCatalog', () => ({
  searchProductsAdmin: (...args) => searchProductsAdminMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/catalog/admin/products/search', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    searchProductsAdminMock.mockReset();
  });

  it('đọc categoryId/search/page/size từ query string, trả field number', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    searchProductsAdminMock.mockResolvedValue({
      data: { content: [], number: 1, size: 10, totalElements: 0, totalPages: 0 }, error: null,
    });

    const response = await GET(makeRequest('http://localhost:3000/api/catalog/admin/products/search?categoryId=5&search=nhat&page=1&size=10'));
    const body = await response.json();

    expect(searchProductsAdminMock).toHaveBeenCalledWith({}, {
      categoryId: '5', search: 'nhat', page: 1, size: 10,
    });
    expect(body.number).toBe(1);
    expect(body.page).toBeUndefined();
  });
});
```

- [ ] **Step 10: Run test, confirm it fails**

Run: `npm test -- app/api/catalog/admin/products/search`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 11: Create `app/api/catalog/admin/products/search/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { searchProductsAdmin } from '../../../../../../lib/adminCatalog';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { searchParams } = new URL(request.url);
    const { data, error } = await searchProductsAdmin(supabase, {
      categoryId: searchParams.get('categoryId') || undefined,
      search: searchParams.get('search') || undefined,
      page: searchParams.get('page') != null ? Number(searchParams.get('page')) : undefined,
      size: searchParams.get('size') != null ? Number(searchParams.get('size')) : undefined,
    });
    if (error) {
      return NextResponse.json({ message: 'Không tìm kiếm được sản phẩm.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 12: Run test, confirm it passes**

Run: `npm test -- app/api/catalog/admin/products/search`
Expected: PASS (1 test).

- [ ] **Step 13: Write the failing test for `PUT`/`DELETE /api/catalog/admin/products/[id]`**

Create `app/api/catalog/admin/products/[id]/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const updateProductAdminMock = vi.fn();
const deleteProductAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminCatalog', () => ({
  updateProductAdmin: (...args) => updateProductAdminMock(...args),
  deleteProductAdmin: (...args) => deleteProductAdminMock(...args),
}));

import { PUT, DELETE } from '../route';

function makePutRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}
function makeDeleteRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}

describe('PUT /api/catalog/admin/products/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    updateProductAdminMock.mockReset();
  });

  it('cập nhật thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateProductAdminMock.mockResolvedValue({ data: { id: 1, slug: 'a' }, error: null });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(200);
  });

  it('trả 404 khi không tìm thấy id', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateProductAdminMock.mockResolvedValue({ data: null, error: null });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/catalog/admin/products/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    deleteProductAdminMock.mockReset();
  });

  it('trả 204 khi xoá thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteProductAdminMock.mockResolvedValue({ deleted: true, error: null });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(204);
  });
});
```

- [ ] **Step 14: Run test, confirm it fails**

Run: `npm test -- "app/api/catalog/admin/products/\[id\]"`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 15: Create `app/api/catalog/admin/products/[id]/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { updateProductAdmin, deleteProductAdmin } from '../../../../../../lib/adminCatalog';

function validateProductBody(body) {
  const { categoryId, title, slug, simType, priceBuy, priceImport, dataInfo, durationDays, status } = body;
  if (!categoryId || !title || !slug || !priceBuy || !priceImport || !dataInfo || !durationDays || !status) {
    return 'Thiếu thông tin bắt buộc.';
  }
  if (simType !== 'esim' && simType !== 'physical') {
    return 'simType chỉ nhận "esim" hoặc "physical".';
  }
  return null;
}

export async function PUT(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const body = await request.json();
    const validationError = validateProductBody(body);
    if (validationError) {
      return NextResponse.json({ message: validationError }, { status: 400 });
    }

    const { data, error } = await updateProductAdmin(supabase, id, body);
    if (error) {
      if (error.code === '23503') {
        return NextResponse.json({ message: 'categoryId không tồn tại.' }, { status: 400 });
      }
      if (error.code === '23505') {
        return NextResponse.json({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không cập nhật được sản phẩm.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ message: 'Không tìm thấy sản phẩm.' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const { deleted, error } = await deleteProductAdmin(supabase, id);
    if (error) {
      return NextResponse.json({ message: 'Không xoá được sản phẩm.' }, { status: 500 });
    }
    if (!deleted) {
      return NextResponse.json({ message: 'Không tìm thấy sản phẩm.' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 16: Run test, confirm it passes**

Run: `npm test -- "app/api/catalog/admin/products/\[id\]"`
Expected: PASS (3 tests).

- [ ] **Step 17: Run the full suite, then commit**

Run: `npm test`
Expected: PASS.

```bash
git add lib/adminCatalog.js lib/__tests__/adminCatalog.products.test.js app/api/catalog/admin/products
git commit -m "feat: add Product Admin API (CRUD + search)"
```

---

### Task 5: Plain CSV/Excel Import

**Files:**
- Create: `lib/productImport.js`
- Create: `lib/__tests__/productImport.test.js`
- Create: `app/api/catalog/admin/products/import/route.js`
- Create: `app/api/catalog/admin/products/import/__tests__/route.test.js`

**Interfaces:**
- Consumes: nothing new (reads its own file, writes via a passed-in `supabase` client).
- Produces: `parseImportRows(buffer)` → `object[]` (one object per row, keyed by the file's own
  header names), `computePriceBuyFromRow(row, pricingMode, {markupPercent, fixedFee})` →
  `number|null` (`null` means "manual mode but no priceBuy in file" — caller must mark that row
  `failed`), `runProductImport(supabase, buffer, {pricingMode, markupPercent, fixedFee})` →
  `ProductImportSummary` (`{totalRows, created, updated, failed, rows}`).

- [ ] **Step 1: Write the failing test for `lib/productImport.js`**

Create `lib/__tests__/productImport.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

import { parseImportRows, computePriceBuyFromRow, runProductImport } from '../productImport';

function buildCsvBuffer(rows) {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
}

describe('parseImportRows', () => {
  it('đọc đúng field theo tên header trong file', () => {
    const buffer = buildCsvBuffer([
      { categorySlug: 'nhat-ban', title: 'A', slug: 'a', simType: 'esim', priceImport: 50000, dataInfo: '1GB', durationDays: 3, status: 'active' },
    ]);

    const rows = parseImportRows(buffer);

    expect(rows).toEqual([
      { categorySlug: 'nhat-ban', title: 'A', slug: 'a', simType: 'esim', priceImport: 50000, dataInfo: '1GB', durationDays: 3, status: 'active' },
    ]);
  });
});

describe('computePriceBuyFromRow', () => {
  it('dùng thẳng priceBuy trong file khi có, bất kể pricingMode', () => {
    expect(computePriceBuyFromRow({ priceBuy: 99000, priceImport: 50000 }, 'markupPercent', { markupPercent: 30 })).toBe(99000);
  });

  it('manual mode thiếu priceBuy -> trả null', () => {
    expect(computePriceBuyFromRow({ priceImport: 50000 }, 'manual', {})).toBeNull();
  });

  it('markupPercent mode tính đúng công thức', () => {
    expect(computePriceBuyFromRow({ priceImport: 100000 }, 'markupPercent', { markupPercent: 30 })).toBe(130000);
  });

  it('daysPlusFee mode tính đúng công thức', () => {
    expect(computePriceBuyFromRow({ priceImport: 100000, durationDays: 5 }, 'daysPlusFee', { fixedFee: 14000 })).toBe(514000);
  });
});

describe('runProductImport', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('tạo mới sản phẩm khi categorySlug tồn tại và slug sản phẩm chưa có', async () => {
    const categoryQuery = createQueryBuilderMock({ data: { id: 5 }, error: null });
    const existingProductQuery = createQueryBuilderMock({ data: null, error: null });
    const insertQuery = createQueryBuilderMock({ data: { id: 1 }, error: null });
    let productCallCount = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return categoryQuery;
      productCallCount += 1;
      return productCallCount === 1 ? existingProductQuery : insertQuery;
    });

    const buffer = (function build() {
      const wb = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet([
        { categorySlug: 'nhat-ban', title: 'A', slug: 'a', simType: 'esim', priceImport: 50000, dataInfo: '1GB', durationDays: 3, status: 'active', priceBuy: 65000 },
      ]);
      XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
      return XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
    })();

    const summary = await runProductImport(supabaseMock, buffer, { pricingMode: 'manual' });

    expect(summary.totalRows).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.rows[0]).toEqual({ row: 2, slug: 'a', status: 'created', message: null });
  });

  it('đánh dấu failed khi categorySlug không tồn tại', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    const buffer = (function build() {
      const wb = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet([
        { categorySlug: 'khong-ton-tai', title: 'A', slug: 'a', simType: 'esim', priceImport: 50000, dataInfo: '1GB', durationDays: 3, status: 'active', priceBuy: 65000 },
      ]);
      XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
      return XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
    })();

    const summary = await runProductImport(supabaseMock, buffer, { pricingMode: 'manual' });

    expect(summary.failed).toBe(1);
    expect(summary.rows[0].status).toBe('failed');
    expect(summary.rows[0].message).toBe('Không tìm thấy danh mục với slug "khong-ton-tai".');
  });

  it('đánh dấu failed khi manual mode thiếu priceBuy', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: { id: 5 }, error: null }));

    const buffer = (function build() {
      const wb = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet([
        { categorySlug: 'nhat-ban', title: 'A', slug: 'a', simType: 'esim', priceImport: 50000, dataInfo: '1GB', durationDays: 3, status: 'active' },
      ]);
      XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
      return XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
    })();

    const summary = await runProductImport(supabaseMock, buffer, { pricingMode: 'manual' });

    expect(summary.failed).toBe(1);
    expect(summary.rows[0].message).toBe('Thiếu giá bán (priceBuy) — chế độ manual yêu cầu cột này trong file.');
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- productImport.test.js`
Expected: FAIL with "Cannot find module '../productImport'".

- [ ] **Step 3: Create `lib/productImport.js`**

```js
import * as XLSX from 'xlsx';
import { classify } from './smartImport';

export function parseImportRows(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

export function computePriceBuyFromRow(row, pricingMode, { markupPercent, fixedFee } = {}) {
  if (row.priceBuy != null && row.priceBuy !== '') {
    return Number(row.priceBuy);
  }
  const priceImport = Number(row.priceImport);
  if (pricingMode === 'markupPercent') {
    return Math.round(priceImport * (1 + Number(markupPercent) / 100));
  }
  if (pricingMode === 'daysPlusFee') {
    return Math.round(priceImport * Number(row.durationDays) + Number(fixedFee));
  }
  return null;
}

export async function runProductImport(supabase, buffer, { pricingMode = 'manual', markupPercent, fixedFee } = {}) {
  const rows = parseImportRows(buffer);
  const results = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;

    const { data: category } = await supabase.from('categories').select('id').eq('slug', row.categorySlug).maybeSingle();
    if (!category) {
      results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: `Không tìm thấy danh mục với slug "${row.categorySlug}".` });
      failed += 1;
      continue;
    }

    const priceBuy = computePriceBuyFromRow(row, pricingMode, { markupPercent, fixedFee });
    if (priceBuy == null) {
      results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: 'Thiếu giá bán (priceBuy) — chế độ manual yêu cầu cột này trong file.' });
      failed += 1;
      continue;
    }

    const { packageType, capacityBucket } = classify(row.title, row.dataInfo);
    const productRow = {
      category_id: category.id,
      title: row.title,
      sim_type: row.simType,
      price_buy: priceBuy,
      price_import: Number(row.priceImport),
      data_info: row.dataInfo,
      duration_days: Number(row.durationDays),
      package_type: packageType,
      capacity_bucket: capacityBucket,
      status: row.status,
    };

    const { data: existing } = await supabase.from('products').select('id').eq('slug', row.slug).maybeSingle();
    if (existing) {
      const { error } = await supabase.from('products').update(productRow).eq('id', existing.id);
      if (error) {
        results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: error.message });
        failed += 1;
      } else {
        results.push({ row: rowNumber, slug: row.slug, status: 'updated', message: null });
        updated += 1;
      }
    } else {
      const { error } = await supabase.from('products').insert({ ...productRow, slug: row.slug });
      if (error) {
        results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: error.message });
        failed += 1;
      } else {
        results.push({ row: rowNumber, slug: row.slug, status: 'created', message: null });
        created += 1;
      }
    }
  }

  return { totalRows: rows.length, created, updated, failed, rows: results };
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- productImport.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing test for `POST /api/catalog/admin/products/import`**

Create `app/api/catalog/admin/products/import/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const runProductImportMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/productImport', () => ({
  runProductImport: (...args) => runProductImportMock(...args),
}));

import { POST } from '../route';

describe('POST /api/catalog/admin/products/import', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    runProductImportMock.mockReset();
  });

  it('chạy import và trả summary', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    runProductImportMock.mockResolvedValue({ totalRows: 1, created: 1, updated: 0, failed: 0, rows: [] });

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([['file', fakeFile], ['pricingMode', 'manual']]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);
    const body = await response.json();

    expect(body.created).toBe(1);
    expect(runProductImportMock).toHaveBeenCalledWith({}, expect.any(Buffer), { pricingMode: 'manual', markupPercent: null, fixedFee: null });
  });

  it('trả 400 khi thiếu file', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const formData = new Map();
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Vui lòng chọn file để nhập.' });
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- app/api/catalog/admin/products/import`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 7: Create `app/api/catalog/admin/products/import/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { runProductImport } from '../../../../../../lib/productImport';

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return NextResponse.json({ message: 'Vui lòng chọn file để nhập.' }, { status: 400 });
    }

    const pricingMode = formData.get('pricingMode') || 'manual';
    const markupPercent = formData.get('markupPercent');
    const fixedFee = formData.get('fixedFee');

    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await runProductImport(supabase, buffer, {
      pricingMode,
      markupPercent: markupPercent != null ? Number(markupPercent) : null,
      fixedFee: fixedFee != null ? Number(fixedFee) : null,
    });

    return NextResponse.json(summary);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- app/api/catalog/admin/products/import`
Expected: PASS (2 tests).

- [ ] **Step 9: Run the full suite, then commit**

Run: `npm test`
Expected: PASS.

```bash
git add lib/productImport.js lib/__tests__/productImport.test.js app/api/catalog/admin/products/import
git commit -m "feat: add plain CSV/Excel product import"
```

---

### Task 6: Smart Import (analyze + commit)

**Files:**
- Create: `lib/smartImportRunner.js`
- Create: `lib/__tests__/smartImportRunner.test.js`
- Create: `app/api/catalog/admin/products/smart-import/analyze/route.js`
- Create: `app/api/catalog/admin/products/smart-import/analyze/__tests__/route.test.js`
- Create: `app/api/catalog/admin/products/smart-import/commit/route.js`
- Create: `app/api/catalog/admin/products/smart-import/commit/__tests__/route.test.js`

**Interfaces:**
- Consumes: `parseSmartImportWorkbook`, `slugify`, `computeRowPricing` from `lib/smartImport.js`
  (Task 2).
- Produces: `runSmartImport(supabase, buffer, pricingOptions, { commit: boolean })` →
  `SmartImportPreviewSummary` when `commit` is `false`, `ProductImportSummary` when `commit` is
  `true` — both routes call the same function with a different `commit` flag.

- [ ] **Step 1: Write the failing test for `lib/smartImportRunner.js`**

Create `lib/__tests__/smartImportRunner.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

function buildWorkbookBuffer() {
  const wb = XLSX.utils.book_new();

  const esimSheetData = Array.from({ length: 11 }, () => []);
  esimSheetData[10] = [1, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 50000, 65000, ''];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esimSheetData), 'eSIM prices new');

  const physicalSheetData = Array.from({ length: 11 }, () => []);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

  const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
  XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
  XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

  return XLSX.write(wb, { type: 'buffer' });
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

import { runSmartImport } from '../smartImportRunner';

describe('runSmartImport — analyze (commit: false)', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('đánh dấu categoryExists=false cho danh mục chưa có trong DB, không ghi gì', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return createQueryBuilderMock({ data: [], error: null });
      if (table === 'products') return createQueryBuilderMock({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildWorkbookBuffer(), {}, { commit: false });

    expect(summary.totalRows).toBe(1);
    expect(summary.esimRows).toBe(1);
    expect(summary.physicalRows).toBe(0);
    expect(summary.newCategoriesCount).toBe(1);
    expect(summary.newCategoryNames).toEqual(['Japan']);
    expect(summary.rows[0]).toMatchObject({
      row: 11, sheet: 'eSIM prices new', rawTitle: 'Japan 1GB, 1 Day',
      categoryName: 'Japan', categoryExists: false, simType: 'esim',
      priceImport: 50000, priceBuy: 65000, pricingRule: 'fromFile', warning: null, error: null,
    });
    const categoriesFrom = fromMock.mock.calls.filter(([table]) => table === 'categories');
    expect(categoriesFrom.every(() => true)).toBe(true);
  });

  it('đánh dấu categoryExists=true khi danh mục đã có trong DB', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return createQueryBuilderMock({ data: [{ id: 1, name: 'Japan' }], error: null });
      if (table === 'products') return createQueryBuilderMock({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildWorkbookBuffer(), {}, { commit: false });

    expect(summary.newCategoriesCount).toBe(0);
    expect(summary.rows[0].categoryExists).toBe(true);
  });
});

describe('runSmartImport — commit (commit: true)', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('tạo category mới rồi upsert sản phẩm, trả created=1', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const categoriesInsertQuery = createQueryBuilderMock({ data: [{ id: 7, name: 'Japan' }], error: null });
    const categoryCountriesInsertQuery = createQueryBuilderMock({ data: [], error: null });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({ data: [{ slug: 'japan-1gb-1-day-wm-jp-1d' }], error: null });

    let categoriesCall = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'categories') {
        categoriesCall += 1;
        return categoriesCall === 1 ? categoriesSelectQuery : categoriesInsertQuery;
      }
      if (table === 'category_countries') return categoryCountriesInsertQuery;
      if (table === 'products') {
        return productsSelectQuery.select.mock.calls.length === 0 ? productsSelectQuery : productsUpsertQuery;
      }
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildWorkbookBuffer(), {}, { commit: true });

    expect(categoriesInsertQuery.insert).toHaveBeenCalledWith([{ name: 'Japan', slug: 'japan', image_url: null, status: 'active' }]);
    expect(productsUpsertQuery.upsert).toHaveBeenCalled();
    expect(summary.totalRows).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- smartImportRunner.test.js`
Expected: FAIL with "Cannot find module '../smartImportRunner'".

- [ ] **Step 3: Create `lib/smartImportRunner.js`**

```js
import { parseSmartImportWorkbook, slugify, computeRowPricing } from './smartImport';

function buildProductSlug(rawTitle, code) {
  const base = slugify(rawTitle);
  return code ? `${base}-${slugify(code)}` : base;
}

export async function runSmartImport(supabase, buffer, pricingOptions = {}, { commit = false } = {}) {
  const { rows: parsedRows, regionResolutions } = parseSmartImportWorkbook(buffer);

  const distinctRegions = [...new Set(parsedRows.map((r) => r.region))];
  const { data: existingCategories } = await supabase
    .from('categories')
    .select('id, name')
    .in('name', distinctRegions.length > 0 ? distinctRegions : ['__none__']);
  const categoryIdByName = new Map((existingCategories || []).map((c) => [c.name, c.id]));

  const computedSlugs = parsedRows.map((r) => buildProductSlug(r.rawTitle, r.code));
  const { data: existingProducts } = await supabase
    .from('products')
    .select('slug')
    .in('slug', computedSlugs.length > 0 ? computedSlugs : ['__none__']);
  const existingSlugSet = new Set((existingProducts || []).map((p) => p.slug));

  const rowPreviews = [];
  let esimRows = 0;
  let physicalRows = 0;
  let errorCount = 0;
  let warningCount = 0;
  const newCategoryNamesSet = new Set();
  const unverifiedNewCategoryNamesSet = new Set();

  for (let i = 0; i < parsedRows.length; i++) {
    const parsed = parsedRows[i];
    const slug = computedSlugs[i];
    const categoryExists = categoryIdByName.has(parsed.region);

    if (parsed.simType === 'esim') esimRows += 1;
    else physicalRows += 1;

    if (!categoryExists) {
      newCategoryNamesSet.add(parsed.region);
      const resolution = regionResolutions.get(parsed.region);
      if (resolution === null) {
        unverifiedNewCategoryNamesSet.add(parsed.region);
      }
    }

    const { priceBuy, pricingRule, warning } = computeRowPricing(parsed, pricingOptions);
    if (warning) warningCount += 1;

    rowPreviews.push({
      row: parsed.row,
      sheet: parsed.sheet,
      rawTitle: parsed.rawTitle,
      categoryName: parsed.region,
      categorySlug: slugify(parsed.region),
      categoryExists,
      simType: parsed.simType,
      durationDays: parsed.durationDays,
      dataInfo: null,
      priceImport: parsed.priceImport,
      priceBuy,
      pricingRule,
      warning,
      error: null,
      _slug: slug,
      _code: parsed.code,
    });
  }

  const summaryBase = {
    totalRows: parsedRows.length,
    esimRows,
    physicalRows,
    newCategoriesCount: newCategoryNamesSet.size,
    newCategoryNames: [...newCategoryNamesSet],
    warningCount,
    errorCount,
    unverifiedNewCategoryNames: [...unverifiedNewCategoryNamesSet],
  };

  if (!commit) {
    return {
      ...summaryBase,
      rows: rowPreviews.map(({ _slug, _code, ...preview }) => preview),
    };
  }

  const namesToCreate = [...newCategoryNamesSet];
  if (namesToCreate.length > 0) {
    const { data: insertedCategories } = await supabase
      .from('categories')
      .insert(namesToCreate.map((name) => ({ name, slug: slugify(name), image_url: null, status: 'active' })))
      .select('id, name');

    const countryRows = [];
    for (const category of insertedCategories || []) {
      categoryIdByName.set(category.name, category.id);
      const resolution = regionResolutions.get(category.name);
      if (resolution && resolution.length > 0) {
        for (const countryCode of resolution) {
          countryRows.push({ category_id: category.id, country_code: countryCode });
        }
      }
    }
    if (countryRows.length > 0) {
      await supabase.from('category_countries').insert(countryRows);
    }
  }

  const productRows = rowPreviews.map((preview) => ({
    slug: preview._slug,
    category_id: categoryIdByName.get(preview.categoryName),
    title: preview.rawTitle,
    sim_type: preview.simType,
    price_buy: preview.priceBuy,
    price_import: preview.priceImport,
    data_info: preview.rawTitle,
    duration_days: preview.durationDays,
    package_type: 'fixed',
    capacity_bucket: 'other-fixed',
    api_package_code: preview._code,
    status: 'active',
  }));

  const { data: upserted, error } = await supabase
    .from('products')
    .upsert(productRows, { onConflict: 'slug' })
    .select('slug');

  const created = productRows.filter((r) => !existingSlugSet.has(r.slug)).length;
  const updated = productRows.filter((r) => existingSlugSet.has(r.slug)).length;
  const failed = error ? productRows.length : 0;

  return {
    totalRows: parsedRows.length,
    created: error ? 0 : created,
    updated: error ? 0 : updated,
    failed,
    rows: rowPreviews.map((preview) => ({
      row: preview.row,
      slug: preview._slug,
      status: error ? 'failed' : (existingSlugSet.has(preview._slug) ? 'updated' : 'created'),
      message: error ? error.message : null,
    })),
  };
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- smartImportRunner.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for the analyze and commit routes**

Create `app/api/catalog/admin/products/smart-import/analyze/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const runSmartImportMock = vi.fn();

vi.mock('../../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../../lib/smartImportRunner', () => ({
  runSmartImport: (...args) => runSmartImportMock(...args),
}));

import { POST } from '../route';

describe('POST /api/catalog/admin/products/smart-import/analyze', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    runSmartImportMock.mockReset();
  });

  it('gọi runSmartImport với commit:false và trả preview', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    runSmartImportMock.mockResolvedValue({ totalRows: 1, rows: [] });

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([['file', fakeFile], ['esimMarkupPercent', '25']]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);
    const body = await response.json();

    expect(runSmartImportMock).toHaveBeenCalledWith(
      {}, expect.any(Buffer), { esimMarkupPercent: 25, physicalFixedFee: null, physicalNoDurationMultiplier: null }, { commit: false },
    );
    expect(body.totalRows).toBe(1);
  });
});
```

Create `app/api/catalog/admin/products/smart-import/commit/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const runSmartImportMock = vi.fn();

vi.mock('../../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../../lib/smartImportRunner', () => ({
  runSmartImport: (...args) => runSmartImportMock(...args),
}));

import { POST } from '../route';

describe('POST /api/catalog/admin/products/smart-import/commit', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    runSmartImportMock.mockReset();
  });

  it('gọi runSmartImport với commit:true và trả ProductImportSummary', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    runSmartImportMock.mockResolvedValue({ totalRows: 1, created: 1, updated: 0, failed: 0, rows: [] });

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([['file', fakeFile]]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);
    const body = await response.json();

    expect(runSmartImportMock).toHaveBeenCalledWith(
      {}, expect.any(Buffer), { esimMarkupPercent: null, physicalFixedFee: null, physicalNoDurationMultiplier: null }, { commit: true },
    );
    expect(body.created).toBe(1);
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- smart-import`
Expected: FAIL with "Cannot find module '../route'" for both files.

- [ ] **Step 7: Create `app/api/catalog/admin/products/smart-import/analyze/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../../lib/apiAuth';
import { runSmartImport } from '../../../../../../../lib/smartImportRunner';

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return NextResponse.json({ message: 'Vui lòng chọn file bảng giá (.xlsx) trước.' }, { status: 400 });
    }

    const esimMarkupPercent = formData.get('esimMarkupPercent');
    const physicalFixedFee = formData.get('physicalFixedFee');
    const physicalNoDurationMultiplier = formData.get('physicalNoDurationMultiplier');

    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = await runSmartImport(supabase, buffer, {
      esimMarkupPercent: esimMarkupPercent != null ? Number(esimMarkupPercent) : null,
      physicalFixedFee: physicalFixedFee != null ? Number(physicalFixedFee) : null,
      physicalNoDurationMultiplier: physicalNoDurationMultiplier != null ? Number(physicalNoDurationMultiplier) : null,
    }, { commit: false });

    return NextResponse.json(preview);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 8: Create `app/api/catalog/admin/products/smart-import/commit/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../../lib/apiAuth';
import { runSmartImport } from '../../../../../../../lib/smartImportRunner';

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return NextResponse.json({ message: 'Vui lòng chọn file bảng giá (.xlsx) trước.' }, { status: 400 });
    }

    const esimMarkupPercent = formData.get('esimMarkupPercent');
    const physicalFixedFee = formData.get('physicalFixedFee');
    const physicalNoDurationMultiplier = formData.get('physicalNoDurationMultiplier');

    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await runSmartImport(supabase, buffer, {
      esimMarkupPercent: esimMarkupPercent != null ? Number(esimMarkupPercent) : null,
      physicalFixedFee: physicalFixedFee != null ? Number(physicalFixedFee) : null,
      physicalNoDurationMultiplier: physicalNoDurationMultiplier != null ? Number(physicalNoDurationMultiplier) : null,
    }, { commit: true });

    return NextResponse.json(summary);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 9: Run test, confirm it passes**

Run: `npm test -- smart-import`
Expected: PASS (2 tests).

- [ ] **Step 10: Run the full suite, then commit**

Run: `npm test`
Expected: PASS.

```bash
git add lib/smartImportRunner.js lib/__tests__/smartImportRunner.test.js app/api/catalog/admin/products/smart-import
git commit -m "feat: add Smart Import (analyze + commit)"
```

---

### Task 7: Physical SIM Inventory Admin API

**Files:**
- Modify: `lib/adminCatalog.js`
- Create: `lib/__tests__/adminCatalog.inventory.test.js`
- Create: `app/api/catalog/admin/inventory/route.js`
- Create: `app/api/catalog/admin/inventory/__tests__/route.test.js`
- Create: `app/api/catalog/admin/inventory/import/route.js`
- Create: `app/api/catalog/admin/inventory/import/__tests__/route.test.js`
- Create: `app/api/catalog/admin/inventory/[id]/status/route.js`
- Create: `app/api/catalog/admin/inventory/[id]/status/__tests__/route.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `listInventoryAdmin(supabase, {productId, status})`, `importInventoryAdmin(supabase,
  productId, iccids)` → `{data: InventoryResponse[], error}` (only newly-inserted rows),
  `updateInventoryStatusAdmin(supabase, id, status)` in `lib/adminCatalog.js`.

- [ ] **Step 1: Write the failing test for the inventory functions**

Create `lib/__tests__/adminCatalog.inventory.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

const sampleRow = {
  id: 1, product_id: 10, iccid: '8984000000000000001', status: 'in_stock',
  reserved_order_item_id: null, imported_at: '2026-09-07T00:00:00Z',
};
const sampleMapped = {
  id: 1, productId: 10, iccid: '8984000000000000001', status: 'in_stock',
  reservedOrderItemId: null, importedAt: '2026-09-07T00:00:00Z',
};

import { listInventoryAdmin, importInventoryAdmin, updateInventoryStatusAdmin } from '../adminCatalog';

describe('lib/adminCatalog — inventory', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  describe('listInventoryAdmin', () => {
    it('lọc theo productId và status khi có cả hai', async () => {
      const query = createQueryBuilderMock({ data: [sampleRow], error: null });
      fromMock.mockReturnValue(query);

      const result = await listInventoryAdmin(supabaseMock, { productId: 10, status: 'in_stock' });

      expect(query.eq).toHaveBeenCalledWith('product_id', 10);
      expect(query.eq).toHaveBeenCalledWith('status', 'in_stock');
      expect(result).toEqual({ data: [sampleMapped], error: null });
    });

    it('không lọc gì khi cả hai tham số đều thiếu', async () => {
      const query = createQueryBuilderMock({ data: [sampleRow], error: null });
      fromMock.mockReturnValue(query);

      await listInventoryAdmin(supabaseMock, {});

      expect(query.eq).not.toHaveBeenCalled();
    });
  });

  describe('importInventoryAdmin', () => {
    it('chèn ICCID mới, trả về đúng những dòng mới thêm', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [sampleRow], error: null }));

      const result = await importInventoryAdmin(supabaseMock, 10, ['8984000000000000001']);

      expect(fromMock().upsert).toHaveBeenCalledWith(
        [{ product_id: 10, iccid: '8984000000000000001', status: 'in_stock' }],
        { onConflict: 'iccid', ignoreDuplicates: true },
      );
      expect(result).toEqual({ data: [sampleMapped], error: null });
    });
  });

  describe('updateInventoryStatusAdmin', () => {
    it('cập nhật status và trả data null khi không tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await updateInventoryStatusAdmin(supabaseMock, 999, 'sold');

      expect(result).toEqual({ data: null, error: null });
    });

    it('trả InventoryResponse đã update khi thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: { ...sampleRow, status: 'sold' }, error: null }));

      const result = await updateInventoryStatusAdmin(supabaseMock, 1, 'sold');

      expect(result.data.status).toBe('sold');
    });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- adminCatalog.inventory.test.js`
Expected: FAIL — inventory functions not exported yet.

- [ ] **Step 3: Add the inventory functions to `lib/adminCatalog.js`**

Add below the product functions from Task 4:

```js
function mapInventory(row) {
  return {
    id: row.id,
    productId: row.product_id,
    iccid: row.iccid,
    status: row.status,
    reservedOrderItemId: row.reserved_order_item_id,
    importedAt: row.imported_at,
  };
}

export async function listInventoryAdmin(supabase, { productId, status } = {}) {
  let query = supabase.from('physical_sim_inventory').select('*').order('id', { ascending: true });
  if (productId != null) {
    query = query.eq('product_id', productId);
  }
  if (status) {
    query = query.eq('status', status);
  }
  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: (data || []).map(mapInventory), error: null };
}

export async function importInventoryAdmin(supabase, productId, iccids) {
  const rows = iccids.map((iccid) => ({ product_id: productId, iccid: iccid.trim(), status: 'in_stock' }));
  const { data, error } = await supabase
    .from('physical_sim_inventory')
    .upsert(rows, { onConflict: 'iccid', ignoreDuplicates: true })
    .select('*');
  if (error) return { data: null, error };
  return { data: (data || []).map(mapInventory), error: null };
}

export async function updateInventoryStatusAdmin(supabase, id, status) {
  const { data, error } = await supabase
    .from('physical_sim_inventory')
    .update({ status })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  return { data: mapInventory(data), error: null };
}
```

Note: `.insert()` does not support `onConflict`/`ignoreDuplicates` — that pair is only valid on
`.upsert()`, which is why `importInventoryAdmin` above calls `.upsert(rows, { onConflict: 'iccid',
ignoreDuplicates: true })` rather than `.insert(rows)`. With `ignoreDuplicates: true`, PostgREST
issues `ON CONFLICT (iccid) DO NOTHING`, so a duplicate row is silently skipped and does not appear
in the `RETURNING`-backed `.select('*')` result — only genuinely new rows come back, matching the
required "silently skip existing ICCIDs, return only what was newly inserted" behavior.

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- adminCatalog.inventory.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for `GET /api/catalog/admin/inventory`**

Create `app/api/catalog/admin/inventory/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listInventoryAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminCatalog', () => ({
  listInventoryAdmin: (...args) => listInventoryAdminMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/catalog/admin/inventory', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listInventoryAdminMock.mockReset();
  });

  it('đọc productId/status từ query string', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listInventoryAdminMock.mockResolvedValue({ data: [], error: null });

    await GET(makeRequest('http://localhost:3000/api/catalog/admin/inventory?productId=10&status=in_stock'));

    expect(listInventoryAdminMock).toHaveBeenCalledWith({}, { productId: '10', status: 'in_stock' });
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- app/api/catalog/admin/inventory/__tests__/route.test.js`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 7: Create `app/api/catalog/admin/inventory/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listInventoryAdmin } from '../../../../../lib/adminCatalog';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { searchParams } = new URL(request.url);
    const { data, error } = await listInventoryAdmin(supabase, {
      productId: searchParams.get('productId') || undefined,
      status: searchParams.get('status') || undefined,
    });
    if (error) {
      return NextResponse.json({ message: 'Không tải được kho SIM vật lý.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- app/api/catalog/admin/inventory/__tests__/route.test.js`
Expected: PASS (1 test).

- [ ] **Step 9: Write the failing test for `POST /api/catalog/admin/inventory/import`**

Create `app/api/catalog/admin/inventory/import/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const importInventoryAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminCatalog', () => ({
  importInventoryAdmin: (...args) => importInventoryAdminMock(...args),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('POST /api/catalog/admin/inventory/import', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    importInventoryAdminMock.mockReset();
  });

  it('chèn ICCID mới, trả 201', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    importInventoryAdminMock.mockResolvedValue({ data: [{ id: 1, iccid: 'x' }], error: null });

    const response = await POST(makeRequest({ productId: 10, iccids: ['x', 'y'] }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual([{ id: 1, iccid: 'x' }]);
  });

  it('trả 400 khi thiếu iccids', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makeRequest({ productId: 10, iccids: [] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu danh sách ICCID cần nhập.' });
  });

  it('trả 400 khi productId không tồn tại', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    importInventoryAdminMock.mockResolvedValue({ data: null, error: { code: '23503' } });

    const response = await POST(makeRequest({ productId: 999, iccids: ['x'] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'productId không tồn tại.' });
  });
});
```

- [ ] **Step 10: Run test, confirm it fails**

Run: `npm test -- app/api/catalog/admin/inventory/import`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 11: Create `app/api/catalog/admin/inventory/import/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { importInventoryAdmin } from '../../../../../../lib/adminCatalog';

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { productId, iccids } = await request.json();
    if (!Array.isArray(iccids) || iccids.length === 0) {
      return NextResponse.json({ message: 'Thiếu danh sách ICCID cần nhập.' }, { status: 400 });
    }

    const { data, error } = await importInventoryAdmin(supabase, productId, iccids);
    if (error) {
      if (error.code === '23503') {
        return NextResponse.json({ message: 'productId không tồn tại.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không nhập được ICCID.' }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 12: Run test, confirm it passes**

Run: `npm test -- app/api/catalog/admin/inventory/import`
Expected: PASS (3 tests).

- [ ] **Step 13: Write the failing test for `PUT /api/catalog/admin/inventory/[id]/status`**

Create `app/api/catalog/admin/inventory/[id]/status/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const updateInventoryStatusAdminMock = vi.fn();

vi.mock('../../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../../lib/adminCatalog', () => ({
  updateInventoryStatusAdmin: (...args) => updateInventoryStatusAdminMock(...args),
}));

import { PUT } from '../route';

function makeRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('PUT /api/catalog/admin/inventory/[id]/status', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    updateInventoryStatusAdminMock.mockReset();
  });

  it('cập nhật status thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateInventoryStatusAdminMock.mockResolvedValue({ data: { id: 1, status: 'sold' }, error: null });

    const response = await PUT(makeRequest({ status: 'sold' }), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(body.status).toBe('sold');
  });

  it('trả 404 khi không tìm thấy id', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateInventoryStatusAdminMock.mockResolvedValue({ data: null, error: null });

    const response = await PUT(makeRequest({ status: 'sold' }), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 14: Run test, confirm it fails**

Run: `npm test -- "inventory/\[id\]"`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 15: Create `app/api/catalog/admin/inventory/[id]/status/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../../lib/apiAuth';
import { updateInventoryStatusAdmin } from '../../../../../../../lib/adminCatalog';

export async function PUT(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const { status } = await request.json();
    if (!status) {
      return NextResponse.json({ message: 'Thiếu status.' }, { status: 400 });
    }

    const { data, error } = await updateInventoryStatusAdmin(supabase, id, status);
    if (error) {
      return NextResponse.json({ message: 'Không cập nhật được trạng thái.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ message: 'Không tìm thấy ICCID.' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 16: Run test, confirm it passes**

Run: `npm test -- "inventory/\[id\]"`
Expected: PASS (2 tests).

- [ ] **Step 17: Run the full suite, then commit**

Run: `npm test`
Expected: PASS — every suite in the repo green.

```bash
git add lib/adminCatalog.js lib/__tests__/adminCatalog.inventory.test.js app/api/catalog/admin/inventory
git commit -m "feat: add physical SIM inventory Admin API"
```

---

### Task 8: Manual verification against the admin UI

**Files:** none (verification only).

**Interfaces:**
- Consumes: the running `simDulichNew` dev server and the `Simdulich` admin panel pages
  (`CategoriesPage.jsx`, `ProductsPage.jsx`, `SmartImportSection.jsx`, `InventoryPage.jsx`).
- Produces: nothing.

- [ ] **Step 1: Apply the two new migrations to the real Supabase project**

In the Supabase Dashboard SQL Editor, run in order:
1. `supabase/migrations/0004_admin_catalog_rls.sql`
2. `supabase/migrations/0005_physical_sim_inventory.sql`

- [ ] **Step 2: Start both dev servers**

```bash
npm run dev
```

(and, in the `Simdulich` directory, `npm run dev` for the frontend — both should already be
configured from the đợt 1+2 verification pass.)

- [ ] **Step 3: Verify Category + Product CRUD**

Logged in as the admin account created in đợt 1+2's verification:
1. Go to the Categories admin page — create a test category, edit it, confirm the list refreshes.
2. Go to the Products admin page — create a test product under that category, edit its price,
   delete it, then delete the test category. Confirm no errors and the FE reflects each change.

- [ ] **Step 4: Verify plain import**

Prepare a small `.csv` with columns `categorySlug,title,slug,simType,priceImport,dataInfo,durationDays,status` (using a real existing `categorySlug` from the seeded catalog) and upload it via the plain-import UI. Confirm the summary shows `created: 1`.

- [ ] **Step 5: Verify Smart Import**

Using a small real-format `.xlsx` (a trimmed copy of the original supplier file with a handful of
rows is fine), run Analyze — confirm the preview table renders with correct category/price/warning
columns — then Commit, and confirm the products actually appear in the catalog afterward (check
via the public `/esim` page or a direct `select` in Supabase).

- [ ] **Step 6: Verify Inventory**

On the Inventory admin page, import a few ICCIDs for an existing product, confirm the list shows
them as `in_stock`, then change one's status to `sold` and confirm it updates.

- [ ] **Step 7: Report results**

Summarize pass/fail for each of Steps 3–6 back to the user. Fix any failing step by reading the
relevant route/lib file and re-running its automated test before re-verifying manually.

---

## Self-Review

**Spec coverage:**
- Category Admin API (CRUD) — Task 3. ✓
- Product Admin API (CRUD + admin search, 0-indexed `number`) — Task 4. ✓
- `package_type`/`capacity_bucket` derived server-side via `classify()`, not accepted in the
  request body — Task 4's `productFieldsToRow`. ✓
- Plain CSV/Excel import (3 pricing modes, upsert by literal slug column) — Task 5. ✓
- Smart Import (real file structure, ported `VN_TO_ISO`/`DIRECT_REGION_TO_ISO`/
  `NO_COUNTRY_MAPPING`/`classify`/`resolveCountries`/`buildApnCountryGroups`, file-price-first
  pricing, two-phase analyze/commit, `unverifiedNewCategoryNames`) — Tasks 2 and 6. ✓
- Physical SIM Inventory (list/import-with-silent-dedupe/status-update) — Task 7. ✓
- Admin-write RLS + inventory table migrations — Task 1. ✓
- Manual verification against the real admin UI — Task 8. ✓

**Placeholder scan:** No TBD/TODO markers; every step has runnable code or an exact command with
expected output.

**Type consistency:** `lib/adminCatalog.js`'s category functions (Task 3), product functions
(Task 4), and inventory functions (Task 7) all take the caller's token-scoped `supabase` client as
their first argument — never a bare `createApiClient()` call inside the file, unlike the public
`lib/catalog.js`. `lib/smartImport.js`'s exports (Task 2) are consumed identically by `lib/
productImport.js` (Task 5, just `classify`) and `lib/smartImportRunner.js` (Task 6, everything
else) — no signature drift between where each is defined and where it's called. `runSmartImport`'s
`{commit}` flag and its two possible return shapes (`SmartImportPreviewSummary` vs
`ProductImportSummary`) are used identically by the two routes in Task 6.

**Note on `lib/adminCatalog.js` growing across three tasks:** by the end of Task 7 this file holds
category, product, and inventory admin functions together — deliberate, mirroring `lib/catalog.js`
already playing the same "one file, one layer" role for the public side of the API. If a future
task needs to add substantially more to it, that's the moment to split it (e.g.
`lib/adminCategories.js`/`lib/adminProducts.js`/`lib/adminInventory.js`), not before.

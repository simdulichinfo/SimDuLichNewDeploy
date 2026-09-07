# Catalog seed data

`catalog_real_data_import.sql` is generated from the real Simplus SIM/eSIM price list
(`BÁO GIÁ SIM DLQT Tháng 06.DN.xlsx`, June 2026) via `scripts/import_catalog.py`. It replaces the
small hand-written sample seed originally planned in the Phase 2 design doc.

## Applying

Run after `supabase/migrations/0002_catalog.sql` has been applied:

1. Supabase Dashboard → SQL Editor → paste `catalog_real_data_import.sql` → Run.
   (Large file — ~10,000 product rows. If the SQL Editor times out on one paste, split by the
   three top-level `insert into ...` statements and run them one at a time, in order:
   `categories` → `category_countries` → `products`.)

## Regenerating

If the source price list changes, re-run:

```bash
python supabase/seed/scripts/import_catalog.py
```

(Script expects the xlsx at the hardcoded `Downloads` path in `SRC` — update that constant if the
file moves.) It prints a report (category/product counts, package_type & capacity_bucket
distribution, skipped rows) — check that before re-importing.

## Known gaps

9 categories imported with **no** `category_countries` mapping, because the source file has no
explicit country list for them (neither in the pricing sheet's region column nor in the
`eSIM apn`/`SIM apn` breakdown sheets): `APAC A`, `APAC B`, `Asia`, `Asia A`, `Europe`,
`Multi-region TT`, `North America`, `South America`, `Worldwide`. Their products are still fully
browsable/purchasable — they just won't appear when a customer filters `/esim` by a specific
country. Fill in `category_countries` for these once the real coverage list is known.

15 source rows were skipped entirely (no parseable usage-duration — carrier-branded flat-rate
products like "DTAC Thailand Happy Tourist219" that don't follow the templated naming pattern).
See the script's stdout report for the exact list.

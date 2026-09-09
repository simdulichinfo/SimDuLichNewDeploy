import { parseSmartImportWorkbook, slugify, computeRowPricing, classify } from './smartImport';

// Real request-line limits sit around ~8KB; 100 slugs/names of ~40-50 chars
// each stays comfortably under that for a single `.in()` lookup.
const SELECT_IN_CHUNK_SIZE = 100;
const UPSERT_CHUNK_SIZE = 500;
// Fallback granularity when a full chunk upsert fails: first retry in
// sub-batches of 10 (cuts request count ~50x vs one-row-at-a-time for the
// common case where only a handful of rows in a 500-row chunk are bad), then
// drop to one row at a time only for the sub-batches that still fail, so the
// failure narrows down to the actual offending row(s).
const UPSERT_RETRY_SUBBATCH_SIZE = 10;

// Thrown when a chunked existence lookup (categories-by-name or
// products-by-slug) fails. A failed lookup must never be silently treated as
// "zero matching rows" — that would make already-existing categories/products
// look brand new to the caller (re-insert collisions, wrong created/updated
// counts). Callers (the API routes) catch this and surface a clean top-level
// error instead of a plausible-looking-but-wrong result.
export class SmartImportLookupError extends Error {}

function buildProductSlug(rawTitle, code) {
  const base = slugify(rawTitle);
  const full = code ? `${base}-${slugify(code)}` : base;
  return full.slice(0, 200);
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Runs `.select(columns).in(column, values)` in chunks of SELECT_IN_CHUNK_SIZE
// so a multi-thousand-row file doesn't blow past PostgREST/HTTP request-size
// limits with one giant `.in()` call. Merges all chunk results together.
async function selectInChunked(supabase, table, columns, column, values) {
  const uniqueValues = [...new Set(values)];
  const valueChunks = uniqueValues.length > 0 ? chunkArray(uniqueValues, SELECT_IN_CHUNK_SIZE) : [['__none__']];
  const rows = [];
  for (const valueChunk of valueChunks) {
    const { data, error } = await supabase.from(table).select(columns).in(column, valueChunk);
    if (error) {
      throw new SmartImportLookupError(
        `Không đọc được dữ liệu hiện có từ bảng "${table}": ${error.message}`,
      );
    }
    rows.push(...(data || []));
  }
  return rows;
}

// Reproduces import_catalog.py's in-file slug de-duplication exactly (see
// that script's `seen_slugs` counter, ~lines 256-263): process rows in
// original order, and for every repeat of an already-seen base slug, append
// -1, -2, ... (incrementing per repeated base). The FIRST occurrence always
// keeps the bare base slug. This matches the scheme the already-seeded
// production data was built with, so both `<slug>` and `<slug>-1` stay
// independently upsertable by every future Smart Import run — no row is ever
// dropped for colliding with another row in the same file.
function computeDisambiguatedSlugs(rows) {
  const seenCounts = new Map();
  return rows.map((row) => {
    const base = buildProductSlug(row.rawTitle, row.code);
    const n = seenCounts.get(base) || 0;
    seenCounts.set(base, n + 1);
    return n > 0 ? `${base}-${n}` : base;
  });
}

// Upserts one chunk of product rows. The common case (no errors) is a single
// efficient chunked upsert. Only when the FULL chunk fails do we retry in
// smaller sub-batches (see UPSERT_RETRY_SUBBATCH_SIZE) so the failure narrows
// down to the actual offending row(s) instead of collaterally failing every
// healthy row that happened to share the chunk with a bad one.
async function upsertProductsChunk(supabase, rowsChunk) {
  const { error } = await supabase.from('products').upsert(rowsChunk, { onConflict: 'slug' });
  if (!error) {
    const outcomes = new Map();
    for (const row of rowsChunk) outcomes.set(row.slug, { ok: true, message: null });
    return outcomes;
  }

  const outcomes = new Map();
  for (const subChunk of chunkArray(rowsChunk, UPSERT_RETRY_SUBBATCH_SIZE)) {
    const { error: subError } = await supabase.from('products').upsert(subChunk, { onConflict: 'slug' });
    if (!subError) {
      for (const row of subChunk) outcomes.set(row.slug, { ok: true, message: null });
    } else if (subChunk.length === 1) {
      outcomes.set(subChunk[0].slug, { ok: false, message: subError.message });
    } else {
      for (const row of subChunk) {
        const { error: rowError } = await supabase.from('products').upsert([row], { onConflict: 'slug' });
        outcomes.set(row.slug, rowError ? { ok: false, message: rowError.message } : { ok: true, message: null });
      }
    }
  }
  return outcomes;
}

export async function runSmartImport(supabase, buffer, pricingOptions = {}, { commit = false } = {}) {
  const { rows: parsedRows, regionResolutions } = parseSmartImportWorkbook(buffer);

  const validIndices = [];
  for (let i = 0; i < parsedRows.length; i++) {
    if (!parsedRows[i].parseError) validIndices.push(i);
  }
  const validRows = validIndices.map((i) => parsedRows[i]);

  const disambiguatedSlugs = computeDisambiguatedSlugs(validRows);
  const slugByIndex = new Map();
  validIndices.forEach((rowIndex, j) => slugByIndex.set(rowIndex, disambiguatedSlugs[j]));

  const distinctRegions = [...new Set(validRows.map((r) => r.region))];
  const existingCategories = await selectInChunked(supabase, 'categories', 'id, name', 'name', distinctRegions);
  const categoryIdByName = new Map(existingCategories.map((c) => [c.name, c.id]));

  const existingProducts = await selectInChunked(supabase, 'products', 'slug', 'slug', disambiguatedSlugs);
  const existingSlugSet = new Set(existingProducts.map((p) => p.slug));

  const rowPreviews = [];
  let esimRows = 0;
  let physicalRows = 0;
  let errorCount = 0;
  let warningCount = 0;
  const newCategoryNamesSet = new Set();
  const unverifiedNewCategoryNamesSet = new Set();

  for (let i = 0; i < parsedRows.length; i++) {
    const parsed = parsedRows[i];

    if (parsed.simType === 'esim') esimRows += 1;
    else physicalRows += 1;

    if (parsed.parseError) {
      errorCount += 1;
      rowPreviews.push({
        row: parsed.row,
        sheet: parsed.sheet,
        rawTitle: parsed.rawTitle,
        categoryName: parsed.region,
        categorySlug: parsed.region ? slugify(parsed.region) : null,
        categoryExists: false,
        simType: parsed.simType,
        durationDays: parsed.durationDays,
        dataInfo: null,
        priceImport: parsed.priceImport,
        priceBuy: null,
        pricingRule: null,
        warning: null,
        error: parsed.parseError,
        _isError: true,
        _slug: null,
        _code: parsed.code,
        _description: parsed.description,
        _packageType: null,
        _capacityBucket: null,
      });
      continue;
    }

    const slug = slugByIndex.get(i);
    const categoryExists = categoryIdByName.has(parsed.region);

    if (!categoryExists) {
      newCategoryNamesSet.add(parsed.region);
      const resolution = regionResolutions.get(parsed.region);
      if (resolution === null) {
        unverifiedNewCategoryNamesSet.add(parsed.region);
      }
    }

    const { priceBuy, pricingRule, warning } = computeRowPricing(parsed, pricingOptions);
    if (warning) warningCount += 1;

    const { packageType, capacityBucket, dataInfo } = classify(parsed.rawTitle, parsed.description);

    rowPreviews.push({
      row: parsed.row,
      sheet: parsed.sheet,
      rawTitle: parsed.rawTitle,
      categoryName: parsed.region,
      categorySlug: slugify(parsed.region),
      categoryExists,
      simType: parsed.simType,
      durationDays: parsed.durationDays,
      dataInfo,
      priceImport: parsed.priceImport,
      priceBuy,
      pricingRule,
      warning,
      error: null,
      _isError: false,
      _slug: slug,
      _code: parsed.code,
      _description: parsed.description,
      _packageType: packageType,
      _capacityBucket: capacityBucket,
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
      rows: rowPreviews.map(({
        _isError, _slug, _code, _description, _packageType, _capacityBucket, ...preview
      }) => preview),
    };
  }

  const namesToCreate = [...newCategoryNamesSet];
  const failedCategoryNames = new Set();
  const categoryFailureMessage = new Map();
  let categoryCountriesWarning = null;

  if (namesToCreate.length > 0) {
    const { data: upsertedCategories, error: categoriesUpsertError } = await supabase
      .from('categories')
      .upsert(
        namesToCreate.map((name) => ({ name, slug: slugify(name), image_url: null, status: 'active' })),
        { onConflict: 'slug', ignoreDuplicates: true },
      )
      .select('id, name');

    if (categoriesUpsertError) {
      // Whole-statement failure unrelated to a per-row slug collision (e.g. a
      // genuine network/DB error) — fail every new category, matching the
      // previous all-or-nothing behavior for this now-rare case.
      for (const name of namesToCreate) {
        failedCategoryNames.add(name);
        categoryFailureMessage.set(name, `Không tạo được danh mục "${name}": ${categoriesUpsertError.message}`);
      }
    } else {
      const returnedNames = new Set((upsertedCategories || []).map((c) => c.name));
      const countryRows = [];
      for (const category of upsertedCategories || []) {
        categoryIdByName.set(category.name, category.id);
        const resolution = regionResolutions.get(category.name);
        if (resolution && resolution.length > 0) {
          for (const countryCode of resolution) {
            countryRows.push({ category_id: category.id, country_code: countryCode });
          }
        }
      }
      // A name absent from the returned rows means its slug collided with a
      // DIFFERENT existing category (ignoreDuplicates skipped it) — fail only
      // that specific region's rows, not the whole batch.
      for (const name of namesToCreate) {
        if (!returnedNames.has(name)) {
          failedCategoryNames.add(name);
          categoryFailureMessage.set(name, `Không tạo được danh mục "${name}" — slug bị trùng với danh mục khác.`);
        }
      }
      if (countryRows.length > 0) {
        const { error: categoryCountriesError } = await supabase.from('category_countries').insert(countryRows);
        if (categoryCountriesError) {
          categoryCountriesWarning = categoryCountriesError.message;
        }
      }
    }
  }

  const productRows = [];
  for (const preview of rowPreviews) {
    if (preview._isError) continue;
    if (failedCategoryNames.has(preview.categoryName)) continue;
    productRows.push({
      slug: preview._slug,
      category_id: categoryIdByName.get(preview.categoryName),
      title: preview.rawTitle,
      sim_type: preview.simType,
      price_buy: preview.priceBuy,
      price_import: preview.priceImport,
      data_info: preview.dataInfo,
      duration_days: preview.durationDays,
      package_type: preview._packageType,
      capacity_bucket: preview._capacityBucket,
      api_package_code: preview._code,
      status: 'active',
    });
  }

  // Chunked writes with per-chunk failure isolation, retried in smaller
  // sub-batches on failure (see upsertProductsChunk) so one bad row out of
  // ~500 doesn't collaterally fail every healthy row in the same chunk.
  const slugOutcome = new Map();
  for (const rowsChunk of chunkArray(productRows, UPSERT_CHUNK_SIZE)) {
    const chunkOutcomes = await upsertProductsChunk(supabase, rowsChunk);
    for (const [slug, outcome] of chunkOutcomes) {
      slugOutcome.set(slug, outcome.ok
        ? { status: existingSlugSet.has(slug) ? 'updated' : 'created', message: null }
        : { status: 'failed', message: outcome.message });
    }
  }

  let created = 0;
  let updated = 0;
  let failed = 0;
  for (const outcome of slugOutcome.values()) {
    if (outcome.status === 'created') created += 1;
    else if (outcome.status === 'updated') updated += 1;
    else failed += 1;
  }
  failed += rowPreviews.filter((p) => !p._isError && failedCategoryNames.has(p.categoryName)).length;
  failed += rowPreviews.filter((p) => p._isError).length;

  const rows = rowPreviews.map((preview) => {
    if (preview._isError) {
      return {
        row: preview.row,
        slug: null,
        status: 'failed',
        message: preview.error,
      };
    }

    if (failedCategoryNames.has(preview.categoryName)) {
      return {
        row: preview.row,
        slug: preview._slug,
        status: 'failed',
        message: categoryFailureMessage.get(preview.categoryName),
      };
    }

    const outcome = slugOutcome.get(preview._slug);
    return {
      row: preview.row,
      slug: preview._slug,
      status: outcome.status,
      message: outcome.message,
    };
  });

  return {
    totalRows: parsedRows.length,
    created,
    updated,
    failed,
    ...(categoryCountriesWarning ? { categoryCountriesWarning } : {}),
    rows,
  };
}

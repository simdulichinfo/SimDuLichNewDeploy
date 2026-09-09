import { parseSmartImportWorkbook, slugify, computeRowPricing, classify } from './smartImport';

const SELECT_IN_CHUNK_SIZE = 500;
const UPSERT_CHUNK_SIZE = 500;

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
    const { data } = await supabase.from(table).select(columns).in(column, valueChunk);
    rows.push(...(data || []));
  }
  return rows;
}

export async function runSmartImport(supabase, buffer, pricingOptions = {}, { commit = false } = {}) {
  const { rows: parsedRows, regionResolutions } = parseSmartImportWorkbook(buffer);

  const distinctRegions = [...new Set(parsedRows.map((r) => r.region))];
  const existingCategories = await selectInChunked(supabase, 'categories', 'id, name', 'name', distinctRegions);
  const categoryIdByName = new Map(existingCategories.map((c) => [c.name, c.id]));

  const computedSlugs = parsedRows.map((r) => buildProductSlug(r.rawTitle, r.code));
  const existingProducts = await selectInChunked(supabase, 'products', 'slug', 'slug', computedSlugs);
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
  const failedCategoryNames = new Set();
  let categoriesInsertErrorMessage = null;
  let categoryCountriesWarning = null;

  if (namesToCreate.length > 0) {
    const { data: insertedCategories, error: categoriesInsertError } = await supabase
      .from('categories')
      .insert(namesToCreate.map((name) => ({ name, slug: slugify(name), image_url: null, status: 'active' })))
      .select('id, name');

    if (categoriesInsertError) {
      categoriesInsertErrorMessage = categoriesInsertError.message;
      for (const name of namesToCreate) failedCategoryNames.add(name);
    } else {
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
        const { error: categoryCountriesError } = await supabase.from('category_countries').insert(countryRows);
        if (categoryCountriesError) {
          categoryCountriesWarning = categoryCountriesError.message;
        }
      }
    }
  }

  // De-duplicate by slug before building the product rows to upsert: two rows
  // in the source file can legitimately compute the same slug (this has
  // already happened in the real, previously-imported supplier data), and a
  // single `.upsert(rows, { onConflict: 'slug' })` call containing two rows
  // with the same slug raises "ON CONFLICT DO UPDATE command cannot affect
  // row a second time" in Postgres. We keep the LAST occurrence (in original
  // row order) for determinism, and never invent a new suffixed slug for the
  // earlier occurrence(s) — that would make the slug unstable across imports.
  const lastPreviewForSlug = new Map();
  for (const preview of rowPreviews) {
    if (failedCategoryNames.has(preview.categoryName)) continue;
    lastPreviewForSlug.set(preview._slug, preview);
  }

  const slugToRowMap = new Map();
  for (const [slug, preview] of lastPreviewForSlug) {
    const { packageType, capacityBucket, dataInfo } = classify(preview.rawTitle, '');
    slugToRowMap.set(slug, {
      slug,
      category_id: categoryIdByName.get(preview.categoryName),
      title: preview.rawTitle,
      sim_type: preview.simType,
      price_buy: preview.priceBuy,
      price_import: preview.priceImport,
      data_info: dataInfo,
      duration_days: preview.durationDays,
      package_type: packageType,
      capacity_bucket: capacityBucket,
      api_package_code: preview._code,
      status: 'active',
    });
  }
  const productRows = [...slugToRowMap.values()];

  // Chunked writes with per-chunk failure isolation: one bad chunk out of
  // ~20 for a 10,000-row file shouldn't take down the other ~19.
  const slugOutcome = new Map();
  for (const rowsChunk of chunkArray(productRows, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('products').upsert(rowsChunk, { onConflict: 'slug' });
    for (const row of rowsChunk) {
      if (error) {
        slugOutcome.set(row.slug, { status: 'failed', message: error.message });
      } else {
        slugOutcome.set(row.slug, {
          status: existingSlugSet.has(row.slug) ? 'updated' : 'created',
          message: null,
        });
      }
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
  failed += rowPreviews.filter((p) => failedCategoryNames.has(p.categoryName)).length;

  const rows = rowPreviews.map((preview) => {
    if (failedCategoryNames.has(preview.categoryName)) {
      return {
        row: preview.row,
        slug: preview._slug,
        status: 'failed',
        message: `Không tạo được danh mục "${preview.categoryName}": ${categoriesInsertErrorMessage}`,
      };
    }

    const winner = lastPreviewForSlug.get(preview._slug);
    if (winner !== preview) {
      return {
        row: preview.row,
        slug: preview._slug,
        status: 'skipped',
        message: `Trùng slug "${preview._slug}" với một dòng khác trong file — chỉ giữ lại dữ liệu của dòng cuối cùng (dòng ${winner.row}).`,
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

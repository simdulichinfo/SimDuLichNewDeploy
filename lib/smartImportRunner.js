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

import { createApiClient } from './supabase/apiClient';

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

// PostgREST's filter grammar treats `,` `.` `(` `)` `:` `"` `\` as structural
// characters when parsing combined `or()`/`and()` expressions (`,` separates
// terms, `()` groups/holds `in` lists, `.` separates column/operator/value,
// `:` is reserved for casts). A raw search string containing any of these can
// break a hand-built `.or()` filter's structure instead of just failing to
// match. `*` is also reserved for `like`/`ilike` values specifically: per
// PostgREST's docs, `*` is an alias for the `%` wildcard so clients that
// can't send a literal `%` still have a way to request wildcard matching. An
// unquoted `*` in a search term would therefore be interpreted by the server
// as an extra wildcard instead of the literal character the user typed,
// silently broadening the match. PostgREST's own convention for a value that
// must contain one of these characters literally is to wrap it in double
// quotes, backslash-escaping any literal backslash or double quote inside
// it — quoting the value also suppresses the `*`-as-wildcard alias, so no
// extra escaping of `*` itself is needed once quoted. This only protects the
// *value* text coming from user input — it must never be applied to the `%`
// wildcard delimiters we add ourselves for `ilike`.
const POSTGREST_FILTER_RESERVED_CHARS = /[,.()":\\*]/;

function buildIlikeOrTerm(column, rawValue) {
  if (!POSTGREST_FILTER_RESERVED_CHARS.test(rawValue)) {
    return `${column}.ilike.%${rawValue}%`;
  }
  const escaped = rawValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `${column}.ilike."%${escaped}%"`;
}

async function resolveCategoryIdsForCountries(supabase, countryCodes) {
  const { data, error } = await supabase
    .from('category_countries')
    .select('category_id')
    .in('country_code', countryCodes);
  if (error) console.error('[catalog] resolveCategoryIdsForCountries: failed to query category_countries', error);
  return [...new Set((data || []).map((row) => row.category_id))];
}

export async function listCategories() {
  const supabase = createApiClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, image_url, status, category_countries(country_code)')
    .eq('status', 'active');
  if (error) console.error('[catalog] listCategories: failed to query categories', error);
  return (data || []).map(mapCategory);
}

export async function listProductsByCountry(countryCode) {
  const supabase = createApiClient();
  if (!supabase) return [];

  const categoryIds = await resolveCategoryIdsForCountries(supabase, [countryCode]);
  if (categoryIds.length === 0) return [];

  const { data, error } = await supabase
    .from('products_public')
    .select('*')
    .in('category_id', categoryIds);
  if (error) console.error('[catalog] listProductsByCountry: failed to query products_public', error);
  return (data || []).map(mapProduct);
}

export async function listProductsByCategory(categorySlug) {
  const supabase = createApiClient();
  if (!supabase) return [];

  const { data: categoryRows, error: categoryError } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', categorySlug)
    .limit(1);
  if (categoryError) console.error('[catalog] listProductsByCategory: failed to query categories', categoryError);
  const category = (categoryRows || [])[0];
  if (!category) return [];

  const { data, error } = await supabase
    .from('products_public')
    .select('*')
    .eq('category_id', category.id);
  if (error) console.error('[catalog] listProductsByCategory: failed to query products_public', error);
  return (data || []).map(mapProduct);
}

export async function listAllProducts() {
  const supabase = createApiClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from('products_public').select('*');
  if (error) console.error('[catalog] listAllProducts: failed to query products_public', error);
  return (data || []).map(mapProduct);
}

export async function getProductBySlug(slug) {
  const supabase = createApiClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from('products_public').select('*').eq('slug', slug).maybeSingle();
  if (error) console.error('[catalog] getProductBySlug: failed to query products_public', error);
  return data ? mapProduct(data) : null;
}

export async function getProductById(id) {
  const supabase = createApiClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from('products_public').select('*').eq('id', id).maybeSingle();
  if (error) console.error('[catalog] getProductById: failed to query products_public', error);
  return data ? mapProduct(data) : null;
}

export async function getMinPriceByCountry() {
  const supabase = createApiClient();
  if (!supabase) return {};
  const { data, error } = await supabase.rpc('min_price_by_country');
  if (error) console.error('[catalog] getMinPriceByCountry: failed to call min_price_by_country RPC', error);
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
  const supabase = createApiClient();
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  const safeSize = Number.isFinite(size) ? Math.max(1, Math.trunc(size)) : 12;
  const safeMaxPrice = Number.isFinite(maxPrice) ? maxPrice : 1000000;
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
    .lte('price_buy', safeMaxPrice);

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
    const { data: matchingCategories, error: matchingCategoriesError } = await supabase
      .from('categories')
      .select('id')
      .ilike('name', `%${search}%`);
    if (matchingCategoriesError) console.error('[catalog] searchProducts: failed to query categories for name match', matchingCategoriesError);
    const nameMatchIds = (matchingCategories || []).map((c) => c.id);
    const orParts = [buildIlikeOrTerm('title', search)];
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

  const { data, count, error } = await query;
  if (error) console.error('[catalog] searchProducts: failed to query products_public', error);
  const totalElements = count || 0;

  return {
    content: (data || []).map(mapProduct),
    page: safePage,
    size: safeSize,
    totalElements,
    totalPages: Math.ceil(totalElements / safeSize),
  };
}

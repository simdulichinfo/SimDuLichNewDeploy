import { classify } from './smartImport';

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

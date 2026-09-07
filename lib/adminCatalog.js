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

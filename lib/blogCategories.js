import { createApiClient } from './supabase/apiClient';

function mapCategory(row) {
  return { id: row.id, name: row.name, slug: row.slug };
}

export async function listCategoriesPublic() {
  const supabase = createApiClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('blog_categories')
    .select('id, name, slug')
    .order('id', { ascending: true });
  if (error) {
    console.error('[blogCategories] listCategoriesPublic: failed to query categories', error);
    return [];
  }
  return (data || []).map(mapCategory);
}

export async function listCategoriesAdmin(supabase) {
  const { data, error } = await supabase
    .from('blog_categories')
    .select('id, name, slug')
    .order('id', { ascending: true });
  if (error) return { data: null, error };
  return { data: (data || []).map(mapCategory), error: null };
}

export async function createCategoryAdmin(supabase, { name, slug }) {
  const { data, error } = await supabase
    .from('blog_categories')
    .insert({ name, slug })
    .select('id, name, slug')
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: mapCategory(data), error: null };
}

export async function updateCategoryAdmin(supabase, id, { name, slug }) {
  const { data, error } = await supabase
    .from('blog_categories')
    .update({ name, slug })
    .eq('id', id)
    .select('id, name, slug')
    .maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  return { data: mapCategory(data), error: null };
}

export async function deleteCategoryAdmin(supabase, id) {
  const { data, error } = await supabase
    .from('blog_categories')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) return { deleted: false, error };
  return { deleted: (data || []).length > 0, error: null };
}

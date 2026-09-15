import { createApiClient } from './supabase/apiClient';

const PUBLIC_LIST_COLUMNS = 'id, category_id, title, slug, excerpt, image_url, author, published_at, blog_categories(name)';
const FULL_COLUMNS = 'id, category_id, title, slug, excerpt, content, image_url, author, status, published_at, created_at, updated_at, blog_categories(name)';

function mapPostSummary(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.blog_categories?.name ?? null,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    imageUrl: row.image_url,
    author: row.author,
    publishedAt: row.published_at,
  };
}

function mapPostDetail(row) {
  return {
    ...mapPostSummary(row),
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPostsPublic() {
  const supabase = createApiClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('blog_posts')
    .select(PUBLIC_LIST_COLUMNS)
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) {
    console.error('[blogPosts] listPostsPublic: failed to query posts', error);
    return [];
  }
  return (data || []).map(mapPostSummary);
}

export async function getPostBySlugPublic(slug) {
  const supabase = createApiClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('blog_posts')
    .select(FULL_COLUMNS)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();
  if (error) {
    console.error('[blogPosts] getPostBySlugPublic: failed to query post', error);
    return null;
  }
  if (!data) return null;
  return mapPostDetail(data);
}

export async function listPostsAdmin(supabase, { page, size } = {}) {
  const safePage = Number.isFinite(page) && page >= 0 ? Math.trunc(page) : 0;
  const safeSize = Number.isFinite(size) && size > 0 ? Math.trunc(size) : 20;
  const from = safePage * safeSize;
  const to = from + safeSize - 1;

  const { data, count, error } = await supabase
    .from('blog_posts')
    .select(FULL_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) return { data: null, error };

  const totalElements = count || 0;
  return {
    data: {
      content: (data || []).map(mapPostDetail),
      number: safePage,
      size: safeSize,
      totalElements,
      totalPages: Math.ceil(totalElements / safeSize),
    },
    error: null,
  };
}

export async function getPostAdminById(supabase, id) {
  const { data, error } = await supabase
    .from('blog_posts')
    .select(FULL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  return { data: mapPostDetail(data), error: null };
}

function postFieldsToRow({ categoryId, title, slug, excerpt, content, imageUrl, author, status }) {
  const row = {
    category_id: categoryId,
    title,
    slug,
    excerpt,
    content,
    image_url: imageUrl ?? null,
    author,
    status,
  };
  if (status === 'published') {
    row.published_at = new Date().toISOString();
  }
  return row;
}

export async function createPostAdmin(supabase, fields) {
  const { data, error } = await supabase
    .from('blog_posts')
    .insert(postFieldsToRow(fields))
    .select(FULL_COLUMNS)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: mapPostDetail(data), error: null };
}

export async function updatePostAdmin(supabase, id, fields) {
  const { data: existing, error: fetchError } = await supabase
    .from('blog_posts')
    .select('status, published_at')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return { data: null, error: fetchError };
  if (!existing) return { data: null, error: null };

  const row = postFieldsToRow(fields);
  const isFirstPublish = fields.status === 'published' && existing.status !== 'published' && !existing.published_at;
  if (!isFirstPublish) {
    delete row.published_at;
  }

  const { data, error } = await supabase
    .from('blog_posts')
    .update(row)
    .eq('id', id)
    .select(FULL_COLUMNS)
    .maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  return { data: mapPostDetail(data), error: null };
}

export async function deletePostAdmin(supabase, id) {
  const { data, error } = await supabase
    .from('blog_posts')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) return { deleted: false, error };
  return { deleted: (data || []).length > 0, error: null };
}

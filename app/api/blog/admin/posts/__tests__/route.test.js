import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listPostsAdminMock = vi.fn();
const createPostAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/blogPosts', () => ({
  listPostsAdmin: (...args) => listPostsAdminMock(...args),
  createPostAdmin: (...args) => createPostAdminMock(...args),
}));

import { GET, POST } from '../route';

function makeGetRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}
function makePostRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('GET /api/blog/admin/posts', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listPostsAdminMock.mockReset();
  });

  it('đọc page/size từ query string', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listPostsAdminMock.mockResolvedValue({ data: { content: [], number: 1, size: 10, totalElements: 0, totalPages: 0 }, error: null });

    await GET(makeGetRequest('http://localhost:3000/api/blog/admin/posts?page=1&size=10'));

    expect(listPostsAdminMock).toHaveBeenCalledWith({}, { page: 1, size: 10 });
  });

  it('trả 403 khi không phải admin/staff', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'customer' }, supabase: {} });

    const response = await GET(makeGetRequest('http://localhost:3000/api/blog/admin/posts'));

    expect(response.status).toBe(403);
  });
});

describe('POST /api/blog/admin/posts', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    createPostAdminMock.mockReset();
  });

  it('tạo bài thành công, trả 201', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createPostAdminMock.mockResolvedValue({ data: { id: 7, slug: 'bai-moi' }, error: null });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'Bài mới', slug: 'bai-moi', excerpt: 'x', content: '<p>x</p>', author: 'A', status: 'draft',
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.slug).toBe('bai-moi');
  });

  it('trả 400 khi thiếu field bắt buộc', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({ title: '' }));

    expect(response.status).toBe(400);
    expect(createPostAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi slug trùng', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createPostAdminMock.mockResolvedValue({ data: null, error: { code: '23505' } });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'X', slug: 'trung', excerpt: 'x', content: 'x', author: 'A', status: 'draft',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' });
  });

  it('trả 400 khi categoryId không hợp lệ (lỗi khoá ngoại)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createPostAdminMock.mockResolvedValue({ data: null, error: { code: '23503' } });

    const response = await POST(makePostRequest({
      categoryId: 999, title: 'X', slug: 'x', excerpt: 'x', content: 'x', author: 'A', status: 'draft',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Danh mục không hợp lệ.' });
  });
});

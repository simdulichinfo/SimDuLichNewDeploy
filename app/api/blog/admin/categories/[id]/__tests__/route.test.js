import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const updateCategoryAdminMock = vi.fn();
const deleteCategoryAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/blogCategories', () => ({
  updateCategoryAdmin: (...args) => updateCategoryAdminMock(...args),
  deleteCategoryAdmin: (...args) => deleteCategoryAdminMock(...args),
}));

import { PUT, DELETE } from '../route';

function makeRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('PUT /api/blog/admin/categories/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    updateCategoryAdminMock.mockReset();
  });

  it('sửa thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateCategoryAdminMock.mockResolvedValue({ data: { id: 1, name: 'Đổi tên', slug: 'guides' }, error: null });

    const response = await PUT(makeRequest({ name: 'Đổi tên', slug: 'guides' }), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(body).toEqual({ id: 1, name: 'Đổi tên', slug: 'guides' });
  });

  it('trả 404 khi không tìm thấy', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateCategoryAdminMock.mockResolvedValue({ data: null, error: null });

    const response = await PUT(makeRequest({ name: 'X', slug: 'x' }), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/blog/admin/categories/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    deleteCategoryAdminMock.mockReset();
  });

  it('xoá thành công, trả 204', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteCategoryAdminMock.mockResolvedValue({ deleted: true, error: null });

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(204);
  });

  it('trả 400 khi còn bài viết tham chiếu', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteCategoryAdminMock.mockResolvedValue({ deleted: false, error: { code: '23503' } });

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Không thể xoá — danh mục còn bài viết liên kết.' });
  });
});

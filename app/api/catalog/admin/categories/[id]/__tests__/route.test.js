import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const updateCategoryAdminMock = vi.fn();
const deleteCategoryAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminCatalog', () => ({
  updateCategoryAdmin: (...args) => updateCategoryAdminMock(...args),
  deleteCategoryAdmin: (...args) => deleteCategoryAdminMock(...args),
}));

import { PUT, DELETE } from '../route';

function makePutRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}
function makeDeleteRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}

describe('PUT /api/catalog/admin/categories/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    updateCategoryAdminMock.mockReset();
  });

  it('cập nhật thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateCategoryAdminMock.mockResolvedValue({
      data: { id: 5, name: 'X', slug: 'x', imageUrl: null, status: 'active', coveredCountries: [] },
      error: null,
    });

    const response = await PUT(makePutRequest({ name: 'X', slug: 'x', status: 'active' }), { params: Promise.resolve({ id: '5' }) });
    const body = await response.json();

    expect(updateCategoryAdminMock).toHaveBeenCalledWith({}, '5', { name: 'X', slug: 'x', imageUrl: undefined, status: 'active' });
    expect(body.id).toBe(5);
  });

  it('trả 404 khi không tìm thấy id', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateCategoryAdminMock.mockResolvedValue({ data: null, error: null });

    const response = await PUT(makePutRequest({ name: 'X', slug: 'x', status: 'active' }), { params: Promise.resolve({ id: '999' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy danh mục.' });
  });

  it('trả 403 khi caller là staff (chỉ admin mới sửa danh mục)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await PUT(makePutRequest({ name: 'X', slug: 'x', status: 'active' }), { params: Promise.resolve({ id: '5' }) });

    expect(response.status).toBe(403);
    expect(updateCategoryAdminMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/catalog/admin/categories/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    deleteCategoryAdminMock.mockReset();
  });

  it('trả 204 khi xoá thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteCategoryAdminMock.mockResolvedValue({ deleted: true, error: null });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '5' }) });

    expect(response.status).toBe(204);
  });

  it('trả 404 khi không tìm thấy id', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteCategoryAdminMock.mockResolvedValue({ deleted: false, error: null });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });

  it('trả 400 khi bị chặn bởi khoá ngoại', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteCategoryAdminMock.mockResolvedValue({ deleted: false, error: { code: '23503' } });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Không thể xoá — danh mục còn sản phẩm liên kết.' });
  });

  it('trả 403 khi caller là staff (chỉ admin mới xoá danh mục)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '5' }) });

    expect(response.status).toBe(403);
    expect(deleteCategoryAdminMock).not.toHaveBeenCalled();
  });
});

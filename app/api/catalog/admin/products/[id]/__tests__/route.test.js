import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const updateProductAdminMock = vi.fn();
const deleteProductAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminCatalog', () => ({
  updateProductAdmin: (...args) => updateProductAdminMock(...args),
  deleteProductAdmin: (...args) => deleteProductAdminMock(...args),
}));

import { PUT, DELETE } from '../route';

function makePutRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}
function makeDeleteRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}

describe('PUT /api/catalog/admin/products/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    updateProductAdminMock.mockReset();
  });

  it('cập nhật thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateProductAdminMock.mockResolvedValue({ data: { id: 1, slug: 'a' }, error: null });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(200);
  });

  it('trả 404 khi không tìm thấy id', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateProductAdminMock.mockResolvedValue({ data: null, error: null });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/catalog/admin/products/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    deleteProductAdminMock.mockReset();
  });

  it('trả 204 khi xoá thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteProductAdminMock.mockResolvedValue({ deleted: true, error: null });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(204);
  });
});

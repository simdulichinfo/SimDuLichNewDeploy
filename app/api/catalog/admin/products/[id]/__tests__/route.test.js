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

  it('chấp nhận durationDays: null (re-save sản phẩm Smart Import không có thời hạn) và gọi tới lib', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateProductAdminMock.mockResolvedValue({ data: { id: 1, slug: 'a' }, error: null });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'physical', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: null, status: 'active',
    }), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(200);
    expect(updateProductAdminMock).toHaveBeenCalled();
  });

  it('trả 400 khi durationDays = 0', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 0, status: 'active',
    }), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(updateProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi durationDays bị thiếu (undefined)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', status: 'active',
    }), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(updateProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi priceBuy âm', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: -5000, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(updateProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi priceBuy không phải số (chuỗi)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 'abc', priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(updateProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi priceImport âm', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: -5000,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(updateProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi priceImport không phải số (chuỗi)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 'abc',
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(updateProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 403 khi caller là staff (chỉ admin mới sửa gói cước)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(403);
    expect(updateProductAdminMock).not.toHaveBeenCalled();
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

  it('trả 404 khi không tìm thấy id', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteProductAdminMock.mockResolvedValue({ deleted: false, error: null });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '999' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy sản phẩm.' });
  });

  it('trả 400 khi bị chặn bởi khoá ngoại (inventory FK)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deleteProductAdminMock.mockResolvedValue({ deleted: false, error: { code: '23503' } });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Không thể xoá — sản phẩm còn ICCID trong kho.' });
  });

  it('trả 403 khi caller là staff (chỉ admin mới xoá gói cước)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(403);
    expect(deleteProductAdminMock).not.toHaveBeenCalled();
  });
});

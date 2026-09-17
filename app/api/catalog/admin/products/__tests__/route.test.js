import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listProductsAdminMock = vi.fn();
const createProductAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminCatalog', () => ({
  listProductsAdmin: (...args) => listProductsAdminMock(...args),
  createProductAdmin: (...args) => createProductAdminMock(...args),
}));

import { GET, POST } from '../route';

function makeGetRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}
function makePostRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('GET /api/catalog/admin/products', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listProductsAdminMock.mockReset();
  });

  it('trả toàn bộ sản phẩm', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });
    listProductsAdminMock.mockResolvedValue({ data: [{ id: 1 }], error: null });

    const response = await GET(makeGetRequest());
    const body = await response.json();

    expect(body).toEqual([{ id: 1 }]);
  });
});

describe('POST /api/catalog/admin/products', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    createProductAdminMock.mockReset();
  });

  it('tạo sản phẩm thành công, trả 201', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createProductAdminMock.mockResolvedValue({ data: { id: 1, slug: 'a' }, error: null });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));

    expect(response.status).toBe(201);
    expect(createProductAdminMock).toHaveBeenCalled();
  });

  it('trả 400 khi categoryId không tồn tại', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createProductAdminMock.mockResolvedValue({ data: null, error: { code: '23503' } });

    const response = await POST(makePostRequest({
      categoryId: 999, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'categoryId không tồn tại.' });
  });

  it('trả 400 khi simType không hợp lệ', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'tablet', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'simType chỉ nhận "esim" hoặc "physical".' });
  });

  it('chấp nhận durationDays: null (sản phẩm Smart Import không có thời hạn) và gọi tới lib', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createProductAdminMock.mockResolvedValue({ data: { id: 1, slug: 'a' }, error: null });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'physical', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: null, status: 'active',
    }));

    expect(response.status).toBe(201);
    expect(createProductAdminMock).toHaveBeenCalled();
  });

  it('trả 400 khi durationDays = 0', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 0, status: 'active',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(createProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi durationDays bị thiếu (undefined)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', status: 'active',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(createProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi priceBuy âm', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: -5000, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(createProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi priceBuy không phải số (chuỗi)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 'abc', priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(createProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi priceImport âm', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: -5000,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(createProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi priceImport không phải số (chuỗi)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 'abc',
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(createProductAdminMock).not.toHaveBeenCalled();
  });

  it('trả 403 khi caller là staff (chỉ admin mới tạo gói cước)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await POST(makePostRequest({
      categoryId: 1, title: 'A', slug: 'a', simType: 'esim', priceBuy: 1, priceImport: 1,
      dataInfo: '1GB', durationDays: 1, status: 'active',
    }));

    expect(response.status).toBe(403);
    expect(createProductAdminMock).not.toHaveBeenCalled();
  });
});

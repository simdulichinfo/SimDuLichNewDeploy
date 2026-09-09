import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const searchProductsAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminCatalog', () => ({
  searchProductsAdmin: (...args) => searchProductsAdminMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/catalog/admin/products/search', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    searchProductsAdminMock.mockReset();
  });

  it('đọc categoryId/search/page/size từ query string, trả field number', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    searchProductsAdminMock.mockResolvedValue({
      data: { content: [], number: 1, size: 10, totalElements: 0, totalPages: 0 }, error: null,
    });

    const response = await GET(makeRequest('http://localhost:3000/api/catalog/admin/products/search?categoryId=5&search=nhat&page=1&size=10'));
    const body = await response.json();

    expect(searchProductsAdminMock).toHaveBeenCalledWith({}, {
      categoryId: '5', search: 'nhat', page: 1, size: 10,
    });
    expect(body.number).toBe(1);
    expect(body.page).toBeUndefined();
  });
});

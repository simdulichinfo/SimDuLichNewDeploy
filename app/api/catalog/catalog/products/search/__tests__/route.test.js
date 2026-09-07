import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchProductsMock = vi.fn();

vi.mock('../../../../../../../lib/catalog', () => ({
  searchProducts: (...args) => searchProductsMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url };
}

describe('GET /api/catalog/catalog/products/search', () => {
  beforeEach(() => {
    searchProductsMock.mockReset();
  });

  it('đọc filter từ query string và truyền cho searchProducts()', async () => {
    searchProductsMock.mockResolvedValue({ content: [], page: 2, size: 12, totalElements: 0, totalPages: 0 });

    const response = await GET(makeRequest(
      'http://localhost:3000/api/catalog/catalog/products/search?simType=physical&search=nhat&countryCodes=jp,kr&types=daily,fixed&durations=1-5&capacities=1gb&maxPrice=200000&sortBy=price-asc&page=2&size=12',
    ));
    const body = await response.json();

    expect(searchProductsMock).toHaveBeenCalledWith({
      simType: 'physical',
      search: 'nhat',
      countryCodes: ['jp', 'kr'],
      types: ['daily', 'fixed'],
      durations: ['1-5'],
      capacities: ['1gb'],
      maxPrice: 200000,
      sortBy: 'price-asc',
      page: 2,
      size: 12,
    });
    expect(body.page).toBe(2);
  });

  it('dùng giá trị mặc định của searchProducts() khi query string trống', async () => {
    searchProductsMock.mockResolvedValue({ content: [], page: 1, size: 12, totalElements: 0, totalPages: 0 });

    await GET(makeRequest('http://localhost:3000/api/catalog/catalog/products/search'));

    expect(searchProductsMock).toHaveBeenCalledWith({
      simType: 'esim',
      search: '',
      countryCodes: [],
      types: [],
      durations: [],
      capacities: [],
      maxPrice: undefined,
      sortBy: 'default',
      page: undefined,
      size: undefined,
    });
  });
});

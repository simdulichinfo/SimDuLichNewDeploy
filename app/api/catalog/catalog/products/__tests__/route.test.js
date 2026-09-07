import { describe, it, expect, vi, beforeEach } from 'vitest';

const listAllProductsMock = vi.fn();
const listProductsByCategoryMock = vi.fn();

vi.mock('../../../../../../lib/catalog', () => ({
  listAllProducts: (...args) => listAllProductsMock(...args),
  listProductsByCategory: (...args) => listProductsByCategoryMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url };
}

describe('GET /api/catalog/catalog/products', () => {
  beforeEach(() => {
    listAllProductsMock.mockReset();
    listProductsByCategoryMock.mockReset();
  });

  it('gọi listAllProducts() khi không có categorySlug', async () => {
    listAllProductsMock.mockResolvedValue([{ id: 1 }]);

    const response = await GET(makeRequest('http://localhost:3000/api/catalog/catalog/products'));
    const body = await response.json();

    expect(listAllProductsMock).toHaveBeenCalled();
    expect(listProductsByCategoryMock).not.toHaveBeenCalled();
    expect(body).toEqual([{ id: 1 }]);
  });

  it('gọi listProductsByCategory(slug) khi có categorySlug', async () => {
    listProductsByCategoryMock.mockResolvedValue([{ id: 2 }]);

    const response = await GET(makeRequest('http://localhost:3000/api/catalog/catalog/products?categorySlug=singapore'));
    const body = await response.json();

    expect(listProductsByCategoryMock).toHaveBeenCalledWith('singapore');
    expect(body).toEqual([{ id: 2 }]);
  });
});

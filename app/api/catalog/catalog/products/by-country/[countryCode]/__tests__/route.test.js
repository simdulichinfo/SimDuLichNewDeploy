import { describe, it, expect, vi } from 'vitest';

const listProductsByCountryMock = vi.fn();

vi.mock('../../../../../../../../lib/catalog', () => ({
  listProductsByCountry: (...args) => listProductsByCountryMock(...args),
}));

import { GET } from '../route';

describe('GET /api/catalog/catalog/products/by-country/[countryCode]', () => {
  it('gọi listProductsByCountry(countryCode) với countryCode từ params', async () => {
    listProductsByCountryMock.mockResolvedValue([{ id: 1 }]);

    const response = await GET({}, { params: Promise.resolve({ countryCode: 'jp' }) });
    const body = await response.json();

    expect(listProductsByCountryMock).toHaveBeenCalledWith('jp');
    expect(body).toEqual([{ id: 1 }]);
  });
});

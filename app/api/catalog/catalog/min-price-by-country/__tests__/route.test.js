import { describe, it, expect, vi } from 'vitest';

const getMinPriceByCountryMock = vi.fn();

vi.mock('../../../../../../lib/catalog', () => ({
  getMinPriceByCountry: (...args) => getMinPriceByCountryMock(...args),
}));

import { GET } from '../route';

describe('GET /api/catalog/catalog/min-price-by-country', () => {
  it('trả object { [countryCode]: giá } từ getMinPriceByCountry()', async () => {
    getMinPriceByCountryMock.mockResolvedValue({ jp: 89000, kr: 129000 });

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({ jp: 89000, kr: 129000 });
  });
});

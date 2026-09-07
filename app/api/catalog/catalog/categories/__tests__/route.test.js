import { describe, it, expect, vi } from 'vitest';

const listCategoriesMock = vi.fn();

vi.mock('../../../../../../lib/catalog', () => ({
  listCategories: (...args) => listCategoriesMock(...args),
}));

import { GET } from '../route';

describe('GET /api/catalog/catalog/categories', () => {
  it('trả danh sách category từ listCategories()', async () => {
    listCategoriesMock.mockResolvedValue([{ id: 1, name: 'Nhật Bản', slug: 'nhat-ban', imageUrl: null, status: 'active', coveredCountries: ['jp'] }]);

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual([{ id: 1, name: 'Nhật Bản', slug: 'nhat-ban', imageUrl: null, status: 'active', coveredCountries: ['jp'] }]);
  });
});

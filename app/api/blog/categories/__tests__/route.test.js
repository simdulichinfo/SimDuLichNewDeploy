import { describe, it, expect, vi, beforeEach } from 'vitest';

const listCategoriesPublicMock = vi.fn();

vi.mock('../../../../../lib/blogCategories', () => ({
  listCategoriesPublic: (...args) => listCategoriesPublicMock(...args),
}));

import { GET } from '../route';

describe('GET /api/blog/categories', () => {
  beforeEach(() => {
    listCategoriesPublicMock.mockReset();
  });

  it('trả mảng danh mục', async () => {
    listCategoriesPublicMock.mockResolvedValue([{ id: 1, name: 'Hướng dẫn cài đặt', slug: 'guides' }]);

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual([{ id: 1, name: 'Hướng dẫn cài đặt', slug: 'guides' }]);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProductBySlugMock = vi.fn();

vi.mock('../../../../../../../lib/catalog', () => ({
  getProductBySlug: (...args) => getProductBySlugMock(...args),
}));

import { GET } from '../route';

describe('GET /api/catalog/catalog/products/[slug]', () => {
  beforeEach(() => {
    getProductBySlugMock.mockReset();
  });

  it('trả sản phẩm khi getProductBySlug() tìm thấy', async () => {
    getProductBySlugMock.mockResolvedValue({ id: 1, slug: 'esim-nb' });

    const response = await GET({}, { params: Promise.resolve({ slug: 'esim-nb' }) });
    const body = await response.json();

    expect(getProductBySlugMock).toHaveBeenCalledWith('esim-nb');
    expect(body).toEqual({ id: 1, slug: 'esim-nb' });
  });

  it('trả 404 khi getProductBySlug() trả null', async () => {
    getProductBySlugMock.mockResolvedValue(null);

    const response = await GET({}, { params: Promise.resolve({ slug: 'khong-ton-tai' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy sản phẩm.' });
  });
});

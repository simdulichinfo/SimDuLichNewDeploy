import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProductByIdMock = vi.fn();

vi.mock('../../../../../../../../lib/catalog', () => ({
  getProductById: (...args) => getProductByIdMock(...args),
}));

import { GET } from '../route';

describe('GET /api/catalog/catalog/products/id/[id]', () => {
  beforeEach(() => {
    getProductByIdMock.mockReset();
  });

  it('trả sản phẩm khi getProductById() tìm thấy', async () => {
    getProductByIdMock.mockResolvedValue({ id: 7 });

    const response = await GET({}, { params: Promise.resolve({ id: '7' }) });
    const body = await response.json();

    expect(getProductByIdMock).toHaveBeenCalledWith('7');
    expect(body).toEqual({ id: 7 });
  });

  it('trả 404 khi getProductById() trả null', async () => {
    getProductByIdMock.mockResolvedValue(null);

    const response = await GET({}, { params: Promise.resolve({ id: '999' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy sản phẩm.' });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const createApiClientMock = vi.fn();
const getOrderByCodeMock = vi.fn();

vi.mock('../../../../../../lib/supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));
vi.mock('../../../../../../lib/orders', async () => {
  const actual = await vi.importActual('../../../../../../lib/orders');
  return { ...actual, getOrderByCode: (...args) => getOrderByCodeMock(...args) };
});

import { GET } from '../route';

describe('GET /api/orders/orders/[orderCode]', () => {
  beforeEach(() => {
    createApiClientMock.mockReset();
    getOrderByCodeMock.mockReset();
  });

  it('trả order khi tìm thấy', async () => {
    createApiClientMock.mockReturnValue({});
    getOrderByCodeMock.mockResolvedValue({ id: 1, orderCode: 'SDL2345ABCD', paymentStatus: 'pending' });

    const response = await GET({}, { params: Promise.resolve({ orderCode: 'SDL2345ABCD' }) });
    const body = await response.json();

    expect(body.orderCode).toBe('SDL2345ABCD');
  });

  it('trả 404 khi không tìm thấy', async () => {
    createApiClientMock.mockReturnValue({});
    getOrderByCodeMock.mockResolvedValue(null);

    const response = await GET({}, { params: Promise.resolve({ orderCode: 'KHONGTONTAI' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy đơn hàng.' });
  });
});

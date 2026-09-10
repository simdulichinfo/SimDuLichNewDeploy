import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderError } from '../../../../../../lib/orders';

const createApiClientMock = vi.fn();
const initiatePaymentMock = vi.fn();

vi.mock('../../../../../../lib/supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));
vi.mock('../../../../../../lib/payments', () => ({
  initiatePayment: (...args) => initiatePaymentMock(...args),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/payments/payments/initiate', () => {
  beforeEach(() => {
    createApiClientMock.mockReset();
    initiatePaymentMock.mockReset();
  });

  it('trả InitiatePaymentResponse khi thành công', async () => {
    createApiClientMock.mockReturnValue({});
    initiatePaymentMock.mockResolvedValue({ data: { orderCode: 'SDL2345ABCD', payUrl: 'https://...' }, error: null });

    const response = await POST(makeRequest({ orderCode: 'SDL2345ABCD', provider: 'sepay' }));
    const body = await response.json();

    expect(body.orderCode).toBe('SDL2345ABCD');
  });

  it('trả đúng status/message khi initiatePayment trả error', async () => {
    createApiClientMock.mockReturnValue({});
    initiatePaymentMock.mockResolvedValue({ data: null, error: { status: 404, message: 'Không tìm thấy đơn hàng.' } });

    const response = await POST(makeRequest({ orderCode: 'KHONGTONTAI', provider: 'sepay' }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy đơn hàng.' });
  });

  it('trả đúng status/message khi initiatePayment ném OrderError (VD: getOrderByCode RPC lỗi)', async () => {
    createApiClientMock.mockReturnValue({});
    initiatePaymentMock.mockRejectedValue(new OrderError('Không tra được đơn hàng.', 500));

    const response = await POST(makeRequest({ orderCode: 'SDL2345ABCD', provider: 'sepay' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ message: 'Không tra được đơn hàng.' });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const optionalAuthenticateMock = vi.fn();
const createOrderMock = vi.fn();

vi.mock('../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../lib/apiAuth');
  return { ...actual, optionalAuthenticate: (...args) => optionalAuthenticateMock(...args) };
});
vi.mock('../../../../../lib/orders', async () => {
  const actual = await vi.importActual('../../../../../lib/orders');
  return { ...actual, createOrder: (...args) => createOrderMock(...args) };
});

import { POST } from '../route';

function makeRequest(body) {
  return { headers: { get: () => null }, json: () => Promise.resolve(body) };
}

describe('POST /api/orders/orders', () => {
  beforeEach(() => {
    optionalAuthenticateMock.mockReset();
    createOrderMock.mockReset();
  });

  it('tạo đơn thành công cho khách vãng lai (không có token), trả 201', async () => {
    optionalAuthenticateMock.mockResolvedValue({ user: null, supabase: {} });
    createOrderMock.mockResolvedValue({ id: 1, orderCode: 'SDL2345ABCD' });

    const response = await POST(makeRequest({
      custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 1 }],
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.orderCode).toBe('SDL2345ABCD');
    expect(createOrderMock).toHaveBeenCalledWith({}, expect.objectContaining({ userId: null }));
  });

  it('trả 400 khi thiếu trường bắt buộc', async () => {
    optionalAuthenticateMock.mockResolvedValue({ user: null, supabase: {} });

    const response = await POST(makeRequest({ custName: '', custEmail: 'a@x.vn', custPhone: '0900000000', paymentMethod: 'sepay', shippingMethod: 'email', items: [] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it('trả đúng status/message khi createOrder ném OrderError', async () => {
    optionalAuthenticateMock.mockResolvedValue({ user: null, supabase: {} });
    const { OrderError } = await vi.importActual('../../../../../lib/orders');
    createOrderMock.mockRejectedValue(new OrderError('Sản phẩm không tồn tại.', 400));

    const response = await POST(makeRequest({
      custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 999, quantity: 1 }],
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Sản phẩm không tồn tại.' });
  });
});

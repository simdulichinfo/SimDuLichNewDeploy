import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const confirmPaymentAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminPayments', () => ({
  confirmPaymentAdmin: (...args) => confirmPaymentAdminMock(...args),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('POST /api/payments/admin/payments/confirm', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    confirmPaymentAdminMock.mockReset();
  });

  it('xác nhận thanh toán thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    confirmPaymentAdminMock.mockResolvedValue({ data: { orderCode: 'SDL2345ABCD', paymentStatus: 'paid' }, error: null });

    const response = await POST(makeRequest({ orderCode: 'SDL2345ABCD' }));
    const body = await response.json();

    expect(body.paymentStatus).toBe('paid');
  });

  it('trả 404 khi không tìm thấy orderCode', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    confirmPaymentAdminMock.mockResolvedValue({ data: null, error: null });

    const response = await POST(makeRequest({ orderCode: 'KHONGTONTAI' }));

    expect(response.status).toBe(404);
  });

  it('trả 403 khi caller không phải admin/staff', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'customer' }, supabase: {} });

    const response = await POST(makeRequest({ orderCode: 'SDL2345ABCD' }));

    expect(response.status).toBe(403);
    expect(confirmPaymentAdminMock).not.toHaveBeenCalled();
  });
});

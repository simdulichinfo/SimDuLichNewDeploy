import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listPaymentsAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminPayments', () => ({
  listPaymentsAdmin: (...args) => listPaymentsAdminMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/payments/admin/payments', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listPaymentsAdminMock.mockReset();
  });

  it('đọc page/size/orderId từ query string', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listPaymentsAdminMock.mockResolvedValue({ data: { content: [], number: 0, size: 20, totalElements: 0, totalPages: 0 }, error: null });

    await GET(makeRequest('http://localhost:3000/api/payments/admin/payments?orderId=5&page=0&size=20'));

    expect(listPaymentsAdminMock).toHaveBeenCalledWith({}, { page: 0, size: 20, orderId: '5' });
  });

  it('trả 403 khi caller là staff (chỉ admin mới xem giao dịch thanh toán)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await GET(makeRequest('http://localhost:3000/api/payments/admin/payments'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
    expect(listPaymentsAdminMock).not.toHaveBeenCalled();
  });
});

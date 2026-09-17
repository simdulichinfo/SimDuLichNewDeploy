import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listApiLogsAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminPayments', () => ({
  listApiLogsAdmin: (...args) => listApiLogsAdminMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/payments/admin/api-logs', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listApiLogsAdminMock.mockReset();
  });

  it('đọc orderId từ query string', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listApiLogsAdminMock.mockResolvedValue({ data: { content: [], number: 0, size: 20, totalElements: 0, totalPages: 0 }, error: null });

    await GET(makeRequest('http://localhost:3000/api/payments/admin/api-logs?orderId=5'));

    expect(listApiLogsAdminMock).toHaveBeenCalledWith({}, { page: undefined, size: undefined, orderId: '5' });
  });

  it('trả 403 khi caller là staff (chỉ admin mới xem được api logs)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await GET(makeRequest('http://localhost:3000/api/payments/admin/api-logs'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
    expect(listApiLogsAdminMock).not.toHaveBeenCalled();
  });
});

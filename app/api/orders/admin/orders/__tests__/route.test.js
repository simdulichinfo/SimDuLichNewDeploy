import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listOrdersAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminOrders', () => ({
  listOrdersAdmin: (...args) => listOrdersAdminMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/orders/admin/orders', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listOrdersAdminMock.mockReset();
  });

  it('đọc page/size từ query string', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listOrdersAdminMock.mockResolvedValue({ data: { content: [], number: 1, size: 10, totalElements: 0, totalPages: 0 }, error: null });

    await GET(makeRequest('http://localhost:3000/api/orders/admin/orders?page=1&size=10'));

    expect(listOrdersAdminMock).toHaveBeenCalledWith({}, { page: 1, size: 10 });
  });

  it('trả 403 khi caller không phải admin/staff', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'customer' }, supabase: {} });

    const response = await GET(makeRequest('http://localhost:3000/api/orders/admin/orders'));

    expect(response.status).toBe(403);
  });
});

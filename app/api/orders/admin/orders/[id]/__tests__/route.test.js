import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const getOrderAdminByIdMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminOrders', () => ({
  getOrderAdminById: (...args) => getOrderAdminByIdMock(...args),
}));

import { GET } from '../route';

function makeRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/orders/admin/orders/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    getOrderAdminByIdMock.mockReset();
  });

  it('trả order khi tìm thấy', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    getOrderAdminByIdMock.mockResolvedValue({ data: { id: 1, orderCode: 'SDL2345ABCD' }, error: null });

    const response = await GET(makeRequest(), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(body.orderCode).toBe('SDL2345ABCD');
  });

  it('trả 404 khi không tìm thấy', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    getOrderAdminByIdMock.mockResolvedValue({ data: null, error: null });

    const response = await GET(makeRequest(), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });
});

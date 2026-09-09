import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listInventoryAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminCatalog', () => ({
  listInventoryAdmin: (...args) => listInventoryAdminMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/catalog/admin/inventory', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listInventoryAdminMock.mockReset();
  });

  it('đọc productId/status từ query string', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listInventoryAdminMock.mockResolvedValue({ data: [], error: null });

    await GET(makeRequest('http://localhost:3000/api/catalog/admin/inventory?productId=10&status=in_stock'));

    expect(listInventoryAdminMock).toHaveBeenCalledWith({}, { productId: '10', status: 'in_stock' });
  });
});

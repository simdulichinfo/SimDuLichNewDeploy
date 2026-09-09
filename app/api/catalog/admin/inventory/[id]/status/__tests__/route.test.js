import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const updateInventoryStatusAdminMock = vi.fn();

vi.mock('../../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../../lib/adminCatalog', () => ({
  updateInventoryStatusAdmin: (...args) => updateInventoryStatusAdminMock(...args),
}));

import { PUT } from '../route';

function makeRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('PUT /api/catalog/admin/inventory/[id]/status', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    updateInventoryStatusAdminMock.mockReset();
  });

  it('cập nhật status thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateInventoryStatusAdminMock.mockResolvedValue({ data: { id: 1, status: 'sold' }, error: null });

    const response = await PUT(makeRequest({ status: 'sold' }), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(body.status).toBe('sold');
  });

  it('trả 404 khi không tìm thấy id', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updateInventoryStatusAdminMock.mockResolvedValue({ data: null, error: null });

    const response = await PUT(makeRequest({ status: 'sold' }), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });
});

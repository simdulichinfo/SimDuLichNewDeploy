import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const importInventoryAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminCatalog', () => ({
  importInventoryAdmin: (...args) => importInventoryAdminMock(...args),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('POST /api/catalog/admin/inventory/import', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    importInventoryAdminMock.mockReset();
  });

  it('chèn ICCID mới, trả 201', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    importInventoryAdminMock.mockResolvedValue({ data: [{ id: 1, iccid: 'x' }], error: null });

    const response = await POST(makeRequest({ productId: 10, iccids: ['x', 'y'] }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual([{ id: 1, iccid: 'x' }]);
  });

  it('trả 400 khi thiếu iccids', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makeRequest({ productId: 10, iccids: [] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu danh sách ICCID cần nhập.' });
  });

  it('trả 400 khi productId không tồn tại', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    importInventoryAdminMock.mockResolvedValue({ data: null, error: { code: '23503' } });

    const response = await POST(makeRequest({ productId: 999, iccids: ['x'] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'productId không tồn tại.' });
  });

  it('trả 403 khi caller là staff (chỉ admin mới nhập kho)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const response = await POST(makeRequest({ productId: 10, iccids: ['x'] }));

    expect(response.status).toBe(403);
    expect(importInventoryAdminMock).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const runProductImportMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/productImport', () => ({
  runProductImport: (...args) => runProductImportMock(...args),
}));

import { POST } from '../route';

describe('POST /api/catalog/admin/products/import', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    runProductImportMock.mockReset();
  });

  it('chạy import và trả summary', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    runProductImportMock.mockResolvedValue({ totalRows: 1, created: 1, updated: 0, failed: 0, rows: [] });

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([['file', fakeFile], ['pricingMode', 'manual']]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);
    const body = await response.json();

    expect(body.created).toBe(1);
    expect(runProductImportMock).toHaveBeenCalledWith({}, expect.any(Buffer), { pricingMode: 'manual', markupPercent: null, fixedFee: null });
  });

  it('trả 400 khi thiếu file', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const formData = new Map();
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Vui lòng chọn file để nhập.' });
  });
});

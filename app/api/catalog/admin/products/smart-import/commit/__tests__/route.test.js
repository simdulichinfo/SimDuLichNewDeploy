import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const runSmartImportMock = vi.fn();

vi.mock('../../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
const { FakeSmartImportLookupError } = vi.hoisted(() => ({
  FakeSmartImportLookupError: class FakeSmartImportLookupError extends Error {},
}));
vi.mock('../../../../../../../../lib/smartImportRunner', () => ({
  runSmartImport: (...args) => runSmartImportMock(...args),
  SmartImportLookupError: FakeSmartImportLookupError,
}));

import { POST } from '../route';

describe('POST /api/catalog/admin/products/smart-import/commit', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    runSmartImportMock.mockReset();
  });

  it('gọi runSmartImport với commit:true và trả ProductImportSummary', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    runSmartImportMock.mockResolvedValue({ totalRows: 1, created: 1, updated: 0, failed: 0, rows: [] });

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([['file', fakeFile]]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);
    const body = await response.json();

    expect(runSmartImportMock).toHaveBeenCalledWith(
      {}, expect.any(Buffer), { esimMarkupPercent: null, physicalFixedFee: null, physicalNoDurationMultiplier: null }, { commit: true },
    );
    expect(body.created).toBe(1);
  });

  it('trả 500 với thông báo rõ ràng khi runSmartImport báo lỗi đọc dữ liệu hiện có (SmartImportLookupError), không ghi gì', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    runSmartImportMock.mockRejectedValue(new FakeSmartImportLookupError('boom'));

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([['file', fakeFile]]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).toBe('Không đọc được dữ liệu hiện có, vui lòng thử lại.');
  });
});

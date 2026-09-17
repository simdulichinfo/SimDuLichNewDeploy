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

describe('POST /api/catalog/admin/products/smart-import/analyze', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    runSmartImportMock.mockReset();
  });

  it('gọi runSmartImport với commit:false và trả preview', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    runSmartImportMock.mockResolvedValue({ totalRows: 1, rows: [] });

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([['file', fakeFile], ['esimMarkupPercent', '25']]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);
    const body = await response.json();

    expect(runSmartImportMock).toHaveBeenCalledWith(
      {}, expect.any(Buffer), { esimMarkupPercent: 25, physicalFixedFee: null, physicalNoDurationMultiplier: null }, { commit: false },
    );
    expect(body.totalRows).toBe(1);
  });

  it('3 tham số pricing gửi lên là chuỗi rỗng ("") -> coi như thiếu, không truyền 0 xuống runSmartImport', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    runSmartImportMock.mockResolvedValue({ totalRows: 1, rows: [] });

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([
      ['file', fakeFile],
      ['esimMarkupPercent', ''],
      ['physicalFixedFee', ''],
      ['physicalNoDurationMultiplier', ''],
    ]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    await POST(request);

    expect(runSmartImportMock).toHaveBeenCalledWith(
      {}, expect.any(Buffer), { esimMarkupPercent: null, physicalFixedFee: null, physicalNoDurationMultiplier: null }, { commit: false },
    );
  });

  it('trả 500 với thông báo rõ ràng khi runSmartImport báo lỗi đọc dữ liệu hiện có (SmartImportLookupError)', async () => {
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

  it('trả 403 khi caller là staff (chỉ admin mới phân tích bảng giá)', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });

    const fakeFile = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const formData = new Map([['file', fakeFile]]);
    const request = {
      headers: { get: () => 'Bearer good-token' },
      formData: () => Promise.resolve({ get: (key) => formData.get(key) }),
    };

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(runSmartImportMock).not.toHaveBeenCalled();
  });
});

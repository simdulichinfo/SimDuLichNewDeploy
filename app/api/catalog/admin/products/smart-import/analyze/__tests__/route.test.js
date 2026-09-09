import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const runSmartImportMock = vi.fn();

vi.mock('../../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../../lib/smartImportRunner', () => ({
  runSmartImport: (...args) => runSmartImportMock(...args),
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
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createServiceClientMock = vi.fn();
const processSepayWebhookMock = vi.fn();

vi.mock('../../../../../../../../lib/supabase/serviceClient', () => ({
  createServiceClient: (...args) => createServiceClientMock(...args),
}));
vi.mock('../../../../../../../../lib/paymentsWebhook', () => ({
  processSepayWebhook: (...args) => processSepayWebhookMock(...args),
}));

import { POST } from '../route';

function makeRequest(body, apiKeyHeader) {
  return {
    headers: { get: (key) => (key.toLowerCase() === 'authorization' ? apiKeyHeader ?? null : null) },
    json: () => Promise.resolve(body),
  };
}

describe('POST /api/payments/payments/webhook/sepay/callback', () => {
  const originalKey = process.env.SEPAY_API_KEY;

  beforeEach(() => {
    createServiceClientMock.mockReset();
    processSepayWebhookMock.mockReset();
    process.env.SEPAY_API_KEY = 'real-key';
  });

  afterEach(() => {
    process.env.SEPAY_API_KEY = originalKey;
  });

  it('trả 401 khi thiếu hoặc sai API key', async () => {
    const response = await POST(makeRequest({ transferType: 'in' }, 'Apikey wrong-key'));

    expect(response.status).toBe(401);
    expect(processSepayWebhookMock).not.toHaveBeenCalled();
  });

  it('trả 200 {received:true} khi API key đúng, bất kể khớp hay không', async () => {
    createServiceClientMock.mockReturnValue({});
    processSepayWebhookMock.mockResolvedValue({ matched: false, reason: 'amount_mismatch' });

    const response = await POST(makeRequest({ transferType: 'in', content: 'SDL2345ABCD', transferAmount: 1, id: 1 }, 'Apikey real-key'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true });
  });

  it('trả 500 khi service client không tạo được (thiếu env)', async () => {
    createServiceClientMock.mockReturnValue(null);

    const response = await POST(makeRequest({ transferType: 'in' }, 'Apikey real-key'));

    expect(response.status).toBe(500);
  });

  it('vẫn trả 200 {received:true} khi processSepayWebhook throw lỗi bất ngờ', async () => {
    createServiceClientMock.mockReturnValue({});
    processSepayWebhookMock.mockRejectedValue(new Error('supabase network error'));

    const response = await POST(makeRequest({ transferType: 'in', content: 'SDL2345ABCD', transferAmount: 1, id: 1 }, 'Apikey real-key'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true });
  });
});

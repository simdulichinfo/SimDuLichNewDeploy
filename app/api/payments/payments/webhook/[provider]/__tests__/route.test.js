import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createServiceClientMock = vi.fn();
const simulatePaymentWebhookMock = vi.fn();

vi.mock('../../../../../../../lib/supabase/serviceClient', () => ({
  createServiceClient: (...args) => createServiceClientMock(...args),
}));
vi.mock('../../../../../../../lib/paymentsWebhook', () => ({
  simulatePaymentWebhook: (...args) => simulatePaymentWebhookMock(...args),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/payments/payments/webhook/[provider] (dev simulator)', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    createServiceClientMock.mockReset();
    simulatePaymentWebhookMock.mockReset();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('trả 404 khi NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';

    const response = await POST(makeRequest({ orderId: 1, amount: 1, transactionRef: 'x' }), { params: Promise.resolve({ provider: 'sepay' }) });

    expect(response.status).toBe(404);
    expect(createServiceClientMock).not.toHaveBeenCalled();
  });

  it('trả processed=true khi không phải production và khớp order', async () => {
    process.env.NODE_ENV = 'test';
    createServiceClientMock.mockReturnValue({});
    simulatePaymentWebhookMock.mockResolvedValue({ matched: true });

    const response = await POST(makeRequest({ orderId: 1, amount: 178000, transactionRef: 'SIM-1' }), { params: Promise.resolve({ provider: 'sepay' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: true, duplicate: false });
  });
});

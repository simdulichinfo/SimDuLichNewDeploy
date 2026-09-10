import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const serviceClientMock = { from: fromMock };

import { processSepayWebhook, simulatePaymentWebhook } from '../paymentsWebhook';

describe('processSepayWebhook', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('bỏ qua giao dịch chuyển ra (transferType != in)', async () => {
    const result = await processSepayWebhook(serviceClientMock, { transferType: 'out', content: 'SDL2345ABCD', transferAmount: 178000, id: 1 });

    expect(result).toEqual({ matched: false, reason: 'not_incoming' });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('ghi api_logs khi không tìm thấy mã đơn trong content', async () => {
    const logQuery = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockReturnValue(logQuery);

    const result = await processSepayWebhook(serviceClientMock, { transferType: 'in', content: 'chuyen tien khong ro noi dung', transferAmount: 178000, id: 1 });

    expect(result).toEqual({ matched: false, reason: 'no_order_code' });
    expect(fromMock).toHaveBeenCalledWith('api_logs');
  });

  it('khớp mã đơn + số tiền -> cập nhật paid và ghi transaction', async () => {
    const orderQuery = createQueryBuilderMock({ data: { id: 1, total_amount: 178000, payment_status: 'pending' }, error: null });
    const insertTxQuery = createQueryBuilderMock({ data: null, error: null });
    const updateOrderQuery = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockImplementation((table) => {
      if (table === 'orders') return orderQuery.eq.mock.calls.length === 0 ? orderQuery : updateOrderQuery;
      if (table === 'payment_transactions') return insertTxQuery;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await processSepayWebhook(serviceClientMock, { transferType: 'in', content: 'CK toi don SDL2345ABCD', transferAmount: 178000, id: 42 });

    expect(insertTxQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ order_id: 1, transaction_ref: 'SEPAY-42', amount: 178000 }));
    expect(result).toEqual({ matched: true });
  });

  it('ghi api_logs khi số tiền không khớp, không cập nhật order', async () => {
    const orderQuery = createQueryBuilderMock({ data: { id: 1, total_amount: 178000, payment_status: 'pending' }, error: null });
    const logQuery = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockImplementation((table) => (table === 'orders' ? orderQuery : logQuery));

    const result = await processSepayWebhook(serviceClientMock, { transferType: 'in', content: 'CK toi don SDL2345ABCD', transferAmount: 100000, id: 42 });

    expect(result).toEqual({ matched: false, reason: 'amount_mismatch' });
    expect(fromMock).toHaveBeenCalledWith('api_logs');
  });

  it('webhook gọi lại (transaction_ref trùng) -> trả duplicate, không update lại order', async () => {
    const orderQuery = createQueryBuilderMock({ data: { id: 1, total_amount: 178000, payment_status: 'paid' }, error: null });
    const insertTxQuery = createQueryBuilderMock({ data: null, error: { code: '23505' } });
    fromMock.mockImplementation((table) => (table === 'orders' ? orderQuery : insertTxQuery));

    const result = await processSepayWebhook(serviceClientMock, { transferType: 'in', content: 'CK toi don SDL2345ABCD', transferAmount: 178000, id: 42 });

    expect(result).toEqual({ matched: true, duplicate: true });
  });
});

describe('simulatePaymentWebhook', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('đánh dấu order paid và ghi transaction', async () => {
    const orderQuery = createQueryBuilderMock({ data: { id: 1, payment_status: 'pending' }, error: null });
    const insertTxQuery = createQueryBuilderMock({ data: null, error: null });
    const updateOrderQuery = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockImplementation((table) => {
      if (table === 'orders') return orderQuery.eq.mock.calls.length === 0 ? orderQuery : updateOrderQuery;
      return insertTxQuery;
    });

    const result = await simulatePaymentWebhook(serviceClientMock, { orderId: 1, amount: 178000, transactionRef: 'SIM-1' });

    expect(result).toEqual({ matched: true });
  });

  it('trả matched false khi không tìm thấy order', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    const result = await simulatePaymentWebhook(serviceClientMock, { orderId: 999, amount: 178000, transactionRef: 'SIM-1' });

    expect(result).toEqual({ matched: false, reason: 'order_not_found' });
  });

  it('insert trùng transaction_ref (23505) -> trả duplicate, không update order', async () => {
    const orderQuery = createQueryBuilderMock({ data: { id: 1, payment_status: 'pending' }, error: null });
    const insertTxQuery = createQueryBuilderMock({ data: null, error: { code: '23505' } });
    fromMock.mockImplementation((table) => (table === 'orders' ? orderQuery : insertTxQuery));

    const result = await simulatePaymentWebhook(serviceClientMock, { orderId: 1, amount: 178000, transactionRef: 'SIM-1' });

    expect(result).toEqual({ matched: true, duplicate: true });
    expect(orderQuery.update).not.toHaveBeenCalled();
  });
});

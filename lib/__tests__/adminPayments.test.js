import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

import { listPaymentsAdmin, listApiLogsAdmin, confirmPaymentAdmin } from '../adminPayments';

describe('lib/adminPayments', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  describe('listPaymentsAdmin', () => {
    it('lọc theo orderId khi có', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await listPaymentsAdmin(supabaseMock, { orderId: 5 });

      expect(query.eq).toHaveBeenCalledWith('order_id', 5);
    });

    it('không lọc gì khi orderId không có', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await listPaymentsAdmin(supabaseMock, {});

      expect(query.eq).not.toHaveBeenCalled();
    });
  });

  describe('listApiLogsAdmin', () => {
    it('lọc theo orderId khi có', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await listApiLogsAdmin(supabaseMock, { orderId: 5 });

      expect(query.eq).toHaveBeenCalledWith('order_id', 5);
    });
  });

  describe('confirmPaymentAdmin', () => {
    it('đánh dấu paid và ghi transaction khi đơn đang pending', async () => {
      const orderQuery = createQueryBuilderMock({
        data: { id: 1, order_code: 'SDL2345ABCD', user_id: null, cust_name: 'A', cust_email: 'a@x.vn', total_amount: 178000, payment_method: 'sepay', payment_status: 'pending', shipping_method: 'email', shipping_status: 'none', carrier_name: null, tracking_code: null, created_at: '2026-09-10T00:00:00Z' },
        error: null,
      });
      const updateQuery = createQueryBuilderMock({ data: null, error: null });
      const insertQuery = createQueryBuilderMock({ data: null, error: null });
      let orderCallCount = 0;
      fromMock.mockImplementation((table) => {
        if (table === 'orders') { orderCallCount += 1; return orderCallCount === 1 ? orderQuery : updateQuery; }
        return insertQuery;
      });

      const result = await confirmPaymentAdmin(supabaseMock, 'SDL2345ABCD');

      expect(updateQuery.update).toHaveBeenCalledWith({ payment_status: 'paid' });
      expect(insertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ order_id: 1, amount: 178000 }));
      expect(result.data.paymentStatus).toBe('paid');
    });

    it('không tạo transaction trùng khi đơn đã paid sẵn', async () => {
      const orderQuery = createQueryBuilderMock({
        data: { id: 1, order_code: 'SDL2345ABCD', user_id: null, cust_name: 'A', cust_email: 'a@x.vn', total_amount: 178000, payment_method: 'sepay', payment_status: 'paid', shipping_method: 'email', shipping_status: 'none', carrier_name: null, tracking_code: null, created_at: '2026-09-10T00:00:00Z' },
        error: null,
      });
      fromMock.mockReturnValue(orderQuery);

      const result = await confirmPaymentAdmin(supabaseMock, 'SDL2345ABCD');

      expect(fromMock).toHaveBeenCalledTimes(1);
      expect(result.data.paymentStatus).toBe('paid');
    });

    it('trả data null khi không tìm thấy orderCode', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await confirmPaymentAdmin(supabaseMock, 'KHONGTONTAI');

      expect(result).toEqual({ data: null, error: null });
    });
  });
});

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
    const pendingOrderRow = {
      id: 1, order_code: 'SDL2345ABCD', user_id: null, cust_name: 'A', cust_email: 'a@x.vn',
      total_amount: 178000, payment_method: 'sepay', payment_status: 'pending',
      shipping_method: 'email', shipping_status: 'none', carrier_name: null,
      tracking_code: null, created_at: '2026-09-10T00:00:00Z',
    };

    // The audit-trail insert must happen BEFORE the order is flipped to 'paid', so the
    // 'orders' table is hit first for the select and only afterwards for the update.
    function wireMocks({ selectQuery, insertQuery, updateQuery, tableOrder }) {
      let orderCallCount = 0;
      fromMock.mockImplementation((table) => {
        tableOrder.push(table);
        if (table === 'orders') {
          orderCallCount += 1;
          return orderCallCount === 1 ? selectQuery : updateQuery;
        }
        if (table === 'payment_transactions') return insertQuery;
        throw new Error(`unexpected table ${table}`);
      });
    }

    it('ghi transaction trước rồi mới đánh dấu paid khi đơn đang pending', async () => {
      const selectQuery = createQueryBuilderMock({ data: { ...pendingOrderRow }, error: null });
      const updateQuery = createQueryBuilderMock({ data: null, error: null });
      const insertQuery = createQueryBuilderMock({ data: null, error: null });
      const tableOrder = [];
      wireMocks({ selectQuery, insertQuery, updateQuery, tableOrder });

      const result = await confirmPaymentAdmin(supabaseMock, 'SDL2345ABCD');

      expect(tableOrder).toEqual(['orders', 'payment_transactions', 'orders']);
      expect(insertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ order_id: 1, amount: 178000 }));
      expect(updateQuery.update).toHaveBeenCalledWith({ payment_status: 'paid' });
      expect(updateQuery.eq).toHaveBeenCalledWith('id', 1);
      expect(result.data.paymentStatus).toBe('paid');
    });

    it('trả lỗi khi insert payment_transactions thất bại, chưa đánh dấu order là paid', async () => {
      const selectQuery = createQueryBuilderMock({ data: { ...pendingOrderRow }, error: null });
      const updateQuery = createQueryBuilderMock({ data: null, error: null });
      const insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
      const insertQuery = createQueryBuilderMock({ data: null, error: insertError });
      const tableOrder = [];
      wireMocks({ selectQuery, insertQuery, updateQuery, tableOrder });

      const result = await confirmPaymentAdmin(supabaseMock, 'SDL2345ABCD');

      expect(insertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ order_id: 1, amount: 178000 }));
      expect(result).toEqual({ data: null, error: insertError });
      expect(updateQuery.update).not.toHaveBeenCalled();
      expect(tableOrder).toEqual(['orders', 'payment_transactions']);
    });

    it('trả lỗi khi update orders thất bại (sau khi transaction đã được ghi)', async () => {
      const selectQuery = createQueryBuilderMock({ data: { ...pendingOrderRow }, error: null });
      const updateError = { message: 'update failed' };
      const updateQuery = createQueryBuilderMock({ data: null, error: updateError });
      const insertQuery = createQueryBuilderMock({ data: null, error: null });
      const tableOrder = [];
      wireMocks({ selectQuery, insertQuery, updateQuery, tableOrder });

      const result = await confirmPaymentAdmin(supabaseMock, 'SDL2345ABCD');

      expect(insertQuery.insert).toHaveBeenCalled();
      expect(result).toEqual({ data: null, error: updateError });
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

import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
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

const sampleOrderRow = {
  id: 1, order_code: 'SDL2345ABCD', user_id: null, cust_name: 'A', cust_email: 'a@x.vn', cust_phone: '0900000000',
  total_amount: 178000, payment_method: 'sepay', payment_status: 'pending', shipping_method: 'email',
  shipping_address: null, shipping_status: 'none', carrier_name: null, tracking_code: null, created_at: '2026-09-10T00:00:00Z',
};

import { listOrdersAdmin, getOrderAdminById, mapOrderSummary } from '../adminOrders';

describe('lib/adminOrders', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  describe('listOrdersAdmin', () => {
    it('phân trang 0-indexed, trả field number', async () => {
      const query = createQueryBuilderMock({ data: [sampleOrderRow], count: 1, error: null });
      fromMock.mockReturnValue(query);

      const result = await listOrdersAdmin(supabaseMock, { page: 0, size: 20 });

      expect(query.range).toHaveBeenCalledWith(0, 19);
      expect(result.data.number).toBe(0);
      expect(result.data.content[0]).toEqual(mapOrderSummary(sampleOrderRow));
    });

    it('dùng page=0/size=20 khi tham số không hợp lệ (NaN)', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      const result = await listOrdersAdmin(supabaseMock, { page: NaN, size: NaN });

      expect(query.range).toHaveBeenCalledWith(0, 19);
      expect(result.data.number).toBe(0);
      expect(result.data.size).toBe(20);
    });
  });

  describe('getOrderAdminById', () => {
    it('trả order kèm items', async () => {
      const orderQuery = createQueryBuilderMock({ data: sampleOrderRow, error: null });
      const itemsQuery = createQueryBuilderMock({
        data: [{ id: 1, product_id: 1, product_title: 'eSIM Nhật Bản', quantity: 2, unit_price: 89000, sim_type: 'esim' }],
        error: null,
      });
      fromMock.mockImplementation((table) => (table === 'orders' ? orderQuery : itemsQuery));

      const result = await getOrderAdminById(supabaseMock, 1);

      expect(result.data.items).toEqual([{ id: 1, productId: 1, productName: 'eSIM Nhật Bản', quantity: 2, unitPrice: 89000, simType: 'esim' }]);
    });

    it('trả data null khi không tìm thấy', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await getOrderAdminById(supabaseMock, 999);

      expect(result).toEqual({ data: null, error: null });
    });
  });
});

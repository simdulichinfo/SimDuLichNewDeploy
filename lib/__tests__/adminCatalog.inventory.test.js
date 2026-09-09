import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

const sampleRow = {
  id: 1, product_id: 10, iccid: '8984000000000000001', status: 'in_stock',
  reserved_order_item_id: null, imported_at: '2026-09-07T00:00:00Z',
};
const sampleMapped = {
  id: 1, productId: 10, iccid: '8984000000000000001', status: 'in_stock',
  reservedOrderItemId: null, importedAt: '2026-09-07T00:00:00Z',
};

import { listInventoryAdmin, importInventoryAdmin, updateInventoryStatusAdmin } from '../adminCatalog';

describe('lib/adminCatalog — inventory', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  describe('listInventoryAdmin', () => {
    it('lọc theo productId và status khi có cả hai', async () => {
      const query = createQueryBuilderMock({ data: [sampleRow], error: null });
      fromMock.mockReturnValue(query);

      const result = await listInventoryAdmin(supabaseMock, { productId: 10, status: 'in_stock' });

      expect(query.eq).toHaveBeenCalledWith('product_id', 10);
      expect(query.eq).toHaveBeenCalledWith('status', 'in_stock');
      expect(result).toEqual({ data: [sampleMapped], error: null });
    });

    it('không lọc gì khi cả hai tham số đều thiếu', async () => {
      const query = createQueryBuilderMock({ data: [sampleRow], error: null });
      fromMock.mockReturnValue(query);

      await listInventoryAdmin(supabaseMock, {});

      expect(query.eq).not.toHaveBeenCalled();
    });
  });

  describe('importInventoryAdmin', () => {
    it('chèn ICCID mới, trả về đúng những dòng mới thêm', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [sampleRow], error: null }));

      const result = await importInventoryAdmin(supabaseMock, 10, ['8984000000000000001']);

      expect(fromMock().upsert).toHaveBeenCalledWith(
        [{ product_id: 10, iccid: '8984000000000000001', status: 'in_stock' }],
        { onConflict: 'iccid', ignoreDuplicates: true },
      );
      expect(result).toEqual({ data: [sampleMapped], error: null });
    });
  });

  describe('updateInventoryStatusAdmin', () => {
    it('cập nhật status và trả data null khi không tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await updateInventoryStatusAdmin(supabaseMock, 999, 'sold');

      expect(result).toEqual({ data: null, error: null });
    });

    it('trả InventoryResponse đã update khi thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: { ...sampleRow, status: 'sold' }, error: null }));

      const result = await updateInventoryStatusAdmin(supabaseMock, 1, 'sold');

      expect(result.data.status).toBe('sold');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

const sampleRow = {
  id: 1, category_id: 5, title: 'eSIM Nhật Bản 1GB/ngày', slug: 'esim-nb-1gb',
  sim_type: 'esim', price_buy: 89000, price_import: 60000, data_info: '1GB/ngày',
  duration_days: 3, package_type: 'daily', capacity_bucket: '1gb',
  api_package_code: 'WM-JP-1', status: 'active',
};
const sampleMapped = {
  id: 1, categoryId: 5, title: 'eSIM Nhật Bản 1GB/ngày', slug: 'esim-nb-1gb',
  simType: 'esim', priceBuy: 89000, priceImport: 60000, dataInfo: '1GB/ngày',
  durationDays: 3, apiPackageCode: 'WM-JP-1', status: 'active',
};

import {
  listProductsAdmin, searchProductsAdmin, createProductAdmin, updateProductAdmin, deleteProductAdmin,
} from '../adminCatalog';

describe('lib/adminCatalog — products', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  describe('listProductsAdmin', () => {
    it('trả toàn bộ sản phẩm không phân trang', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [sampleRow], error: null }));

      const result = await listProductsAdmin(supabaseMock);

      expect(fromMock).toHaveBeenCalledWith('products');
      expect(result).toEqual({ data: [sampleMapped], error: null });
    });
  });

  describe('searchProductsAdmin', () => {
    it('phân trang 0-indexed, trả field number (không phải page)', async () => {
      const query = createQueryBuilderMock({ data: [sampleRow], count: 25, error: null });
      fromMock.mockReturnValue(query);

      const result = await searchProductsAdmin(supabaseMock, { page: 0, size: 20 });

      expect(query.range).toHaveBeenCalledWith(0, 19);
      expect(result.data).toEqual({
        content: [sampleMapped], number: 0, size: 20, totalElements: 25, totalPages: 2,
      });
    });

    it('lọc theo categoryId và search khi có', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await searchProductsAdmin(supabaseMock, { categoryId: 5, search: 'nhat' });

      expect(query.eq).toHaveBeenCalledWith('category_id', 5);
      expect(query.ilike).toHaveBeenCalledWith('title', '%nhat%');
    });

    it('dùng page=0/size=20 khi tham số không hợp lệ (NaN)', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      const result = await searchProductsAdmin(supabaseMock, { page: NaN, size: NaN });

      expect(query.range).toHaveBeenCalledWith(0, 19);
      expect(result.data.number).toBe(0);
      expect(result.data.size).toBe(20);
    });
  });

  describe('createProductAdmin', () => {
    it('tự suy ra package_type/capacity_bucket từ dataInfo, không nhận từ input', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: sampleRow, error: null }));

      const result = await createProductAdmin(supabaseMock, {
        categoryId: 5, title: 'eSIM Nhật Bản 1GB/ngày', slug: 'esim-nb-1gb', simType: 'esim',
        priceBuy: 89000, priceImport: 60000, dataInfo: '1GB/ngày', durationDays: 3,
        apiPackageCode: 'WM-JP-1', status: 'active',
      });

      expect(fromMock().insert).toHaveBeenCalledWith(expect.objectContaining({
        package_type: 'daily', capacity_bucket: '1gb',
      }));
      expect(result.data).toEqual(sampleMapped);
    });
  });

  describe('updateProductAdmin', () => {
    it('cập nhật và trả data null khi không tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await updateProductAdmin(supabaseMock, 999, {
        categoryId: 5, title: 'X', slug: 'x', simType: 'esim', priceBuy: 1, priceImport: 1,
        dataInfo: '1GB', durationDays: 1, status: 'active',
      });

      expect(result).toEqual({ data: null, error: null });
    });
  });

  describe('deleteProductAdmin', () => {
    it('trả deleted true khi xoá thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [{ id: 1 }], error: null }));

      const result = await deleteProductAdmin(supabaseMock, 1);

      expect(result).toEqual({ deleted: true, error: null });
    });
  });
});

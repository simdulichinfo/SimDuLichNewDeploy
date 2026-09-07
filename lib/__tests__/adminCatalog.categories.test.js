import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

import {
  listCategoriesAdmin, createCategoryAdmin, updateCategoryAdmin, deleteCategoryAdmin,
} from '../adminCatalog';

describe('lib/adminCatalog — categories', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  describe('listCategoriesAdmin', () => {
    it('trả mọi category kèm coveredCountries, không lọc status', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: [
          { id: 1, name: 'Nhật Bản', slug: 'nhat-ban', image_url: null, status: 'inactive', category_countries: [{ country_code: 'jp' }] },
        ],
        error: null,
      }));

      const result = await listCategoriesAdmin(supabaseMock);

      expect(fromMock).toHaveBeenCalledWith('categories');
      expect(result).toEqual({
        data: [{ id: 1, name: 'Nhật Bản', slug: 'nhat-ban', imageUrl: null, status: 'inactive', coveredCountries: ['jp'] }],
        error: null,
      });
    });
  });

  describe('createCategoryAdmin', () => {
    it('tạo category mới, coveredCountries luôn rỗng', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: { id: 5, name: 'Lào', slug: 'lao', image_url: null, status: 'active' },
        error: null,
      }));

      const result = await createCategoryAdmin(supabaseMock, { name: 'Lào', slug: 'lao', imageUrl: null, status: 'active' });

      expect(result).toEqual({
        data: { id: 5, name: 'Lào', slug: 'lao', imageUrl: null, status: 'active', coveredCountries: [] },
        error: null,
      });
    });

    it('trả error khi slug đã tồn tại', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { code: '23505', message: 'duplicate key' } }));

      const result = await createCategoryAdmin(supabaseMock, { name: 'Lào', slug: 'lao', imageUrl: null, status: 'active' });

      expect(result.error.code).toBe('23505');
    });
  });

  describe('updateCategoryAdmin', () => {
    it('cập nhật category và trả data mới', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: { id: 5, name: 'Lào (updated)', slug: 'lao', image_url: null, status: 'active' },
        error: null,
      }));

      const result = await updateCategoryAdmin(supabaseMock, 5, { name: 'Lào (updated)', slug: 'lao', imageUrl: null, status: 'active' });

      expect(result.data.name).toBe('Lào (updated)');
    });

    it('trả data null khi không tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await updateCategoryAdmin(supabaseMock, 999, { name: 'X', slug: 'x', imageUrl: null, status: 'active' });

      expect(result).toEqual({ data: null, error: null });
    });
  });

  describe('deleteCategoryAdmin', () => {
    it('trả deleted true khi xoá thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [{ id: 5 }], error: null }));

      const result = await deleteCategoryAdmin(supabaseMock, 5);

      expect(result).toEqual({ deleted: true, error: null });
    });

    it('trả deleted false khi không tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

      const result = await deleteCategoryAdmin(supabaseMock, 999);

      expect(result).toEqual({ deleted: false, error: null });
    });

    it('trả error khi bị chặn bởi khoá ngoại (còn sản phẩm tham chiếu)', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { code: '23503', message: 'foreign key violation' } }));

      const result = await deleteCategoryAdmin(supabaseMock, 1);

      expect(result.error.code).toBe('23503');
    });
  });
});

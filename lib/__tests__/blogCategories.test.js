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
const createApiClientMock = vi.fn();

vi.mock('../supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));

import {
  listCategoriesPublic, listCategoriesAdmin, createCategoryAdmin, updateCategoryAdmin, deleteCategoryAdmin,
} from '../blogCategories';

describe('lib/blogCategories', () => {
  beforeEach(() => {
    fromMock.mockReset();
    createApiClientMock.mockReset();
  });

  describe('listCategoriesPublic', () => {
    it('trả mảng danh mục khi thành công', async () => {
      createApiClientMock.mockReturnValue(supabaseMock);
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: [{ id: 1, name: 'Hướng dẫn cài đặt', slug: 'guides' }],
        error: null,
      }));

      const result = await listCategoriesPublic();

      expect(result).toEqual([{ id: 1, name: 'Hướng dẫn cài đặt', slug: 'guides' }]);
    });

    it('trả mảng rỗng khi Supabase chưa cấu hình', async () => {
      createApiClientMock.mockReturnValue(null);

      const result = await listCategoriesPublic();

      expect(result).toEqual([]);
    });

    it('trả mảng rỗng khi query lỗi (không throw)', async () => {
      createApiClientMock.mockReturnValue(supabaseMock);
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { message: 'boom' } }));

      const result = await listCategoriesPublic();

      expect(result).toEqual([]);
    });
  });

  describe('listCategoriesAdmin', () => {
    it('trả {data, error}', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: [{ id: 1, name: 'Hướng dẫn cài đặt', slug: 'guides' }],
        error: null,
      }));

      const result = await listCategoriesAdmin(supabaseMock);

      expect(result).toEqual({ data: [{ id: 1, name: 'Hướng dẫn cài đặt', slug: 'guides' }], error: null });
    });
  });

  describe('createCategoryAdmin', () => {
    it('tạo danh mục thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: { id: 4, name: 'Mới', slug: 'moi' },
        error: null,
      }));

      const result = await createCategoryAdmin(supabaseMock, { name: 'Mới', slug: 'moi' });

      expect(result).toEqual({ data: { id: 4, name: 'Mới', slug: 'moi' }, error: null });
    });

    it('trả error khi slug trùng', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { code: '23505' } }));

      const result = await createCategoryAdmin(supabaseMock, { name: 'Mới', slug: 'guides' });

      expect(result.data).toBeNull();
      expect(result.error.code).toBe('23505');
    });
  });

  describe('updateCategoryAdmin', () => {
    it('sửa danh mục thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: { id: 1, name: 'Đổi tên', slug: 'guides' },
        error: null,
      }));

      const result = await updateCategoryAdmin(supabaseMock, 1, { name: 'Đổi tên', slug: 'guides' });

      expect(result).toEqual({ data: { id: 1, name: 'Đổi tên', slug: 'guides' }, error: null });
    });

    it('trả {data: null, error: null} khi không tìm thấy', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await updateCategoryAdmin(supabaseMock, 999, { name: 'X', slug: 'x' });

      expect(result).toEqual({ data: null, error: null });
    });
  });

  describe('deleteCategoryAdmin', () => {
    it('trả {deleted: true} khi xoá thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [{ id: 1 }], error: null }));

      const result = await deleteCategoryAdmin(supabaseMock, 1);

      expect(result).toEqual({ deleted: true, error: null });
    });

    it('trả {deleted: false} khi không tìm thấy', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

      const result = await deleteCategoryAdmin(supabaseMock, 999);

      expect(result).toEqual({ deleted: false, error: null });
    });

    it('trả error khi còn bài viết tham chiếu (FK)', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { code: '23503' } }));

      const result = await deleteCategoryAdmin(supabaseMock, 1);

      expect(result.deleted).toBe(false);
      expect(result.error.code).toBe('23503');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
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
const createApiClientMock = vi.fn();

vi.mock('../supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));

import {
  listPostsPublic, getPostBySlugPublic, listPostsAdmin, getPostAdminById,
  createPostAdmin, updatePostAdmin, deletePostAdmin,
} from '../blogPosts';

const ROW = {
  id: 1, category_id: 2, blog_categories: { name: 'Kinh nghiệm du lịch' },
  title: 'Bài test', slug: 'bai-test', excerpt: 'Mô tả ngắn', content: '<p>Nội dung</p>',
  image_url: '/images/x.png', author: 'Tác giả', status: 'published',
  published_at: '2026-06-15T00:00:00+07:00', created_at: '2026-06-01T00:00:00+07:00', updated_at: '2026-06-01T00:00:00+07:00',
};

describe('lib/blogPosts', () => {
  beforeEach(() => {
    fromMock.mockReset();
    createApiClientMock.mockReset();
  });

  describe('listPostsPublic', () => {
    it('trả mảng bài viết đã map đúng field', async () => {
      createApiClientMock.mockReturnValue(supabaseMock);
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [ROW], error: null }));

      const result = await listPostsPublic();

      expect(result).toEqual([{
        id: 1, categoryId: 2, categoryName: 'Kinh nghiệm du lịch', title: 'Bài test', slug: 'bai-test',
        excerpt: 'Mô tả ngắn', imageUrl: '/images/x.png', author: 'Tác giả', publishedAt: '2026-06-15T00:00:00+07:00',
      }]);
    });

    it('trả mảng rỗng khi lỗi (không throw)', async () => {
      createApiClientMock.mockReturnValue(supabaseMock);
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { message: 'boom' } }));

      const result = await listPostsPublic();

      expect(result).toEqual([]);
    });
  });

  describe('getPostBySlugPublic', () => {
    it('trả chi tiết đầy đủ kèm content khi tìm thấy', async () => {
      createApiClientMock.mockReturnValue(supabaseMock);
      fromMock.mockReturnValue(createQueryBuilderMock({ data: ROW, error: null }));

      const result = await getPostBySlugPublic('bai-test');

      expect(result).toMatchObject({ slug: 'bai-test', content: '<p>Nội dung</p>', categoryName: 'Kinh nghiệm du lịch' });
    });

    it('trả null khi không tìm thấy', async () => {
      createApiClientMock.mockReturnValue(supabaseMock);
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await getPostBySlugPublic('khong-ton-tai');

      expect(result).toBeNull();
    });
  });

  describe('listPostsAdmin', () => {
    it('phân trang 0-indexed, trả field number', async () => {
      const query = createQueryBuilderMock({ data: [ROW], count: 1, error: null });
      fromMock.mockReturnValue(query);

      const result = await listPostsAdmin(supabaseMock, { page: 0, size: 20 });

      expect(query.range).toHaveBeenCalledWith(0, 19);
      expect(result.data.number).toBe(0);
      expect(result.data.content[0].slug).toBe('bai-test');
    });
  });

  describe('getPostAdminById', () => {
    it('trả chi tiết khi tìm thấy', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: ROW, error: null }));

      const result = await getPostAdminById(supabaseMock, 1);

      expect(result.data.title).toBe('Bài test');
    });

    it('trả {data: null, error: null} khi không tìm thấy', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await getPostAdminById(supabaseMock, 999);

      expect(result).toEqual({ data: null, error: null });
    });
  });

  describe('createPostAdmin', () => {
    it('tạo bài thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: ROW, error: null }));

      const result = await createPostAdmin(supabaseMock, {
        categoryId: 2, title: 'Bài test', slug: 'bai-test', excerpt: 'Mô tả ngắn',
        content: '<p>Nội dung</p>', imageUrl: '/images/x.png', author: 'Tác giả', status: 'published',
      });

      expect(result.data.slug).toBe('bai-test');
    });

    it('trả error khi slug trùng', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { code: '23505' } }));

      const result = await createPostAdmin(supabaseMock, {
        categoryId: 2, title: 'X', slug: 'bai-test', excerpt: 'x', content: 'x', author: 'x', status: 'draft',
      });

      expect(result.data).toBeNull();
      expect(result.error.code).toBe('23505');
    });
  });

  describe('updatePostAdmin', () => {
    it('sửa bài thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: { ...ROW, title: 'Đổi tên' }, error: null }));

      const result = await updatePostAdmin(supabaseMock, 1, {
        categoryId: 2, title: 'Đổi tên', slug: 'bai-test', excerpt: 'x', content: 'x', author: 'x', status: 'published',
      });

      expect(result.data.title).toBe('Đổi tên');
    });

    it('set published_at khi bài chuyển từ draft sang published lần đầu', async () => {
      const fetchBuilder = createQueryBuilderMock({ data: { status: 'draft', published_at: null }, error: null });
      const updateBuilder = createQueryBuilderMock({ data: { ...ROW, status: 'published' }, error: null });
      fromMock.mockReturnValueOnce(fetchBuilder).mockReturnValueOnce(updateBuilder);

      await updatePostAdmin(supabaseMock, 1, {
        categoryId: 2, title: 'Bài test', slug: 'bai-test', excerpt: 'x', content: 'x', author: 'x', status: 'published',
      });

      expect(updateBuilder.update).toHaveBeenCalledTimes(1);
      const updateArg = updateBuilder.update.mock.calls[0][0];
      expect(updateArg).toHaveProperty('published_at');
      expect(updateArg.published_at).not.toBeNull();
    });

    it('không ghi đè published_at khi bài đã published từ trước', async () => {
      const fetchBuilder = createQueryBuilderMock({ data: { status: 'published', published_at: '2026-06-01T00:00:00Z' }, error: null });
      const updateBuilder = createQueryBuilderMock({ data: { ...ROW }, error: null });
      fromMock.mockReturnValueOnce(fetchBuilder).mockReturnValueOnce(updateBuilder);

      await updatePostAdmin(supabaseMock, 1, {
        categoryId: 2, title: 'Cập nhật nội dung', slug: 'bai-test', excerpt: 'x', content: 'x', author: 'x', status: 'published',
      });

      expect(updateBuilder.update).toHaveBeenCalledTimes(1);
      const updateArg = updateBuilder.update.mock.calls[0][0];
      expect(updateArg).not.toHaveProperty('published_at');
    });
  });

  describe('deletePostAdmin', () => {
    it('trả {deleted: true} khi xoá thành công', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [{ id: 1 }], error: null }));

      const result = await deletePostAdmin(supabaseMock, 1);

      expect(result).toEqual({ deleted: true, error: null });
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getPostBySlugPublicMock = vi.fn();

vi.mock('../../../../../../lib/blogPosts', () => ({
  getPostBySlugPublic: (...args) => getPostBySlugPublicMock(...args),
}));

import { GET } from '../route';

describe('GET /api/blog/posts/[slug]', () => {
  beforeEach(() => {
    getPostBySlugPublicMock.mockReset();
  });

  it('trả chi tiết khi tìm thấy', async () => {
    getPostBySlugPublicMock.mockResolvedValue({ id: 1, slug: 'bai-test', content: '<p>x</p>' });

    const response = await GET({}, { params: Promise.resolve({ slug: 'bai-test' }) });
    const body = await response.json();

    expect(body.slug).toBe('bai-test');
  });

  it('trả 404 khi không tìm thấy', async () => {
    getPostBySlugPublicMock.mockResolvedValue(null);

    const response = await GET({}, { params: Promise.resolve({ slug: 'khong-ton-tai' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy bài viết.' });
  });
});

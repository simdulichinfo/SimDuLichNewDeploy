import { describe, it, expect, vi, beforeEach } from 'vitest';

const listPostsPublicMock = vi.fn();

vi.mock('../../../../../lib/blogPosts', () => ({
  listPostsPublic: (...args) => listPostsPublicMock(...args),
}));

import { GET } from '../route';

describe('GET /api/blog/posts', () => {
  beforeEach(() => {
    listPostsPublicMock.mockReset();
  });

  it('trả mảng bài viết', async () => {
    listPostsPublicMock.mockResolvedValue([{ id: 1, title: 'Bài test', slug: 'bai-test' }]);

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual([{ id: 1, title: 'Bài test', slug: 'bai-test' }]);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const getPostAdminByIdMock = vi.fn();
const updatePostAdminMock = vi.fn();
const deletePostAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/blogPosts', () => ({
  getPostAdminById: (...args) => getPostAdminByIdMock(...args),
  updatePostAdmin: (...args) => updatePostAdminMock(...args),
  deletePostAdmin: (...args) => deletePostAdminMock(...args),
}));

import { GET, PUT, DELETE } from '../route';

function makeGetRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}
function makePutRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('GET /api/blog/admin/posts/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    getPostAdminByIdMock.mockReset();
  });

  it('trả chi tiết khi tìm thấy', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    getPostAdminByIdMock.mockResolvedValue({ data: { id: 1, slug: 'bai-test' }, error: null });

    const response = await GET(makeGetRequest(), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(body.slug).toBe('bai-test');
  });

  it('trả 404 khi không tìm thấy', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    getPostAdminByIdMock.mockResolvedValue({ data: null, error: null });

    const response = await GET(makeGetRequest(), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });
});

describe('PUT /api/blog/admin/posts/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    updatePostAdminMock.mockReset();
  });

  it('sửa thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updatePostAdminMock.mockResolvedValue({ data: { id: 1, title: 'Đổi tên' }, error: null });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'Đổi tên', slug: 'bai-test', excerpt: 'x', content: 'x', author: 'A', status: 'published',
    }), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(body.title).toBe('Đổi tên');
  });

  it('trả 404 khi không tìm thấy', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    updatePostAdminMock.mockResolvedValue({ data: null, error: null });

    const response = await PUT(makePutRequest({
      categoryId: 1, title: 'X', slug: 'x', excerpt: 'x', content: 'x', author: 'A', status: 'draft',
    }), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/blog/admin/posts/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    deletePostAdminMock.mockReset();
  });

  it('xoá thành công, trả 204', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deletePostAdminMock.mockResolvedValue({ deleted: true, error: null });

    const response = await DELETE(makeGetRequest(), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(204);
  });

  it('trả 404 khi không tìm thấy', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    deletePostAdminMock.mockResolvedValue({ deleted: false, error: null });

    const response = await DELETE(makeGetRequest(), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });
});

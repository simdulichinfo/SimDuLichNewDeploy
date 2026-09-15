import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listCategoriesAdminMock = vi.fn();
const createCategoryAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/blogCategories', () => ({
  listCategoriesAdmin: (...args) => listCategoriesAdminMock(...args),
  createCategoryAdmin: (...args) => createCategoryAdminMock(...args),
}));

import { GET, POST } from '../route';

function makeGetRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}
function makePostRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('GET /api/blog/admin/categories', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listCategoriesAdminMock.mockReset();
    createCategoryAdminMock.mockReset();
  });

  it('trả danh sách khi caller là admin', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listCategoriesAdminMock.mockResolvedValue({ data: [{ id: 1, name: 'A', slug: 'a' }], error: null });

    const response = await GET(makeGetRequest());
    const body = await response.json();

    expect(body).toEqual([{ id: 1, name: 'A', slug: 'a' }]);
  });

  it('trả 403 khi caller không phải admin/staff', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'customer' }, supabase: {} });

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(403);
  });
});

describe('POST /api/blog/admin/categories', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    createCategoryAdminMock.mockReset();
  });

  it('tạo danh mục thành công, trả 201', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createCategoryAdminMock.mockResolvedValue({ data: { id: 4, name: 'Mới', slug: 'moi' }, error: null });

    const response = await POST(makePostRequest({ name: 'Mới', slug: 'moi' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ id: 4, name: 'Mới', slug: 'moi' });
  });

  it('trả 400 khi thiếu name/slug', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({ name: '' }));

    expect(response.status).toBe(400);
    expect(createCategoryAdminMock).not.toHaveBeenCalled();
  });

  it('trả 400 khi slug trùng', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createCategoryAdminMock.mockResolvedValue({ data: null, error: { code: '23505' } });

    const response = await POST(makePostRequest({ name: 'Mới', slug: 'guides' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' });
  });
});

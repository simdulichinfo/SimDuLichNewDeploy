import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listCategoriesAdminMock = vi.fn();
const createCategoryAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminCatalog', () => ({
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

describe('GET /api/catalog/admin/categories', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listCategoriesAdminMock.mockReset();
  });

  it('trả danh sách category khi caller là admin', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listCategoriesAdminMock.mockResolvedValue({ data: [{ id: 1, name: 'A' }], error: null });

    const response = await GET(makeGetRequest());
    const body = await response.json();

    expect(body).toEqual([{ id: 1, name: 'A' }]);
  });

  it('trả 403 khi caller không phải admin/staff', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'customer' }, supabase: {} });

    const response = await GET(makeGetRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
  });

  it('trả 500 khi listCategoriesAdmin lỗi', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listCategoriesAdminMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(500);
  });
});

describe('POST /api/catalog/admin/categories', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    createCategoryAdminMock.mockReset();
  });

  it('tạo category thành công, trả 201', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createCategoryAdminMock.mockResolvedValue({
      data: { id: 9, name: 'Lào', slug: 'lao', imageUrl: null, status: 'active', coveredCountries: [] },
      error: null,
    });

    const response = await POST(makePostRequest({ name: 'Lào', slug: 'lao', status: 'active' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.slug).toBe('lao');
  });

  it('trả 400 khi slug đã tồn tại', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    createCategoryAdminMock.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });

    const response = await POST(makePostRequest({ name: 'Lào', slug: 'lao', status: 'active' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' });
  });

  it('trả 400 khi thiếu field bắt buộc', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });

    const response = await POST(makePostRequest({ name: '', slug: 'lao', status: 'active' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc (name/slug/status).' });
    expect(createCategoryAdminMock).not.toHaveBeenCalled();
  });
});

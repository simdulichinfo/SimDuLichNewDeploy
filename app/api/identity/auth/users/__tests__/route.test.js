import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const authenticateMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/identity/auth/users', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
  });

  it('trả { content, number, totalElements, totalPages } khi caller là admin', async () => {
    const fromMock = vi.fn(() => createQueryBuilderMock({
      data: [{ id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active' }],
      count: 21,
      error: null,
    }));
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: { from: fromMock } });

    const response = await GET(makeRequest('http://localhost:3000/api/identity/auth/users?page=0&size=20'));
    const body = await response.json();

    expect(body.number).toBe(0);
    expect(body.totalElements).toBe(21);
    expect(body.totalPages).toBe(2);
    expect(body.content).toEqual([{ id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active' }]);
  });

  it('trả 403 khi caller không phải admin/staff', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'customer' }, supabase: {} });

    const response = await GET(makeRequest('http://localhost:3000/api/identity/auth/users'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
  });

  it('page=abc không hợp lệ: dùng mặc định page=0 thay vì NaN', async () => {
    const fromMock = vi.fn(() => createQueryBuilderMock({
      data: [],
      count: 0,
      error: null,
    }));
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: { from: fromMock } });

    const response = await GET(makeRequest('http://localhost:3000/api/identity/auth/users?page=abc&size=20'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.number).toBe(0);
  });

  it('trả 500 kèm message khi query Supabase lỗi', async () => {
    const fromMock = vi.fn(() => createQueryBuilderMock({
      data: null,
      count: null,
      error: { message: 'infinite recursion detected in policy', code: '42P17' },
    }));
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: { from: fromMock } });

    const response = await GET(makeRequest('http://localhost:3000/api/identity/auth/users'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ message: 'Không tải được danh sách người dùng.' });
  });
});

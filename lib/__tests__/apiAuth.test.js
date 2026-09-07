import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    single: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const getUserMock = vi.fn();
const supabaseMock = { from: fromMock, auth: { getUser: getUserMock } };
const createApiClientMock = vi.fn(() => supabaseMock);

vi.mock('../supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));

import { authenticate, requireRole, authErrorResponse, mapUserResponse, AuthError } from '../apiAuth';

function makeRequest(headers = {}) {
  return { headers: { get: (key) => headers[key.toLowerCase()] ?? null } };
}

describe('lib/apiAuth', () => {
  beforeEach(() => {
    fromMock.mockReset();
    getUserMock.mockReset();
    createApiClientMock.mockClear();
  });

  describe('authenticate', () => {
    it('ném AuthError 401 khi thiếu header Authorization', async () => {
      await expect(authenticate(makeRequest())).rejects.toMatchObject({ status: 401 });
    });

    it('ném AuthError 401 khi token không hợp lệ', async () => {
      getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });

      await expect(authenticate(makeRequest({ authorization: 'Bearer bad-token' })))
        .rejects.toMatchObject({ status: 401 });
    });

    it('trả về user + supabase client được gán token khi xác thực thành công', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@simdulich.vn' } }, error: null });
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: { id: 'u1', name: 'A', phone: '0900000000', email: 'a@simdulich.vn', role: 'customer', status: 'active' },
        error: null,
      }));

      const result = await authenticate(makeRequest({ authorization: 'Bearer good-token' }));

      expect(createApiClientMock).toHaveBeenCalledWith('good-token');
      expect(result.user).toEqual({
        id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active',
      });
      expect(result.supabase).toBe(supabaseMock);
    });
  });

  describe('requireRole', () => {
    it('không ném lỗi khi role khớp', () => {
      expect(() => requireRole({ role: 'admin' }, ['admin', 'staff'])).not.toThrow();
    });

    it('ném AuthError 403 khi role không khớp', () => {
      expect(() => requireRole({ role: 'customer' }, ['admin', 'staff'])).toThrow(AuthError);
    });
  });

  describe('authErrorResponse', () => {
    it('trả NextResponse với status và message từ AuthError', async () => {
      const response = authErrorResponse(new AuthError('Không đủ quyền truy cập.', 403));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({ message: 'Không đủ quyền truy cập.' });
    });

    it('trả 500 với message mặc định khi không phải AuthError', async () => {
      const response = authErrorResponse(new Error('boom'));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.message).toBe('Có lỗi xảy ra, vui lòng thử lại.');
    });
  });

  describe('mapUserResponse', () => {
    it('map đúng field từ profiles row sang UserResponse', () => {
      const result = mapUserResponse({
        id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active', created_at: 'x',
      });

      expect(result).toEqual({
        id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active',
      });
    });
  });
});

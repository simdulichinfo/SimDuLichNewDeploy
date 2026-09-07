import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const refreshSessionMock = vi.fn();
const fromMock = vi.fn();
const createApiClientMock = vi.fn(() => ({ auth: { refreshSession: refreshSessionMock }, from: fromMock }));

vi.mock('../../../../../../lib/supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/identity/auth/refresh', () => {
  beforeEach(() => {
    refreshSessionMock.mockReset();
    fromMock.mockReset();
    createApiClientMock.mockClear();
  });

  it('trả accessToken/refreshToken/user mới khi refresh token hợp lệ', async () => {
    refreshSessionMock.mockResolvedValue({
      data: {
        user: { id: 'u1' },
        session: { access_token: 'access-2', refresh_token: 'refresh-2' },
      },
      error: null,
    });
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: { id: 'u1', name: 'A', phone: '0900000000', email: 'a@simdulich.vn', role: 'customer', status: 'active' },
      error: null,
    }));

    const response = await POST(makeRequest({ refreshToken: 'refresh-1' }));
    const body = await response.json();

    expect(refreshSessionMock).toHaveBeenCalledWith({ refresh_token: 'refresh-1' });
    expect(body.accessToken).toBe('access-2');
    expect(body.user.id).toBe('u1');
  });

  it('trả 401 khi refresh token không hợp lệ', async () => {
    refreshSessionMock.mockResolvedValue({ data: { session: null }, error: { message: 'invalid' } });

    const response = await POST(makeRequest({ refreshToken: 'bad' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: 'Refresh token không hợp lệ hoặc đã hết hạn.' });
  });

  it('trả 500 khi không tìm thấy hồ sơ người dùng sau khi refresh', async () => {
    refreshSessionMock.mockResolvedValue({
      data: {
        user: { id: 'u1' },
        session: { access_token: 'access-2', refresh_token: 'refresh-2' },
      },
      error: null,
    });
    fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { message: 'boom' } }));

    const response = await POST(makeRequest({ refreshToken: 'refresh-1' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ message: 'Không tìm thấy hồ sơ người dùng.' });
  });

  it('trả 400 khi body không phải JSON hợp lệ', async () => {
    const badRequest = { json: () => Promise.reject(new SyntaxError('Unexpected token')) };

    const response = await POST(badRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Dữ liệu gửi lên không hợp lệ.' });
  });
});

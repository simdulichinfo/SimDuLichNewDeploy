import { describe, it, expect, vi, beforeEach } from 'vitest';

const createApiClientMock = vi.fn();

vi.mock('../supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));

import { optionalAuthenticate, AuthError } from '../apiAuth';

function makeRequest(headers = {}) {
  return { headers: { get: (key) => headers[key.toLowerCase()] ?? null } };
}

describe('optionalAuthenticate', () => {
  beforeEach(() => {
    createApiClientMock.mockReset();
  });

  it('trả user null và client ẩn danh khi không có header Authorization', async () => {
    const anonClient = {};
    createApiClientMock.mockReturnValue(anonClient);

    const result = await optionalAuthenticate(makeRequest());

    expect(createApiClientMock).toHaveBeenCalledWith();
    expect(result).toEqual({ user: null, supabase: anonClient });
  });

  it('ném AuthError khi có header Authorization nhưng token không hợp lệ', async () => {
    const scopedClient = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } }) } };
    createApiClientMock.mockReturnValue(scopedClient);

    await expect(optionalAuthenticate(makeRequest({ authorization: 'Bearer bad-token' })))
      .rejects.toBeInstanceOf(AuthError);
  });

  it('trả user thật khi header Authorization có token hợp lệ', async () => {
    const queryBuilder = {
      select: vi.fn(function select() { return this; }),
      eq: vi.fn(function eq() { return this; }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active' },
        error: null,
      }),
    };
    const scopedClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
      from: vi.fn(() => queryBuilder),
    };
    createApiClientMock.mockReturnValue(scopedClient);

    const result = await optionalAuthenticate(makeRequest({ authorization: 'Bearer good-token' }));

    expect(result.user.id).toBe('u1');
    expect(result.supabase).toBe(scopedClient);
  });
});

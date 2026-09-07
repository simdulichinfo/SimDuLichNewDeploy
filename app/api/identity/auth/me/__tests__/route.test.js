import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});

import { GET } from '../route';

describe('GET /api/identity/auth/me', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
  });

  it('trả UserResponse khi token hợp lệ', async () => {
    authenticateMock.mockResolvedValue({
      user: { id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active' },
      supabase: {},
    });

    const response = await GET({ headers: { get: () => 'Bearer good-token' } });
    const body = await response.json();

    expect(body.id).toBe('u1');
  });

  it('trả lỗi 401 khi authenticate ném AuthError', async () => {
    const { AuthError } = await import('../../../../../../lib/apiAuth');
    authenticateMock.mockRejectedValue(new AuthError('Thiếu token xác thực.', 401));

    const response = await GET({ headers: { get: () => null } });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ message: 'Thiếu token xác thực.' });
  });
});

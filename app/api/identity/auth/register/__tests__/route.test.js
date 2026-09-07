import { describe, it, expect, vi, beforeEach } from 'vitest';

const signUpMock = vi.fn();
const supabaseMock = { auth: { signUp: signUpMock } };

vi.mock('../../../../../../lib/supabase/apiClient', () => ({
  createApiClient: vi.fn(() => supabaseMock),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/identity/auth/register', () => {
  beforeEach(() => {
    signUpMock.mockReset();
  });

  it('trả 201 với UserResponse khi đăng ký thành công', async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@simdulich.vn' } },
      error: null,
    });

    const response = await POST(makeRequest({ name: 'A', email: 'a@simdulich.vn', phone: '0900000000', password: 'secret123' }));
    const body = await response.json();

    expect(signUpMock).toHaveBeenCalledWith({
      email: 'a@simdulich.vn',
      password: 'secret123',
      options: { data: { name: 'A', phone: '0900000000' } },
    });
    expect(response.status).toBe(201);
    expect(body).toEqual({ id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active' });
  });

  it('trả lỗi kèm message khi email đã tồn tại', async () => {
    signUpMock.mockResolvedValue({ data: {}, error: { message: 'User already registered', status: 400 } });

    const response = await POST(makeRequest({ name: 'A', email: 'a@simdulich.vn', phone: '', password: 'secret123' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'User already registered' });
  });

  it('trả 400 khi body không phải JSON hợp lệ', async () => {
    const badRequest = { json: () => Promise.reject(new SyntaxError('Unexpected token')) };

    const response = await POST(badRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Dữ liệu gửi lên không hợp lệ.' });
  });
});

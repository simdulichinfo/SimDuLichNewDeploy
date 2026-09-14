import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const toggleUserStatusMock = vi.fn();

vi.mock('../../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../../lib/adminUsers', async () => {
  const actual = await vi.importActual('../../../../../../../../lib/adminUsers');
  return { ...actual, toggleUserStatus: (...args) => toggleUserStatusMock(...args) };
});

import { POST } from '../route';

function makeRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}

describe('POST /api/identity/auth/users/[id]/status', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    toggleUserStatusMock.mockReset();
  });

  it('lật trạng thái thành công, trả 200 với user đã cập nhật', async () => {
    authenticateMock.mockResolvedValue({ user: { id: 'admin1', role: 'admin' }, supabase: {} });
    const updatedUser = { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'banned' };
    toggleUserStatusMock.mockResolvedValue(updatedUser);

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'u2' }) });
    const body = await response.json();

    expect(toggleUserStatusMock).toHaveBeenCalledWith({}, { targetId: 'u2', actingUserId: 'admin1' });
    expect(response.status).toBe(200);
    expect(body).toEqual(updatedUser);
  });

  it('trả 404 khi không tìm thấy user', async () => {
    authenticateMock.mockResolvedValue({ user: { id: 'admin1', role: 'admin' }, supabase: {} });
    toggleUserStatusMock.mockResolvedValue(null);

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'u2' }) });

    expect(response.status).toBe(404);
  });

  it('trả 400 khi tự khoá chính mình', async () => {
    authenticateMock.mockResolvedValue({ user: { id: 'admin1', role: 'admin' }, supabase: {} });
    const { AdminUsersError } = await vi.importActual('../../../../../../../../lib/adminUsers');
    toggleUserStatusMock.mockRejectedValue(new AdminUsersError('Không thể tự khoá tài khoản của chính mình.', 400));

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'admin1' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Không thể tự khoá tài khoản của chính mình.' });
  });

  it('trả 403 khi caller không phải admin/staff, không gọi toggleUserStatus', async () => {
    authenticateMock.mockResolvedValue({ user: { id: 'u3', role: 'customer' }, supabase: {} });

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'u2' }) });

    expect(response.status).toBe(403);
    expect(toggleUserStatusMock).not.toHaveBeenCalled();
  });
});

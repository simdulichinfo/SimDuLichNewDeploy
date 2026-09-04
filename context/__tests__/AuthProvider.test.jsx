import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthProvider';

const getUserMock = vi.fn();
const onAuthStateChangeMock = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));

vi.mock('../../lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: getUserMock,
      onAuthStateChange: onAuthStateChangeMock,
    },
  }),
}));

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthProvider', () => {
  beforeEach(() => {
    getUserMock.mockReset();
    onAuthStateChangeMock.mockClear();
  });

  it('nạp user hiện tại lúc khởi động', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@simdulich.vn' } } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user.email).toBe('a@simdulich.vn');
  });

  it('chưa đăng nhập thì isAuthenticated là false', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });
});

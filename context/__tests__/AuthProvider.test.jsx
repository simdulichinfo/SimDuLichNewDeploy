import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthProvider';

const getUserMock = vi.fn();
const signOutMock = vi.fn();
const onAuthStateChangeMock = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));
const createClientMock = vi.fn(() => ({
  auth: {
    getUser: getUserMock,
    onAuthStateChange: onAuthStateChangeMock,
    signOut: signOutMock,
  },
}));

vi.mock('../../lib/supabase/client', () => ({
  createClient: () => createClientMock(),
}));

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthProvider', () => {
  beforeEach(() => {
    getUserMock.mockReset();
    signOutMock.mockReset();
    onAuthStateChangeMock.mockClear();
    createClientMock.mockClear();
    createClientMock.mockImplementation(() => ({
      auth: {
        getUser: getUserMock,
        onAuthStateChange: onAuthStateChangeMock,
        signOut: signOutMock,
      },
    }));
    pushMock.mockClear();
    refreshMock.mockClear();
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

  it('logout() gọi supabase.auth.signOut() rồi router.refresh()', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@simdulich.vn' } } });
    signOutMock.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.logout();
    });

    expect(signOutMock).toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('supabase chưa được cấu hình (client null) thì user null, loading false ngay, không gọi getUser', async () => {
    createClientMock.mockReturnValue(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(getUserMock).not.toHaveBeenCalled();
    expect(onAuthStateChangeMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Supabase not configured — NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY missing',
    );

    warnSpy.mockRestore();
  });

  it('supabase chưa được cấu hình thì logout() no-op an toàn, không throw', async () => {
    createClientMock.mockReturnValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.logout()).resolves.not.toThrow();
    expect(signOutMock).not.toHaveBeenCalled();
  });
});

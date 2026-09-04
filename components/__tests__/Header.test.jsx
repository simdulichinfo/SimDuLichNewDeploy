import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useAuthMock = vi.fn();
vi.mock('../../context/AuthProvider', () => ({
  useAuth: () => useAuthMock(),
}));

import Header from '../Header';

describe('Header', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: null, isAuthenticated: false, logout: vi.fn() });
  });

  it('hiển thị logo và các link điều hướng chính', () => {
    render(<Header currentPath="/" />);
    expect(screen.getByAltText('SIMDULICH.VN Logo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về chúng tôi' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login');
  });

  it('hiện tên người dùng và nút Đăng xuất khi đã đăng nhập', () => {
    useAuthMock.mockReturnValue({
      user: { email: 'a@simdulich.vn', user_metadata: { name: 'Nguyễn Văn A' } },
      isAuthenticated: true,
      logout: vi.fn(),
    });
    render(<Header currentPath="/" />);
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Đăng nhập' })).not.toBeInTheDocument();
  });
});

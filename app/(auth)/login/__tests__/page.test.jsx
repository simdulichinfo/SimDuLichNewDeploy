import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const signInWithPasswordMock = vi.fn();
vi.mock('../../../../lib/supabase/client', () => ({
  createClient: vi.fn(() => ({ auth: { signInWithPassword: signInWithPasswordMock } })),
}));

import { createClient } from '../../../../lib/supabase/client';
import LoginPage from '../page';

describe('LoginPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
    signInWithPasswordMock.mockReset();
  });

  it('đăng nhập thành công chuyển tới /account', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<LoginPage />);

    await userEvent.type(screen.getByPlaceholderText('Email'), 'a@simdulich.vn');
    await userEvent.type(screen.getByPlaceholderText('Mật khẩu'), 'matkhau123');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    await waitFor(() => expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'a@simdulich.vn',
      password: 'matkhau123',
    }));
    expect(pushMock).toHaveBeenCalledWith('/account');
  });

  it('sai mật khẩu hiển thị lỗi tiếng Việt, không chuyển trang', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<LoginPage />);

    await userEvent.type(screen.getByPlaceholderText('Email'), 'a@simdulich.vn');
    await userEvent.type(screen.getByPlaceholderText('Mật khẩu'), 'sai-mat-khau');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByText('Email hoặc mật khẩu không đúng.')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('createClient trả null (chưa cấu hình Supabase) thì hiện lỗi tiếng Việt, không gọi signInWithPassword', async () => {
    vi.mocked(createClient).mockReturnValueOnce(null);
    render(<LoginPage />);

    await userEvent.type(screen.getByPlaceholderText('Email'), 'a@simdulich.vn');
    await userEvent.type(screen.getByPlaceholderText('Mật khẩu'), 'matkhau123');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByText('Hệ thống chưa được cấu hình. Vui lòng thử lại sau.')).toBeInTheDocument();
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

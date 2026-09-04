import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const signUpMock = vi.fn();
vi.mock('../../../../lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp: signUpMock } }),
}));

import RegisterPage from '../page';

describe('RegisterPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
    signUpMock.mockReset();
  });

  it('đăng ký thành công gọi signUp rồi chuyển tới /account', async () => {
    signUpMock.mockResolvedValue({ error: null });
    render(<RegisterPage />);

    await userEvent.type(screen.getByPlaceholderText('Họ tên'), 'Nguyễn Văn A');
    await userEvent.type(screen.getByPlaceholderText('Email'), 'a@simdulich.vn');
    await userEvent.type(screen.getByPlaceholderText('Mật khẩu'), 'matkhau123');
    await userEvent.type(screen.getByPlaceholderText('Xác nhận mật khẩu'), 'matkhau123');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Đăng ký' }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledWith({
      email: 'a@simdulich.vn',
      password: 'matkhau123',
      options: { data: { name: 'Nguyễn Văn A', phone: '' } },
    }));
    expect(pushMock).toHaveBeenCalledWith('/account');
  });

  it('mật khẩu xác nhận không khớp thì không gọi signUp', async () => {
    render(<RegisterPage />);

    await userEvent.type(screen.getByPlaceholderText('Họ tên'), 'Nguyễn Văn A');
    await userEvent.type(screen.getByPlaceholderText('Email'), 'a@simdulich.vn');
    await userEvent.type(screen.getByPlaceholderText('Mật khẩu'), 'matkhau123');
    await userEvent.type(screen.getByPlaceholderText('Xác nhận mật khẩu'), 'khac123');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Đăng ký' }));

    expect(await screen.findByText('Mật khẩu xác nhận không khớp.')).toBeInTheDocument();
    expect(signUpMock).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Header from '../Header';

describe('Header', () => {
  it('hiển thị logo và các link điều hướng chính', () => {
    render(<Header currentPath="/" />);
    expect(screen.getByAltText('SIMDULICH.VN Logo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về chúng tôi' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login');
  });
});

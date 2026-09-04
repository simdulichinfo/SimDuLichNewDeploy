import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const updateSessionMock = vi.fn();
vi.mock('../lib/supabase/middleware', () => ({
  updateSession: (...args) => updateSessionMock(...args),
}));

import { proxy } from '../proxy';

describe('proxy', () => {
  beforeEach(() => {
    updateSessionMock.mockReset();
  });

  it('chuyển hướng /account về /login khi chưa đăng nhập', async () => {
    const request = new NextRequest('http://localhost:3000/account');
    updateSessionMock.mockResolvedValue({
      supabaseResponse: NextResponse.next({ request }),
      user: null,
    });

    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')).pathname).toBe('/login');
  });

  it('cho qua /account khi đã đăng nhập (trả về supabaseResponse, không redirect)', async () => {
    const request = new NextRequest('http://localhost:3000/account');
    const supabaseResponse = NextResponse.next({ request });
    updateSessionMock.mockResolvedValue({
      supabaseResponse,
      user: { id: 'u1', email: 'a@simdulich.vn' },
    });

    const response = await proxy(request);

    expect(response).toBe(supabaseResponse);
    expect(response.headers.get('location')).toBeNull();
  });

  it('cho qua trang chủ "/" khi chưa đăng nhập (route công khai)', async () => {
    const request = new NextRequest('http://localhost:3000/');
    const supabaseResponse = NextResponse.next({ request });
    updateSessionMock.mockResolvedValue({ supabaseResponse, user: null });

    const response = await proxy(request);

    expect(response).toBe(supabaseResponse);
    expect(response.headers.get('location')).toBeNull();
  });

  it('cho qua "/login" khi chưa đăng nhập (route công khai)', async () => {
    const request = new NextRequest('http://localhost:3000/login');
    const supabaseResponse = NextResponse.next({ request });
    updateSessionMock.mockResolvedValue({ supabaseResponse, user: null });

    const response = await proxy(request);

    expect(response).toBe(supabaseResponse);
    expect(response.headers.get('location')).toBeNull();
  });
});

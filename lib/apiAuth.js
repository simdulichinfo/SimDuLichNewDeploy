import { NextResponse } from 'next/server';
import { createApiClient } from './supabase/apiClient';

export class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function mapUserResponse(profile) {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    role: profile.role,
    status: profile.status,
  };
}

export function authErrorResponse(error) {
  if (error instanceof AuthError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  return NextResponse.json({ message: 'Có lỗi xảy ra, vui lòng thử lại.' }, { status: 500 });
}

export async function authenticate(request) {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) {
    throw new AuthError('Thiếu token xác thực.', 401);
  }
  const token = match[1];

  const supabase = createApiClient(token);
  if (!supabase) {
    throw new AuthError('Máy chủ chưa cấu hình Supabase.', 500);
  }

  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) {
    throw new AuthError('Token không hợp lệ hoặc đã hết hạn.', 401);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, phone, email, role, status')
    .eq('id', userData.user.id)
    .single();

  if (!profile) {
    throw new AuthError('Không tìm thấy hồ sơ người dùng.', 401);
  }

  return { user: mapUserResponse(profile), supabase };
}

export function requireRole(user, roles) {
  if (!roles.includes(user.role)) {
    throw new AuthError('Không đủ quyền truy cập.', 403);
  }
}

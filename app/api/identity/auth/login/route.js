import { NextResponse } from 'next/server';
import { createApiClient } from '../../../../../lib/supabase/apiClient';
import { mapUserResponse } from '../../../../../lib/apiAuth';

export async function POST(request) {
  let email;
  let password;
  try {
    ({ email, password } = await request.json());
  } catch (parseError) {
    return NextResponse.json({ message: 'Dữ liệu gửi lên không hợp lệ.' }, { status: 400 });
  }

  const anonClient = createApiClient();
  if (!anonClient) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return NextResponse.json({ message: 'Email hoặc mật khẩu không đúng.' }, { status: 401 });
  }

  const scopedClient = createApiClient(data.session.access_token);
  const { data: profile, error: profileError } = await scopedClient
    .from('profiles')
    .select('id, name, phone, email, role, status')
    .eq('id', data.user.id)
    .single();

  if (!profile) {
    if (profileError) {
      console.error('[auth/login] profile lookup failed', profileError);
    }
    return NextResponse.json({ message: 'Không tìm thấy hồ sơ người dùng.' }, { status: 500 });
  }

  if (profile.status === 'banned') {
    return NextResponse.json({ message: 'Tài khoản của bạn đã bị khoá.' }, { status: 403 });
  }

  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: mapUserResponse(profile),
  });
}

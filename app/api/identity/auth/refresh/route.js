import { NextResponse } from 'next/server';
import { createApiClient } from '../../../../../lib/supabase/apiClient';
import { mapUserResponse } from '../../../../../lib/apiAuth';

export async function POST(request) {
  const { refreshToken } = await request.json();

  const anonClient = createApiClient();
  if (!anonClient) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const { data, error } = await anonClient.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    return NextResponse.json({ message: 'Refresh token không hợp lệ hoặc đã hết hạn.' }, { status: 401 });
  }

  const scopedClient = createApiClient(data.session.access_token);
  const { data: profile } = await scopedClient
    .from('profiles')
    .select('id, name, phone, email, role, status')
    .eq('id', data.user.id)
    .single();

  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: mapUserResponse(profile),
  });
}

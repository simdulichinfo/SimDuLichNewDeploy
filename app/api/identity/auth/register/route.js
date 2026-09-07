import { NextResponse } from 'next/server';
import { createApiClient } from '../../../../../lib/supabase/apiClient';

export async function POST(request) {
  const { name, email, phone, password } = await request.json();

  const supabase = createApiClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, phone } },
  });

  if (error) {
    return NextResponse.json({ message: error.message }, { status: error.status || 400 });
  }

  return NextResponse.json(
    {
      id: data.user.id,
      name,
      email: data.user.email,
      phone: phone || null,
      role: 'customer',
      status: 'active',
    },
    { status: 201 },
  );
}

import { NextResponse } from 'next/server';
import { createApiClient } from '../../../../../lib/supabase/apiClient';
import { initiatePayment } from '../../../../../lib/payments';

export async function POST(request) {
  const supabase = createApiClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const { orderCode, provider } = await request.json();
  const { data, error } = await initiatePayment(supabase, { orderCode, provider });
  if (error) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  return NextResponse.json(data);
}

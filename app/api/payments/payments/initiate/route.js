import { NextResponse } from 'next/server';
import { createApiClient } from '../../../../../lib/supabase/apiClient';
import { initiatePayment } from '../../../../../lib/payments';
import { OrderError } from '../../../../../lib/orders';

export async function POST(request) {
  const supabase = createApiClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  try {
    const { orderCode, provider } = await request.json();
    const { data, error } = await initiatePayment(supabase, { orderCode, provider });
    if (error) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof OrderError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: 'Có lỗi xảy ra, vui lòng thử lại.' }, { status: 500 });
  }
}

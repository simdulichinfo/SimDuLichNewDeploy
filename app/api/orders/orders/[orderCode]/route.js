import { NextResponse } from 'next/server';
import { createApiClient } from '../../../../../lib/supabase/apiClient';
import { getOrderByCode } from '../../../../../lib/orders';

export async function GET(request, { params }) {
  const { orderCode } = await params;
  const supabase = createApiClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  try {
    const order = await getOrderByCode(supabase, orderCode);
    if (!order) {
      return NextResponse.json({ message: 'Không tìm thấy đơn hàng.' }, { status: 404 });
    }
    return NextResponse.json(order);
  } catch {
    return NextResponse.json({ message: 'Có lỗi xảy ra, vui lòng thử lại.' }, { status: 500 });
  }
}

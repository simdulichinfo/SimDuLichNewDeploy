import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { confirmPaymentAdmin } from '../../../../../../lib/adminPayments';

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin']);

    const { orderCode } = await request.json();
    const { data, error } = await confirmPaymentAdmin(supabase, orderCode);
    if (error) {
      return NextResponse.json({ message: 'Không xác nhận được thanh toán.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ message: 'Không tìm thấy đơn hàng.' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

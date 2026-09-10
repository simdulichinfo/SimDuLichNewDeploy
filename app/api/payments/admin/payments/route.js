import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listPaymentsAdmin } from '../../../../../lib/adminPayments';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { searchParams } = new URL(request.url);
    const { data, error } = await listPaymentsAdmin(supabase, {
      page: searchParams.get('page') != null ? Number(searchParams.get('page')) : undefined,
      size: searchParams.get('size') != null ? Number(searchParams.get('size')) : undefined,
      orderId: searchParams.get('orderId') || undefined,
    });
    if (error) {
      return NextResponse.json({ message: 'Không tải được danh sách giao dịch.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

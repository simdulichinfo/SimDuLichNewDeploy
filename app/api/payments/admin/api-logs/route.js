import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listApiLogsAdmin } from '../../../../../lib/adminPayments';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin']);

    const { searchParams } = new URL(request.url);
    const { data, error } = await listApiLogsAdmin(supabase, {
      page: searchParams.get('page') != null ? Number(searchParams.get('page')) : undefined,
      size: searchParams.get('size') != null ? Number(searchParams.get('size')) : undefined,
      orderId: searchParams.get('orderId') || undefined,
    });
    if (error) {
      return NextResponse.json({ message: 'Không tải được nhật ký API.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

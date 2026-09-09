import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listInventoryAdmin } from '../../../../../lib/adminCatalog';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { searchParams } = new URL(request.url);
    const { data, error } = await listInventoryAdmin(supabase, {
      productId: searchParams.get('productId') || undefined,
      status: searchParams.get('status') || undefined,
    });
    if (error) {
      return NextResponse.json({ message: 'Không tải được kho SIM vật lý.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

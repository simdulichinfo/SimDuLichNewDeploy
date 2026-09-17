import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { importInventoryAdmin } from '../../../../../../lib/adminCatalog';

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin']);

    const { productId, iccids } = await request.json();
    if (!Array.isArray(iccids) || iccids.length === 0) {
      return NextResponse.json({ message: 'Thiếu danh sách ICCID cần nhập.' }, { status: 400 });
    }

    const { data, error } = await importInventoryAdmin(supabase, productId, iccids);
    if (error) {
      if (error.code === '23503') {
        return NextResponse.json({ message: 'productId không tồn tại.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không nhập được ICCID.' }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

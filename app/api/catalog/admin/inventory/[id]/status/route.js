import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../../lib/apiAuth';
import { updateInventoryStatusAdmin } from '../../../../../../../lib/adminCatalog';

export async function PUT(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const { status } = await request.json();
    if (!status) {
      return NextResponse.json({ message: 'Thiếu status.' }, { status: 400 });
    }

    const { data, error } = await updateInventoryStatusAdmin(supabase, id, status);
    if (error) {
      return NextResponse.json({ message: 'Không cập nhật được trạng thái.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ message: 'Không tìm thấy ICCID.' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

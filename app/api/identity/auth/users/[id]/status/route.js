import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../../lib/apiAuth';
import { toggleUserStatus, AdminUsersError } from '../../../../../../../lib/adminUsers';

export async function POST(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin']);
    const { id } = await params;

    const updated = await toggleUserStatus(supabase, { targetId: id, actingUserId: user.id });
    if (!updated) {
      return NextResponse.json({ message: 'Không tìm thấy người dùng.' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AdminUsersError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return authErrorResponse(error);
  }
}

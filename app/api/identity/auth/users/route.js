import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole, mapUserResponse } from '../../../../../lib/apiAuth';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { searchParams } = new URL(request.url);
    const rawPage = Number(searchParams.get('page'));
    const rawSize = Number(searchParams.get('size'));
    const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
    const size = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 20;
    const from = page * size;
    const to = from + size - 1;

    const { data, count, error } = await supabase
      .from('profiles')
      .select('id, name, phone, email, role, status', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json({ message: 'Không tải được danh sách người dùng.' }, { status: 500 });
    }

    const totalElements = count || 0;

    return NextResponse.json({
      content: (data || []).map(mapUserResponse),
      number: page,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

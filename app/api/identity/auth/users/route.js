import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole, mapUserResponse } from '../../../../../lib/apiAuth';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get('page') ?? 0);
    const size = Number(searchParams.get('size') ?? 20);
    const from = page * size;
    const to = from + size - 1;

    const { data, count } = await supabase
      .from('profiles')
      .select('id, name, phone, email, role, status', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

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

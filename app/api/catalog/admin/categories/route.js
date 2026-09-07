import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listCategoriesAdmin, createCategoryAdmin } from '../../../../../lib/adminCatalog';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { data, error } = await listCategoriesAdmin(supabase);
    if (error) {
      return NextResponse.json({ message: 'Không tải được danh sách danh mục.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { name, slug, imageUrl, status } = await request.json();
    if (!name || !slug || !status) {
      return NextResponse.json({ message: 'Thiếu thông tin bắt buộc (name/slug/status).' }, { status: 400 });
    }

    const { data, error } = await createCategoryAdmin(supabase, { name, slug, imageUrl, status });
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không tạo được danh mục.' }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

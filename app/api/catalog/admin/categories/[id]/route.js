import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { updateCategoryAdmin, deleteCategoryAdmin } from '../../../../../../lib/adminCatalog';

export async function PUT(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const { name, slug, imageUrl, status } = await request.json();
    if (!name || !slug || !status) {
      return NextResponse.json({ message: 'Thiếu thông tin bắt buộc (name/slug/status).' }, { status: 400 });
    }

    const { data, error } = await updateCategoryAdmin(supabase, id, { name, slug, imageUrl, status });
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không cập nhật được danh mục.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ message: 'Không tìm thấy danh mục.' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const { deleted, error } = await deleteCategoryAdmin(supabase, id);
    if (error) {
      if (error.code === '23503') {
        return NextResponse.json({ message: 'Không thể xoá — danh mục còn sản phẩm liên kết.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không xoá được danh mục.' }, { status: 500 });
    }
    if (!deleted) {
      return NextResponse.json({ message: 'Không tìm thấy danh mục.' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

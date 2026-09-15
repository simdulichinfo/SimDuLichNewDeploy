import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { getPostAdminById, updatePostAdmin, deletePostAdmin } from '../../../../../../lib/blogPosts';

const REQUIRED_FIELDS = ['categoryId', 'title', 'slug', 'excerpt', 'content', 'author', 'status'];

export async function GET(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const { data, error } = await getPostAdminById(supabase, id);
    if (error) {
      return NextResponse.json({ message: 'Không tải được bài viết.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ message: 'Không tìm thấy bài viết.' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const body = await request.json();
    const missing = REQUIRED_FIELDS.some((field) => !body[field]);
    if (missing) {
      return NextResponse.json({ message: 'Thiếu thông tin bắt buộc.' }, { status: 400 });
    }

    const { data, error } = await updatePostAdmin(supabase, id, body);
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' }, { status: 400 });
      }
      if (error.code === '23503') {
        return NextResponse.json({ message: 'Danh mục không hợp lệ.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không cập nhật được bài viết.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ message: 'Không tìm thấy bài viết.' }, { status: 404 });
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

    const { deleted, error } = await deletePostAdmin(supabase, id);
    if (error) {
      return NextResponse.json({ message: 'Không xoá được bài viết.' }, { status: 500 });
    }
    if (!deleted) {
      return NextResponse.json({ message: 'Không tìm thấy bài viết.' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listPostsAdmin, createPostAdmin } from '../../../../../lib/blogPosts';

const REQUIRED_FIELDS = ['categoryId', 'title', 'slug', 'excerpt', 'content', 'author', 'status'];

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { searchParams } = new URL(request.url);
    const { data, error } = await listPostsAdmin(supabase, {
      page: searchParams.get('page') != null ? Number(searchParams.get('page')) : undefined,
      size: searchParams.get('size') != null ? Number(searchParams.get('size')) : undefined,
    });
    if (error) {
      return NextResponse.json({ message: 'Không tải được danh sách bài viết.' }, { status: 500 });
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

    const body = await request.json();
    const missing = REQUIRED_FIELDS.some((field) => !body[field]);
    if (missing) {
      return NextResponse.json({ message: 'Thiếu thông tin bắt buộc.' }, { status: 400 });
    }

    const { data, error } = await createPostAdmin(supabase, body);
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' }, { status: 400 });
      }
      if (error.code === '23503') {
        return NextResponse.json({ message: 'Danh mục không hợp lệ.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không tạo được bài viết.' }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

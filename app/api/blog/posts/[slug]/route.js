import { NextResponse } from 'next/server';
import { getPostBySlugPublic } from '../../../../../lib/blogPosts';

export async function GET(request, { params }) {
  const { slug } = await params;
  const post = await getPostBySlugPublic(slug);
  if (!post) {
    return NextResponse.json({ message: 'Không tìm thấy bài viết.' }, { status: 404 });
  }
  return NextResponse.json(post);
}

import { NextResponse } from 'next/server';
import { listPostsPublic } from '../../../../lib/blogPosts';

export async function GET() {
  const posts = await listPostsPublic();
  return NextResponse.json(posts);
}

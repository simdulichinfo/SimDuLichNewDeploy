import { NextResponse } from 'next/server';
import { listCategoriesPublic } from '../../../../lib/blogCategories';

export async function GET() {
  const categories = await listCategoriesPublic();
  return NextResponse.json(categories);
}

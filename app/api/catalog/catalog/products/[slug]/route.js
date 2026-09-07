import { NextResponse } from 'next/server';
import { getProductBySlug } from '../../../../../../lib/catalog';

export async function GET(request, { params }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) {
    return NextResponse.json({ message: 'Không tìm thấy sản phẩm.' }, { status: 404 });
  }
  return NextResponse.json(product);
}

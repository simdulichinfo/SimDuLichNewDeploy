import { NextResponse } from 'next/server';
import { getProductById } from '../../../../../../../lib/catalog';

export async function GET(request, { params }) {
  const { id } = await params;
  const product = await getProductById(id);
  if (!product) {
    return NextResponse.json({ message: 'Không tìm thấy sản phẩm.' }, { status: 404 });
  }
  return NextResponse.json(product);
}

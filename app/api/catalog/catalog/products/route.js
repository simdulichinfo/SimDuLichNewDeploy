import { NextResponse } from 'next/server';
import { listAllProducts, listProductsByCategory } from '../../../../../lib/catalog';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const categorySlug = searchParams.get('categorySlug');
  const products = categorySlug ? await listProductsByCategory(categorySlug) : await listAllProducts();
  return NextResponse.json(products);
}

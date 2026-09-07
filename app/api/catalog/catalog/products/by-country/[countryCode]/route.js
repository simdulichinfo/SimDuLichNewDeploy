import { NextResponse } from 'next/server';
import { listProductsByCountry } from '../../../../../../../lib/catalog';

export async function GET(request, { params }) {
  const { countryCode } = await params;
  const products = await listProductsByCountry(countryCode);
  return NextResponse.json(products);
}

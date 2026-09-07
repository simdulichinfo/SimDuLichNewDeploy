import { NextResponse } from 'next/server';
import { getMinPriceByCountry } from '../../../../../lib/catalog';

export async function GET() {
  const result = await getMinPriceByCountry();
  return NextResponse.json(result);
}

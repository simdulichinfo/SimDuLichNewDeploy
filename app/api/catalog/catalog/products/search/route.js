import { NextResponse } from 'next/server';
import { searchProducts } from '../../../../../../lib/catalog';

function parseList(value) {
  return value ? value.split(',').filter(Boolean) : [];
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const result = await searchProducts({
    simType: searchParams.get('simType') || 'esim',
    search: searchParams.get('search') || '',
    countryCodes: parseList(searchParams.get('countryCodes')),
    types: parseList(searchParams.get('types')),
    durations: parseList(searchParams.get('durations')),
    capacities: parseList(searchParams.get('capacities')),
    maxPrice: searchParams.get('maxPrice') != null ? Number(searchParams.get('maxPrice')) : undefined,
    sortBy: searchParams.get('sortBy') || 'default',
    page: searchParams.get('page') != null ? Number(searchParams.get('page')) : undefined,
    size: searchParams.get('size') != null ? Number(searchParams.get('size')) : undefined,
  });

  return NextResponse.json(result);
}

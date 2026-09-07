import { NextResponse } from 'next/server';

const ALLOWED_ORIGINS = ['https://simdulich.vn', 'http://localhost:5173'];

function buildCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function proxy(request) {
  const origin = request.headers.get('origin');
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: isAllowed ? buildCorsHeaders(origin) : {},
    });
  }

  const response = NextResponse.next();
  if (isAllowed) {
    const headers = buildCorsHeaders(origin);
    Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};

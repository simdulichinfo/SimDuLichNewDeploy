import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

describe('proxy (CORS)', () => {
  it('phản hồi preflight OPTIONS với header CORS khi origin được phép', () => {
    const request = new NextRequest('http://localhost:3000/api/identity/auth/login', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173' },
    });

    const response = proxy(request);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('phản hồi preflight OPTIONS không có header CORS khi origin không được phép', () => {
    const request = new NextRequest('http://localhost:3000/api/identity/auth/login', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });

    const response = proxy(request);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('gắn header CORS vào request GET thường khi origin production được phép', () => {
    const request = new NextRequest('http://localhost:3000/api/catalog/catalog/categories', {
      method: 'GET',
      headers: { origin: 'https://simdulich.vn' },
    });

    const response = proxy(request);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://simdulich.vn');
  });

  it('không gắn header CORS khi không có origin (vd gọi trực tiếp server-to-server)', () => {
    const request = new NextRequest('http://localhost:3000/api/catalog/catalog/categories', {
      method: 'GET',
    });

    const response = proxy(request);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

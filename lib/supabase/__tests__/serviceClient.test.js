import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServiceClient } from '../serviceClient';

describe('createServiceClient', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it('trả về null khi thiếu SUPABASE_SERVICE_ROLE_KEY', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(createServiceClient()).toBeNull();
  });

  it('trả về null khi thiếu NEXT_PUBLIC_SUPABASE_URL', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(createServiceClient()).toBeNull();
  });

  it('tạo client thành công khi có đủ biến môi trường', () => {
    const client = createServiceClient();
    expect(client).not.toBeNull();
    expect(client.auth.autoRefreshToken).toBe(false);
  });
});

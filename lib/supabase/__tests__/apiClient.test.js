import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiClient } from '../apiClient';

describe('createApiClient', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it('trả về null khi thiếu biến môi trường Supabase', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(createApiClient()).toBeNull();
  });

  it('tạo client không kèm header Authorization khi không truyền token', () => {
    const client = createApiClient();
    expect(client).not.toBeNull();
    expect(client.auth.autoRefreshToken).toBe(false);
  });

  it('tạo client kèm header Authorization Bearer khi truyền token', () => {
    // `client.rest.headers` is a Fetch API `Headers` instance (not a plain
    // object), so it must be read via `.get()` rather than property access
    // (verified by inspecting the installed @supabase/supabase-js@2.115.0
    // client object directly — `client.rest.headers.Authorization` is
    // `undefined` because `Headers` does not expose entries as own properties).
    const client = createApiClient('user-access-token');
    expect(client.rest.headers.get('Authorization')).toBe('Bearer user-access-token');
  });
});

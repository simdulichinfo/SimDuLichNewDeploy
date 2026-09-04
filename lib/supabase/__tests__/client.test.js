import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(() => ({ mocked: true })),
}));

import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '../client';

describe('lib/supabase/client', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
  });

  it('gọi createBrowserClient với URL và anon key từ env', () => {
    createClient();
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key-test',
    );
  });
});

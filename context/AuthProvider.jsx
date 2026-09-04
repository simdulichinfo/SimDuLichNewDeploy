'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../lib/supabase/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!supabase ? false : true);

  useEffect(() => {
    if (!supabase) {
      console.warn('Supabase not configured — NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
      return;
    }

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const logout = async () => {
    if (!supabase) {
      return;
    }
    await supabase.auth.signOut();
    router.refresh();
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: Boolean(user), loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

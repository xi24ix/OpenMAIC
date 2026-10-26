'use client';

import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { isSupabaseAuthConfigured } from '@/lib/supabase/config';

interface AuthContextValue {
  readonly configured: boolean;
  readonly isAdmin: boolean;
  readonly loading: boolean;
  readonly session: Session | null;
  readonly user: User | null;
  readonly supabase: SupabaseClient | undefined;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseAuthConfigured();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(() => configured && Boolean(supabase));
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const refreshAdminStatus = () => {
    void fetch('/api/admin/status', { credentials: 'include', cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { isAdmin: false }))
      .then((body: { isAdmin?: unknown }) => setIsAdmin(body.isAdmin === true))
      .catch(() => setIsAdmin(false));
  };

  useEffect(() => {
    if (!supabase) return;

    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
      if (data.session) refreshAdminStatus();
      else setIsAdmin(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      if (nextSession) refreshAdminStatus();
      else setIsAdmin(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured,
      isAdmin,
      loading,
      session,
      user: session?.user ?? null,
      supabase,
    }),
    [configured, isAdmin, loading, session, supabase],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

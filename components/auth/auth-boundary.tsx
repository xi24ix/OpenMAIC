'use client';

import { Loader2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { AlostadLogo } from '@/components/brand/alostad-logo';
import { useAuth } from './auth-provider';

export function AuthBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { configured, loading, user } = useAuth();
  const isAuthRoute = pathname === '/auth' || pathname.startsWith('/auth/');

  useEffect(() => {
    if (!configured || loading || isAuthRoute || user) return;
    router.replace('/auth');
  }, [configured, isAuthRoute, loading, router, user]);

  if (!configured || isAuthRoute || user) return <>{children}</>;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6">
      <div
        className="flex flex-col items-center gap-4 text-center text-muted-foreground"
        role="status"
      >
        <AlostadLogo size="gate" />
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
        <span className="text-sm">جارٍ التحقق من جلسة الدخول…</span>
      </div>
    </main>
  );
}

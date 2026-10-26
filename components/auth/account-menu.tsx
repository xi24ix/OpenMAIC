'use client';

import { BarChart3, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '@/lib/hooks/use-i18n';

import { useAuth } from './auth-provider';

export function AccountMenu({ onOpenUsage }: { onOpenUsage?: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const { user, supabase } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!user) return null;

  const email = user.email ?? 'Alostad account';
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${t('auth.account')}: ${email}`}
        className="inline-flex size-8 items-center justify-center rounded-full border border-primary/15 bg-primary/8 text-xs font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <UserRound className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('auth.account')}
          className="absolute end-0 top-full z-50 mt-2 w-64 rounded-xl border border-border/70 bg-background/95 p-2 shadow-xl backdrop-blur"
        >
          <div className="border-b border-border/60 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t('auth.account')}
            </p>
            <p className="mt-1 truncate text-sm font-medium text-foreground" title={email}>
              {email}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => {
              setOpen(false);
              onOpenUsage?.();
            }}
          >
            <BarChart3 className="size-4" aria-hidden="true" />
            Usage
          </button>
          <Link
            href="/admin/library"
            role="menuitem"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => setOpen(false)}
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
            Admin library
          </Link>
          <button
            type="button"
            role="menuitem"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => {
              setOpen(false);
              void supabase?.auth.signOut().then(() => router.replace('/auth'));
            }}
          >
            <LogOut className="size-4" aria-hidden="true" />
            {t('auth.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}

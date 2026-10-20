'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';

export function PdfPagePicker({
  materialId,
  name,
  open,
  onOpenChange,
  onConfirm,
}: {
  materialId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (pages: number[]) => void;
}) {
  const { t } = useI18n();
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/materials/${encodeURIComponent(materialId)}/pages`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ pageCount?: unknown }>;
      })
      .then((body) => {
        if (cancelled) return;
        const count = typeof body.pageCount === 'number' && body.pageCount > 0 ? body.pageCount : 0;
        setPageCount(count);
        setSelected(new Set(Array.from({ length: count }, (_, index) => index + 1)));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [materialId, open]);

  const pages = useMemo(() => [...selected].sort((left, right) => left - right), [selected]);

  const toggle = (page: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  const allSelected = pageCount !== null && selected.size === pageCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(92vw,58rem)] max-w-[min(92vw,58rem)] flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('toolbar.pdfPagesTitle')}</DialogTitle>
          <DialogDescription className="break-words">
            {t('toolbar.pdfPagesDescription', { name })}
          </DialogDescription>
        </DialogHeader>

        {pageCount === null && !error ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>{t('toolbar.pdfPagesLoading')}</span>
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">{t('toolbar.pdfPagesUnavailable')}</p>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              <X className="size-3.5" />
              {t('common.close')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {t('toolbar.pdfPagesSelected', {
                  selected: selected.size,
                  total: pageCount ?? 0,
                })}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    setSelected(
                      new Set(Array.from({ length: pageCount ?? 0 }, (_, index) => index + 1)),
                    )
                  }
                  disabled={allSelected}
                >
                  {t('toolbar.pdfPagesSelectAll')}
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                >
                  {t('toolbar.pdfPagesClear')}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {Array.from({ length: pageCount ?? 0 }, (_, index) => index + 1).map((page) => {
                  const active = selected.has(page);
                  return (
                    <button
                      key={page}
                      type="button"
                      onClick={() => toggle(page)}
                      aria-pressed={active}
                      className={cn(
                        'group relative overflow-hidden rounded-md border bg-background text-start transition-all',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                        active
                          ? 'border-primary ring-2 ring-primary/20'
                          : 'border-border/70 hover:border-primary/40',
                      )}
                    >
                      <span className="block aspect-[3/4] w-full bg-muted/30">
                        <img
                          src={`/api/materials/${encodeURIComponent(materialId)}/pages?page=${page}`}
                          alt={t('toolbar.pdfPageAlt', { page })}
                          loading="lazy"
                          decoding="async"
                          className="size-full object-contain"
                        />
                      </span>
                      <span className="flex items-center justify-between gap-1 border-t border-border/60 px-1.5 py-1">
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {t('toolbar.pdfPageLabel', { page })}
                        </span>
                        <span
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border/80 bg-background',
                          )}
                        >
                          {active && <Check className="size-2.5" />}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onConfirm(pages)} disabled={pages.length === 0}>
            {t('toolbar.pdfPagesConfirm', { count: pages.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

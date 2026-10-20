'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Search, Sparkles } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';

export interface GenerationSkill {
  id: string;
  name: string;
  title?: string;
  description: string;
  hasConstraints?: boolean;
}

let cachedSkills: GenerationSkill[] | null = null;

export function SkillPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly GenerationSkill[];
  onChange: (skills: GenerationSkill[]) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<GenerationSkill[] | null>(cachedSkills);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || cachedSkills) return;
    let cancelled = false;
    fetch('/api/generation/skills')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ skills?: GenerationSkill[] }>;
      })
      .then((body) => {
        const list = Array.isArray(body.skills) ? body.skills : [];
        cachedSkills = list;
        if (!cancelled) setSkills(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selected = useMemo(() => new Set(value.map((skill) => skill.id)), [value]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !skills) return skills ?? [];
    return skills.filter((skill) =>
      [skill.name, skill.title, skill.id, skill.description]
        .filter(Boolean)
        .some((entry) => entry!.toLowerCase().includes(needle)),
    );
  }, [query, skills]);

  const toggle = (skill: GenerationSkill) => {
    onChange(
      selected.has(skill.id) ? value.filter((entry) => entry.id !== skill.id) : [...value, skill],
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setFailed(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'h-8 shrink-0 rounded-lg border border-border/60 px-2.5 inline-flex items-center gap-1.5 text-xs transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
            disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-muted/70 hover:text-foreground',
            value.length > 0 ? 'text-foreground' : 'text-muted-foreground',
          )}
          aria-label={t('toolbar.skillPicker')}
          title={t('toolbar.skillPicker')}
        >
          <Sparkles className="size-3.5" />
          <span>{t('toolbar.skillPicker')}</span>
          {value.length > 0 && (
            <span className="rounded-full bg-primary/12 px-1.5 text-[10px] font-medium tabular-nums text-primary">
              {value.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 overflow-hidden p-0">
        <div className="border-b border-border/60 px-3 py-2">
          <p className="text-xs font-medium">{t('toolbar.skillPickerTitle')}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {t('toolbar.skillPickerHint')}
          </p>
        </div>
        <div className="relative border-b border-border/60">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('toolbar.skillSearchPlaceholder')}
            className="h-8 w-full bg-transparent pl-8 pr-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {skills === null && !failed ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              <span>{t('common.loading')}</span>
            </div>
          ) : failed ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              {t('toolbar.skillLoadFailed')}
            </p>
          ) : visible.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              {t('toolbar.skillNoMatches')}
            </p>
          ) : (
            visible.map((skill) => {
              const active = selected.has(skill.id);
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => toggle(skill)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-start transition-colors',
                    active ? 'bg-primary/8' : 'hover:bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border/80',
                    )}
                  >
                    {active && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate text-xs font-medium">
                        {skill.title ?? skill.name}
                      </span>
                      {skill.title && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {skill.name}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[10px] leading-snug text-muted-foreground">
                      {skill.description}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

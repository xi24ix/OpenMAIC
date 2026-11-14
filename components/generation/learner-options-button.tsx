'use client';

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Check, ChevronDown, Users } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';

/**
 * What the composer's learner popover holds. `teachingStyle` folds the old
 * interactive toggle into one segmented control: classic explains, the other
 * three all imply interactive planning (game and animation additionally bias
 * WHICH widgets the outline plans).
 */
export type LearnerOptions = {
  audience: 'student' | 'parent' | 'teacher';
  supportProfile: 'none' | 'autism' | 'adhd' | 'learning-difficulties';
  teachingStyle: 'classic' | 'interactive' | 'game' | 'animation';
};

export const LEARNER_OPTIONS_STORAGE_KEY = 'learnerOptions';

export const DEFAULT_LEARNER_OPTIONS: LearnerOptions = {
  audience: 'student',
  supportProfile: 'none',
  teachingStyle: 'classic',
};

export function readLearnerOptions(): LearnerOptions {
  try {
    const raw = localStorage.getItem(LEARNER_OPTIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LearnerOptions>;
      return {
        audience: parsed.audience ?? DEFAULT_LEARNER_OPTIONS.audience,
        supportProfile: parsed.supportProfile ?? DEFAULT_LEARNER_OPTIONS.supportProfile,
        teachingStyle: parsed.teachingStyle ?? DEFAULT_LEARNER_OPTIONS.teachingStyle,
      };
    }
  } catch {
    /* ignore malformed state */
  }
  return DEFAULT_LEARNER_OPTIONS;
}

export function writeLearnerOptions(options: LearnerOptions): void {
  try {
    localStorage.setItem(LEARNER_OPTIONS_STORAGE_KEY, JSON.stringify(options));
  } catch {
    /* ignore */
  }
}

type ChipGroupProps<T extends string> = {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
};

function ChipGroup<T extends string>({ label, value, options, onChange }: ChipGroupProps<T>) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground/70">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                active
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-border/70 bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {active && <Check aria-hidden="true" className="size-3" />}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

type LearnerOptionsButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'children'> &
  DataAttributes & {
    value: LearnerOptions;
    onChange: (value: LearnerOptions) => void;
    disabled?: boolean;
  };

/**
 * The composer's learner popover: who the lesson serves, which support needs
 * it adapts to, and which teaching style leads — the same sets the curriculum
 * picker offers, opened up to free-prompt runs. One control instead of a row
 * of toggles, so the composer stays one line.
 */
export const LearnerOptionsButton = forwardRef<HTMLButtonElement, LearnerOptionsButtonProps>(
  function LearnerOptionsButton({ value, onChange, disabled, className, ...buttonProps }, ref) {
    const { t } = useI18n();
    const customized =
      value.audience !== DEFAULT_LEARNER_OPTIONS.audience ||
      value.supportProfile !== DEFAULT_LEARNER_OPTIONS.supportProfile ||
      value.teachingStyle !== DEFAULT_LEARNER_OPTIONS.teachingStyle;
    const summary = (() => {
      if (!customized) return t('composerLearner.trigger');
      const styleLabels: Record<LearnerOptions['teachingStyle'], string> = {
        classic: t('composerLearner.styleClassic'),
        interactive: t('composerLearner.styleInteractive'),
        game: t('composerLearner.styleGame'),
        animation: t('composerLearner.styleAnimation'),
      };
      const supportLabels: Record<LearnerOptions['supportProfile'], string> = {
        none: t('composerLearner.supportGeneral'),
        autism: t('composerLearner.supportAutism'),
        adhd: t('composerLearner.supportAdhd'),
        'learning-difficulties': t('composerLearner.supportLearning'),
      };
      const audienceLabels: Record<LearnerOptions['audience'], string> = {
        student: t('composerLearner.audienceStudent'),
        parent: t('composerLearner.audienceParent'),
        teacher: t('composerLearner.audienceTeacher'),
      };
      return [
        audienceLabels[value.audience],
        value.supportProfile !== 'none' ? supportLabels[value.supportProfile] : null,
        styleLabels[value.teachingStyle],
      ]
        .filter(Boolean)
        .join(' · ');
    })();

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            {...buttonProps}
            ref={ref}
            type="button"
            disabled={disabled}
            className={cn(
              'relative inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 motion-reduce:transition-none motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:outline-violet-300',
              customized
                ? 'border-violet-400 bg-violet-100 text-violet-900 shadow-sm shadow-violet-200/60 dark:border-violet-300 dark:bg-violet-400 dark:text-slate-950 dark:shadow-[0_0_18px_rgba(167,139,250,0.35)]'
                : 'border-violet-600 bg-transparent text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-950/50',
              className,
            )}
          >
            <Users aria-hidden="true" className="size-3.5" />
            <span className="max-w-[220px] truncate">{summary}</span>
            <ChevronDown aria-hidden="true" className="size-3 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={6} className="w-80 space-y-3.5 p-3">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold">{t('composerLearner.title')}</p>
            <p className="text-[10px] leading-tight text-muted-foreground/60">
              {t('composerLearner.supportHint')}
            </p>
          </div>
          <ChipGroup
            label={t('composerLearner.audience')}
            value={value.audience}
            onChange={(audience) => onChange({ ...value, audience })}
            options={[
              { value: 'student', label: t('composerLearner.audienceStudent') },
              { value: 'parent', label: t('composerLearner.audienceParent') },
              { value: 'teacher', label: t('composerLearner.audienceTeacher') },
            ]}
          />
          <ChipGroup
            label={t('composerLearner.support')}
            value={value.supportProfile}
            onChange={(supportProfile) => onChange({ ...value, supportProfile })}
            options={[
              { value: 'none', label: t('composerLearner.supportGeneral') },
              { value: 'autism', label: t('composerLearner.supportAutism') },
              { value: 'adhd', label: t('composerLearner.supportAdhd') },
              {
                value: 'learning-difficulties',
                label: t('composerLearner.supportLearning'),
              },
            ]}
          />
          <ChipGroup
            label={t('composerLearner.style')}
            value={value.teachingStyle}
            onChange={(teachingStyle) => onChange({ ...value, teachingStyle })}
            options={[
              { value: 'classic', label: t('composerLearner.styleClassic') },
              { value: 'interactive', label: t('composerLearner.styleInteractive') },
              { value: 'game', label: t('composerLearner.styleGame') },
              { value: 'animation', label: t('composerLearner.styleAnimation') },
            ]}
          />
        </PopoverContent>
      </Popover>
    );
  },
);

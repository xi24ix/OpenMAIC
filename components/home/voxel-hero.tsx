'use client';

/**
 * The voxel homepage hero: the 3d-final-ver design, laid out in design pixels
 * of the 1672x941 world art and scaled to the viewport (portrait swaps to a
 * flow layout, see app/world3d.css).
 *
 * The glass composer hosts the real composer controls as the design's chips:
 * course materials (round attach), learner options ("الضوابط"), skills
 * ("مساعدة الدرس"), speech (round mic) and the curriculum picker
 * ("رفع الفصل") — passed in as pre-built slots so all generation logic
 * stays in app/page.tsx. The Create button hands back to the same run
 * starter; hovering/typing/clicking it feeds the world scene (portal flare,
 * lantern brightening, spark burst) through the .w3-cta / #w3-prompt hooks.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';

const DESIGN_W = 1672;
const DESIGN_H = 941;

export function VoxelHero({
  requirement,
  onRequirementChange,
  onKeyDown,
  canGenerate,
  preparing,
  onGenerate,
  error,
  materialsCount,
  toolbarSlot,
  learnerSlot,
  skillsSlot,
  speechSlot,
  curriculumSlot,
}: {
  requirement: string;
  onRequirementChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  canGenerate: boolean;
  preparing: boolean;
  onGenerate: () => void;
  error: string | null;
  materialsCount: number;
  toolbarSlot: ReactNode;
  learnerSlot: ReactNode;
  skillsSlot: ReactNode;
  speechSlot: ReactNode;
  curriculumSlot: ReactNode;
}) {
  const { t, locale } = useI18n();
  const uiRef = useRef<HTMLDivElement>(null);

  // fit(): scale the 1672x941 stage to the viewport (portrait uses the flow
  // layout instead, see the media query in world3d.css).
  useEffect(() => {
    const ui = uiRef.current;
    if (!ui) return;
    const portrait = matchMedia('(max-aspect-ratio: 1/1), (max-width: 760px)');
    const fit = () => {
      if (portrait.matches) ui.style.removeProperty('--s');
      else ui.style.setProperty('--s', String(Math.min(innerWidth / DESIGN_W, innerHeight / DESIGN_H)));
    };
    addEventListener('resize', fit);
    fit();
    return () => removeEventListener('resize', fit);
  }, []);

  // Failsafe for throttled webviews: a backgrounded pane can freeze the
  // .w3-rise entrance animations mid-delay, leaving the CTA invisible. By the
  // time this runs (2.6s) the animation is long done on real devices, so this
  // only ever force-completes a frozen one. Infinite loops (the CTA glow)
  // can't be finished and would throw, so each animation is guarded.
  useEffect(() => {
    const timer = setTimeout(() => {
      document.querySelectorAll<HTMLElement>('.w3-rise').forEach((el) => {
        el.getAnimations?.().forEach((a) => {
          try {
            if (a.effect?.getComputedTiming?.().iterations === Infinity) return;
            a.finish();
          } catch {
            /* not finishable — leave it */
          }
        });
      });
    }, 2600);
    return () => clearTimeout(timer);
  }, []);

  const scrollToLibrary = () => {
    document.getElementById('w3-library')?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  // The composer's hint block: the placeholder copy, one line per <p> (intro
  // line first, then the quoted examples — the design's exact rhythm).
  const hintLines = t('upload.requirementPlaceholder').split('\n').filter((line) => line.trim());
  const hasText = requirement.trim().length > 0;

  return (
    <section className="w3-hero" aria-label={t('home.slogan')}>
      {/* the feature icon gradient (the design's #gp) */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id="w3-gp" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#a7b8ff" />
            <stop offset="1" stopColor="#6f4cff" />
          </linearGradient>
        </defs>
      </svg>
      <div className="w3-ui" ref={uiRef}>
        <div className="w3-badge w3-rise" style={{ '--d': '.2s' } as React.CSSProperties}>
          ALOSTAD CLASSROOM <i />
        </div>

        <h1 className="w3-headline w3-rise" style={{ '--d': '.35s' } as React.CSSProperties}>
          <span className="w3-t">{t('home.sloganLine1')}</span>
          <br />
          <span className="w3-t">
            {t('home.sloganLine2')} <span className="w3-hl">{t('home.sloganHighlight')}</span>
          </span>
        </h1>
        {/* the swoosh underlines the highlighted tail — its position is tuned
            to the Arabic headline, so other locales skip it */}
        {locale.toLowerCase().startsWith('ar') && (
          <svg
            className="w3-swoosh w3-rise"
            style={{ '--d': '.55s' } as React.CSSProperties}
            viewBox="0 0 420 36"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="w3-sw" x1="0" x2="1">
                <stop offset="0" stopColor="#df5a30" />
                <stop offset=".6" stopColor="#ec7344" />
                <stop offset="1" stopColor="#ff9a5a" stopOpacity=".05" />
              </linearGradient>
            </defs>
            <path
              d="M2 25 C80 21 180 17 300 16.5 C360 16.5 400 17 418 18 C385 19.5 345 21 300 22.5 C200 26 100 31 8 34 C-2 32 -2 28 2 25Z"
              fill="url(#w3-sw)"
            />
          </svg>
        )}

        <section className="w3-composer w3-rise" style={{ '--d': '.5s' } as React.CSSProperties}>
          <svg className="w3-spark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10 1 L12.4 8.6 L20 11 L12.4 13.4 L10 21 L7.6 13.4 L0 11 L7.6 8.6Z" />
            <path d="M19.5 14 L20.5 17 L23.5 18 L20.5 19 L19.5 22 L18.5 19 L15.5 18 L18.5 17Z" opacity=".85" />
          </svg>
          <div className={cn('w3-field', hasText && 'has-text')}>
            <textarea
              id="w3-prompt"
              aria-label={t('upload.requirementPlaceholder')}
              value={requirement}
              onChange={(e) => onRequirementChange(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="w3-hints" aria-hidden="true">
              {hintLines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
          <div className="w3-row">
            <span className="w3-attach-slot relative inline-flex">
              {materialsCount > 0 && <span className="w3-count">{materialsCount}</span>}
              {toolbarSlot}
            </span>
            <div className="w3-chips">
              <span className="w3-chip-slot">{learnerSlot}</span>
              <span className="w3-chip-slot">{skillsSlot}</span>
              <span className="w3-chip-slot w3-chip-mic">{speechSlot}</span>
              <span className="w3-chip-slot w3-chip-curriculum">{curriculumSlot}</span>
            </div>
          </div>
        </section>

        <button
          type="button"
          className="w3-cta w3-rise"
          style={{ '--d': '.7s' } as React.CSSProperties}
          onClick={onGenerate}
          aria-disabled={!canGenerate || preparing}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
          <span>{preparing ? t('stage.generating') : t('home.cta')}</span>
        </button>

        {error && (
          <div className="w3-error" role="alert">
            {error}
          </div>
        )}

        <div className="w3-features w3-rise" style={{ '--d': '.9s' } as React.CSSProperties}>
          <div className="w3-feat">
            <svg viewBox="0 0 24 24" style={{ strokeWidth: 1.6 }} aria-hidden="true">
              <path
                d="M17.3 5H6.7a4 4 0 0 0-3.9 3.2l-.7 4.6a3.2 3.2 0 0 0 5.7 2.3l1-1.4h6.4l1 1.4a3.2 3.2 0 0 0 5.7-2.3l-.7-4.6A4 4 0 0 0 17.3 5z"
                fill="url(#w3-gp)"
                stroke="#c4cdff"
              />
              <path d="M6 11.5h4M8 9.5v4" stroke="#17124f" strokeWidth="2" />
              <circle cx="15.5" cy="11" r="1.1" fill="#17124f" stroke="none" />
              <circle cx="18" cy="13.2" r="1.1" fill="#17124f" stroke="none" />
            </svg>
            <span className="l">{t('home.featureInteractive')}</span>
          </div>
          <div className="w3-feat">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="13" r="8" />
              <circle cx="11" cy="13" r="4.5" />
              <circle cx="11" cy="13" r="1.2" />
              <path d="M11 13l8-8M17 3v4h4" />
            </svg>
            <span className="l">{t('home.featureCustom')}</span>
          </div>
          <div className="w3-feat">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
              <rect x="9.5" y="9.5" width="5" height="5" rx=".6" />
              <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
            </svg>
            <span className="l">{t('home.featureAI')}</span>
          </div>
          <div className="w3-feat">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polygon points="12 2.5 15.1 8.8 22 9.8 17 14.7 18.2 21.5 12 18.3 5.8 21.5 7 14.7 2 9.8 8.9 8.8" />
            </svg>
            <span className="l">{t('home.featureFun')}</span>
          </div>
        </div>

        <button
          type="button"
          className="w3-scroll w3-rise"
          style={{ '--d': '1.1s' } as React.CSSProperties}
          onClick={scrollToLibrary}
          aria-label={t('classroom.recentClassrooms')}
        >
          <div className="w3-mouse" />
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
    </section>
  );
}

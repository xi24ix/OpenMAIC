'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpen, Cpu, MousePointer2, PieChart } from 'lucide-react';
import { SlideThumbnail } from '@/components/slide-renderer/SlideThumbnail';
import { useCanvasStore } from '@/lib/store';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import type { Scene, SlideContent } from '@/lib/types/stage';

interface MobileSceneReelsProps {
  readonly scenes: Scene[];
  readonly currentSceneId: string | null;
  readonly onSelect: (sceneId: string) => void;
}

const TYPE_ICON = {
  slide: BookOpen,
  quiz: PieChart,
  interactive: MousePointer2,
  pbl: Cpu,
} as const;

/**
 * Mobile scene reels — the phone replacement for the desktop plan rail and
 * canvas. One full-height card per scene, snap-scrolled, with the real slide
 * thumbnail. Selecting a card drives the same gated scene switch as the rail.
 */
export function MobileSceneReels({ scenes, currentSceneId, onSelect }: MobileSceneReelsProps) {
  const { t } = useI18n();
  const viewportSize = useCanvasStore.use.viewportSize();
  const viewportRatio = useCanvasStore.use.viewportRatio();
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!currentSceneId) return;
    itemRefs.current.get(currentSceneId)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [currentSceneId]);

  return (
    <div ref={scrollRef} className="aurora-reels" aria-label={t('classroom.slides')}>
      {scenes.map((scene, index) => (
        <ReelCard
          key={scene.id}
          scene={scene}
          index={index}
          total={scenes.length}
          active={scene.id === currentSceneId}
          viewportSize={viewportSize}
          viewportRatio={viewportRatio}
          onSelect={onSelect}
          itemRef={(node) => {
            if (node) itemRefs.current.set(scene.id, node);
            else itemRefs.current.delete(scene.id);
          }}
        />
      ))}
    </div>
  );
}

function ReelCard({
  scene,
  index,
  total,
  active,
  viewportSize,
  viewportRatio,
  onSelect,
  itemRef,
}: {
  readonly scene: Scene;
  readonly index: number;
  readonly total: number;
  readonly active: boolean;
  readonly viewportSize: number;
  readonly viewportRatio: number;
  readonly onSelect: (sceneId: string) => void;
  readonly itemRef: (node: HTMLElement | null) => void;
}) {
  const { t } = useI18n();
  const slide = scene.type === 'slide' ? (scene.content as SlideContent).canvas : null;
  const Icon = TYPE_ICON[scene.type] ?? BookOpen;
  const [width, setWidth] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <article
      ref={itemRef}
      aria-current={active ? 'true' : undefined}
      className={cn('aurora-reel', active && 'is-active')}
      onClick={() => onSelect(scene.id)}
    >
      <div className="aurora-reel-bars" aria-hidden>
        {Array.from({ length: Math.min(total, 9) }).map((_, i) => (
          <i key={i} className={i <= index ? 'on' : undefined} />
        ))}
      </div>
      <div className="aurora-reel-head">
        <span className="aurora-reel-count">
          {index + 1} <em>/</em> {total}
        </span>
        <span className="aurora-reel-type">
          <Icon className="size-3" />
          {t(`edit.sceneType.${scene.type}`)}
        </span>
        {active && <span className="aurora-reel-live">{t('stage.currentScene')}</span>}
      </div>

      <div ref={boxRef} className="aurora-reel-slide">
        {slide && width > 0 ? (
          <SlideThumbnail
            slide={slide}
            size={width}
            viewportSize={viewportSize}
            viewportRatio={viewportRatio}
          />
        ) : (
          <div className={cn('aurora-reel-placeholder', `is-${scene.type}`)}>
            <Icon className="size-9" />
          </div>
        )}
      </div>

      <h2 className="aurora-reel-title">{scene.title}</h2>
    </article>
  );
}

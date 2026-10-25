// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CurriculumLessonPicker } from '@/components/curriculum/curriculum-lesson-picker';
import type { CurriculumGenerationPreparation } from '@/lib/server/curriculum-kb';

const translations: Record<string, string> = {
  'curriculum.openPicker': 'Build from curriculum',
  'curriculum.title': 'Choose a curriculum lesson',
  'curriculum.description': 'Choose a focused lesson',
  'curriculum.loading': 'Loading curriculum...',
  'curriculum.gradeLabel': 'Choose your grade',
  'curriculum.gradeHint': 'Start with a grade',
  'curriculum.gradeShort': 'High school',
  'curriculum.trackLabel': 'Choose a track',
  'curriculum.trackHint': 'Choose a track',
  'curriculum.subjectLabel': 'Choose a subject',
  'curriculum.chooseSubjectHint': 'Choose a subject',
  'curriculum.chooseSubject': 'Open books',
  'curriculum.chooseTrack': 'Show subjects',
  'curriculum.termLabel': 'Choose a term',
  'curriculum.termHint': 'Choose a term',
  'curriculum.termDescription': 'Books and units',
  'curriculum.bookLabel': 'Choose a book',
  'curriculum.bookHint': 'Choose a book',
  'curriculum.unitLabel': 'Choose a unit',
  'curriculum.unitHint': 'Choose a unit',
  'curriculum.unitReady': 'This unit is ready',
  'curriculum.audienceLabel': 'Who is this lesson for?',
  'curriculum.audiences.student': 'Student',
  'curriculum.audiences.parent': 'Parent',
  'curriculum.audiences.teacher': 'Teacher',
  'curriculum.audienceDescriptions.student': 'Learner-facing',
  'curriculum.audienceDescriptions.parent': 'Parent support',
  'curriculum.audienceDescriptions.teacher': 'Classroom evidence',
  'curriculum.supportLabel': 'Learning support needs',
  'curriculum.supportHint': 'Support changes the teaching approach',
  'curriculum.supportProfiles.none': 'General support',
  'curriculum.supportProfiles.autism': 'Autism-informed support',
  'curriculum.supportProfiles.adhd': 'Attention support',
  'curriculum.supportProfiles.learning-difficulties': 'Learning-difficulty support',
  'curriculum.supportDescriptions.none': 'Universal design',
  'curriculum.supportDescriptions.autism': 'Predictable steps',
  'curriculum.supportDescriptions.adhd': 'Short cycles',
  'curriculum.supportDescriptions.learning-difficulties': 'Guided practice',
  'curriculum.optional': 'Optional',
  'curriculum.motionLabel': 'Animated lesson',
  'curriculum.motionHint': 'Keep the animated classroom pipeline',
  'curriculum.qualityHint': 'Use source evidence',
  'curriculum.generate': 'Generate lesson',
  'curriculum.preparing': 'Preparing lesson...',
  'curriculum.sceneLimitHint': 'Up to 3 scenes',
  'curriculum.progressLabel': 'Lesson selection progress',
  'curriculum.stepHint': 'Choose the path',
  'curriculum.back': 'Back',
  'curriculum.checkingSource': 'Checking the selected unit...',
  'curriculum.sourceReady': 'Curriculum source is ready',
  'curriculum.sourcePartial': 'Curriculum source is partial',
  'curriculum.sourceWarning': 'The lesson will stay within the retrieved textbook evidence.',
};

const translate = (key: string, options?: Record<string, unknown>) => {
  if (key === 'curriculum.term') return `Term ${String(options?.term ?? '')}`;
  if (key === 'curriculum.lessonCount') return `${String(options?.count ?? '')} lessons`;
  if (key === 'curriculum.unitCount') return `${String(options?.count ?? '')} units`;
  return translations[key] ?? key;
};

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({ locale: 'en-US', t: translate }),
}));

vi.mock('motion/react', async () => {
  const React = await import('react');
  function MotionDiv({
    children,
    initial: _initial,
    animate: _animate,
    exit: _exit,
    transition: _transition,
    ...props
  }: React.ComponentProps<'div'> & {
    initial?: unknown;
    animate?: unknown;
    exit?: unknown;
    transition?: unknown;
  }) {
    return React.createElement('div', props, children);
  }
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: { div: MotionDiv },
  };
});

vi.mock('@/components/ui/dialog', async () => {
  const React = await import('react');
  const DialogContext = React.createContext({
    open: false,
    onOpenChange: (_open: boolean) => {},
  });

  function Dialog({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: React.ReactNode;
  }) {
    return React.createElement(
      DialogContext.Provider,
      { value: { open: Boolean(open), onOpenChange: onOpenChange ?? (() => undefined) } },
      children,
    );
  }

  function DialogTrigger({
    asChild: _asChild,
    children,
  }: {
    asChild?: boolean;
    children: React.ReactElement;
  }) {
    const context = React.useContext(DialogContext);
    const child = React.Children.only(children);
    const childProps = child.props as { onClick?: (event: React.MouseEvent) => void };
    return React.cloneElement(
      child as React.ReactElement<{ onClick?: (event: React.MouseEvent) => void }>,
      {
        onClick: (event: React.MouseEvent) => {
          childProps.onClick?.(event);
          context.onOpenChange(true);
        },
      },
    );
  }

  function DialogContent({ children, ...props }: React.ComponentProps<'div'>) {
    const context = React.useContext(DialogContext);
    return context.open ? React.createElement('div', props, children) : null;
  }

  const simple = (tag: 'div' | 'h2' | 'p') =>
    function Simple({ children, ...props }: React.ComponentProps<typeof tag>) {
      return React.createElement(tag, props, children);
    };

  return {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogDescription: simple('p'),
    DialogHeader: simple('div'),
    DialogTitle: simple('h2'),
  };
});

const roots: Root[] = [];

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function click(selector: string) {
  const element = document.body.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button ${selector}`);
  return act(async () => element.click());
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('CurriculumLessonPicker', () => {
  it('walks from grade to unit, previews KB warnings, and reuses the prepared lesson', async () => {
    const prepared: CurriculumGenerationPreparation = {
      requirement: 'Generate a grounded lesson',
      course: null,
      unit: { id: 'unit-3', title: 'Unit 3', order: 3 },
      lessons: [],
      warnings: ['Private evaluation mode is enabled'],
      status: 'partial',
      skillIds: ['k12-core-literacy-planning', 'learner-support-autism'],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/curriculum/catalog')) {
        return jsonResponse({
          items: [
            {
              courseId: 'course-11-math',
              country: 'KW',
              curriculum: 'kuwait-public',
              academicYear: '2026/2027',
              grade: 11,
              track: 'general',
              subject: 'mathematics',
              semester: 1,
              edition: 'Ministry curriculum book',
              language: 'ar',
              units: [{ id: 'unit-3', title: 'Unit 3', order: 3, lessons: [] }],
            },
          ],
        });
      }
      return jsonResponse(prepared);
    });
    vi.stubGlobal('fetch', fetchMock);

    const onGenerate = vi.fn(async () => undefined);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(createElement(CurriculumLessonPicker, { onGenerate }));
    });

    await click('[data-testid="curriculum-lesson-launcher"]');
    await settle();
    await click('[data-testid="curriculum-grade-11"]');
    await click('[data-testid="curriculum-subject-mathematics"]');
    await click('[data-testid="curriculum-term-1"]');
    await click('[data-testid="curriculum-course-course-11-math"]');
    await click('[data-testid="curriculum-unit-unit-3"]');
    await settle();

    expect(
      document.body.querySelector('[data-testid="curriculum-source-status"]')?.textContent,
    ).toContain('Private evaluation mode is enabled');
    expect(
      document.body.querySelector('[data-testid="curriculum-generate-button"]'),
    ).not.toHaveProperty('disabled', true);

    await click('[data-testid="curriculum-support-autism"]');
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    await click('[data-testid="curriculum-generate-button"]');
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ supportProfile: 'autism' }),
        prepared,
      }),
    );
  });
});

'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  BookOpen,
  Brain,
  Calculator,
  Check,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  GraduationCap,
  Languages,
  Loader2,
  Microscope,
  Puzzle,
  Sparkles,
  UsersRound,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import type {
  CurriculumCourseSummary,
  CurriculumGenerationRequest,
  CurriculumGenerationPreparation,
  CurriculumUnitSummary,
} from '@/lib/server/curriculum-kb';

type SubjectIcon = typeof Calculator;
type PickerStep = 'grade' | 'track' | 'subject' | 'term' | 'book' | 'unit' | 'lesson' | 'support';

const SUBJECT_META: Record<string, { label: string; ar: string; icon: SubjectIcon }> = {
  arabic: { label: 'Arabic language', ar: 'اللغة العربية', icon: Languages },
  'arabic-grammar': { label: 'Arabic grammar', ar: 'قواعد النحو والصرف', icon: Languages },
  rhetoric: { label: 'Rhetoric', ar: 'فنون البلاغة', icon: Languages },
  mathematics: { label: 'Mathematics', ar: 'الرياضيات', icon: Calculator },
  statistics: { label: 'Statistics', ar: 'الإحصاء', icon: Calculator },
  science: { label: 'Science', ar: 'Science', icon: FlaskConical },
  physics: { label: 'Physics', ar: 'الفيزياء', icon: Microscope },
  chemistry: { label: 'Chemistry', ar: 'الكيمياء', icon: FlaskConical },
  biology: { label: 'Biology', ar: 'الأحياء', icon: Microscope },
  english: { label: 'English', ar: 'اللغة الإنجليزية', icon: Languages },
  french: { label: 'French', ar: 'اللغة الفرنسية', icon: Languages },
  quran: { label: 'Quran', ar: 'القرآن الكريم', icon: BookOpen },
  'islamic-education': { label: 'Islamic education', ar: 'التربية الإسلامية', icon: BookOpen },
  'islamic-history': { label: 'Islamic history', ar: 'التاريخ الإسلامي', icon: BookOpen },
  'information-technology': {
    label: 'Information technology',
    ar: 'تقنية المعلومات',
    icon: Puzzle,
  },
  'kuwait-studies': { label: 'Kuwait studies', ar: 'دولة الكويت', icon: BookMarked },
  geology: { label: 'Earth science', ar: 'علوم الأرض والجيولوجيا', icon: Microscope },
  'geography-economics': {
    label: 'Geography and economics',
    ar: 'الجغرافيا والاقتصاد',
    icon: BookOpen,
  },
  'psychology-sociology': {
    label: 'Psychology and sociology',
    ar: 'علم النفس وعلم الاجتماع',
    icon: UsersRound,
  },
  'constitution-human-rights': {
    label: 'Constitution and human rights',
    ar: 'الدستور وحقوق الإنسان',
    icon: BookOpen,
  },
  'modern-world-history': {
    label: 'Modern world history',
    ar: 'تاريخ العالم الحديث والمعاصر',
    icon: BookOpen,
  },
};

// The importer keeps the source subject ids stable. These aliases make the
// production catalog readable even when the service returns subject-53 rather
// than the friendly slug.
const SUBJECT_ID_META: Record<string, string> = {
  'subject-48': 'arabic',
  'subject-49': 'arabic-grammar',
  'subject-50': 'rhetoric',
  'subject-51': 'chemistry',
  'subject-52': 'physics',
  'subject-53': 'mathematics',
  'subject-54': 'biology',
  'subject-55': 'english',
  'subject-56': 'information-technology',
  'subject-57': 'kuwait-studies',
  'subject-58': 'quran',
  'subject-59': 'islamic-education',
  'subject-65': 'geology',
  'subject-71': 'french',
  'subject-72': 'geography-economics',
  'subject-73': 'psychology-sociology',
  'subject-74': 'islamic-history',
  'subject-77': 'constitution-human-rights',
  'subject-87': 'modern-world-history',
  'subject-91': 'statistics',
  'subject-152': 'biology',
  'subject-199': 'arabic',
  'subject-308': 'statistics',
};

const AUDIENCES: Array<{
  id: CurriculumGenerationRequest['audience'];
  icon: SubjectIcon;
}> = [
  { id: 'student', icon: GraduationCap },
  { id: 'parent', icon: UsersRound },
  { id: 'teacher', icon: BookOpen },
];

const SUPPORT_PROFILES: Array<{
  id: CurriculumGenerationRequest['supportProfile'];
  icon: SubjectIcon;
}> = [
  { id: 'none', icon: Sparkles },
  { id: 'autism', icon: Brain },
  { id: 'adhd', icon: Puzzle },
  { id: 'learning-difficulties', icon: BookOpen },
];

const STEP_ORDER: PickerStep[] = [
  'grade',
  'track',
  'subject',
  'term',
  'book',
  'unit',
  'lesson',
  'support',
];

function canonicalSubject(subject: string): string {
  return SUBJECT_ID_META[subject] ?? subject;
}

function subjectLabel(subject: string, locale: string): string {
  const meta = SUBJECT_META[canonicalSubject(subject)];
  if (meta) return locale.toLowerCase().startsWith('ar') ? meta.ar : meta.label;
  return subject.replace(/^subject-/u, '').replaceAll('-', ' ');
}

function uniqueSubjects(courses: CurriculumCourseSummary[]): string[] {
  return [...new Set(courses.map((course) => course.subject))].sort((a, b) =>
    subjectLabel(a, 'en-US').localeCompare(subjectLabel(b, 'en-US')),
  );
}

function courseEdition(course: CurriculumCourseSummary, locale: string): string {
  const edition = course.edition.trim();
  if (!edition || /^Kuwait MOE student library/i.test(edition)) {
    return locale.toLowerCase().startsWith('ar')
      ? 'كتاب المنهج الوزاري'
      : 'Ministry curriculum book';
  }
  return edition.split(';')[0]?.trim() || edition;
}

function apiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const record = body as { error?: unknown };
  if (typeof record.error === 'string') return record.error;
  if (record.error && typeof record.error === 'object' && 'message' in record.error) {
    const message = (record.error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

function apiWarnings(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const warnings = (body as { warnings?: unknown }).warnings;
  return Array.isArray(warnings)
    ? warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];
}

type PreparationError = Error & { warnings?: string[] };

export function CurriculumLessonPicker({
  disabled = false,
  onGenerate,
}: {
  disabled?: boolean;
  onGenerate: (input: {
    request: CurriculumGenerationRequest;
    prepared: CurriculumGenerationPreparation;
  }) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const isArabic = locale.toLowerCase().startsWith('ar');
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CurriculumCourseSummary[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [step, setStep] = useState<PickerStep>('grade');
  const [grade, setGrade] = useState<number | null>(null);
  const [track, setTrack] = useState<CurriculumCourseSummary['track']>('general');
  const [subject, setSubject] = useState<string | null>(null);
  const [semester, setSemester] = useState<1 | 2>(1);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [audience, setAudience] = useState<CurriculumGenerationRequest['audience']>('student');
  const [supportProfile, setSupportProfile] =
    useState<CurriculumGenerationRequest['supportProfile']>('none');
  const [preparing, setPreparing] = useState(false);
  const [preparingPreview, setPreparingPreview] = useState(false);
  const [preparedPreview, setPreparedPreview] = useState<CurriculumGenerationPreparation | null>(
    null,
  );
  const [preparedPreviewKey, setPreparedPreviewKey] = useState<string | null>(null);
  const [preparationWarnings, setPreparationWarnings] = useState<string[]>([]);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    if (catalog || loadingCatalog) return;
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const response = await fetch('/api/curriculum/catalog', { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.items)) {
        throw new Error(apiErrorMessage(body, t('curriculum.loadFailed')));
      }
      setCatalog(body.items);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : t('curriculum.loadFailed'));
    } finally {
      setLoadingCatalog(false);
    }
  }, [catalog, loadingCatalog, t]);

  useEffect(() => {
    if (open) void loadCatalog();
  }, [loadCatalog, open]);

  const grades = useMemo(
    () => [...new Set((catalog ?? []).map((course) => course.grade))].sort((a, b) => a - b),
    [catalog],
  );
  const gradeCourses = useMemo(
    () => (catalog ?? []).filter((course) => course.grade === grade),
    [catalog, grade],
  );
  const tracks = useMemo(
    () => [...new Set(gradeCourses.map((course) => course.track))],
    [gradeCourses],
  );
  const subjectCourses = useMemo(
    () => gradeCourses.filter((course) => course.track === track),
    [gradeCourses, track],
  );
  const subjects = useMemo(() => uniqueSubjects(subjectCourses), [subjectCourses]);
  const subjectOptions = useMemo(
    () => subjectCourses.filter((course) => course.subject === subject),
    [subject, subjectCourses],
  );
  const semesters = useMemo(
    () => [...new Set(subjectOptions.map((course) => course.semester))].sort(),
    [subjectOptions],
  );
  const books = useMemo(
    () => subjectOptions.filter((course) => course.semester === semester),
    [semester, subjectOptions],
  );
  const selectedCourse = useMemo(
    () =>
      courseId ? ((catalog ?? []).find((course) => course.courseId === courseId) ?? null) : null,
    [catalog, courseId],
  );
  const units = useMemo(() => selectedCourse?.units ?? [], [selectedCourse]);
  const selectedUnit = units.find((unit) => unit.id === unitId) ?? null;
  const selectedLesson = selectedUnit?.lessons.find((lesson) => lesson.id === lessonId) ?? null;
  const preparationRequest = useMemo<CurriculumGenerationRequest | null>(
    () =>
      selectedCourse && selectedUnit
        ? {
            courseId: selectedCourse.courseId,
            unitId: selectedUnit.id,
            ...(selectedLesson ? { lessonId: selectedLesson.id } : {}),
            audience,
            supportProfile,
          }
        : null,
    [audience, selectedCourse, selectedLesson, selectedUnit, supportProfile],
  );
  const preparationKey = useMemo(
    () =>
      preparationRequest
        ? `${preparationRequest.courseId}:${preparationRequest.unitId}:${preparationRequest.lessonId ?? 'unit'}:${preparationRequest.audience}:${preparationRequest.supportProfile}`
        : null,
    [preparationRequest],
  );

  useEffect(() => {
    if (!tracks.includes(track)) setTrack(tracks[0] ?? 'general');
  }, [track, tracks]);

  useEffect(() => {
    if (subject !== null && !subjects.includes(subject)) {
      setSubject(null);
      setCourseId(null);
      setUnitId(null);
      setLessonId(null);
    }
  }, [subject, subjects]);

  useEffect(() => {
    if (!semesters.includes(semester)) setSemester((semesters[0] as 1 | 2) ?? 1);
  }, [semester, semesters]);

  useEffect(() => {
    if (courseId && !books.some((course) => course.courseId === courseId)) {
      setCourseId(null);
      setUnitId(null);
      setLessonId(null);
    }
  }, [books, courseId]);

  useEffect(() => {
    if (unitId && !units.some((unit) => unit.id === unitId)) {
      setUnitId(null);
      setLessonId(null);
    }
    if (lessonId && !selectedUnit?.lessons.some((lesson) => lesson.id === lessonId)) {
      setLessonId(null);
    }
  }, [lessonId, selectedUnit, unitId, units]);

  const loadPreparation = useCallback(
    async (request: CurriculumGenerationRequest): Promise<CurriculumGenerationPreparation> => {
      const response = await fetch('/api/curriculum/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || !('requirement' in body)) {
        const error = new Error(
          apiErrorMessage(body, t('curriculum.prepareFailed')),
        ) as PreparationError;
        error.warnings = apiWarnings(body);
        throw error;
      }
      return body as CurriculumGenerationPreparation;
    },
    [t],
  );

  useEffect(() => {
    if (step !== 'support' || !preparationRequest || !preparationKey) {
      setPreparingPreview((current) => (current ? false : current));
      setPreparedPreview((current) => (current ? null : current));
      setPreparedPreviewKey((current) => (current ? null : current));
      setPreparationWarnings((current) => (current.length > 0 ? [] : current));
      setPreparationError((current) => (current ? null : current));
      return;
    }

    let cancelled = false;
    setPreparingPreview(true);
    setPreparedPreview(null);
    setPreparedPreviewKey(null);
    setPreparationWarnings([]);
    setPreparationError(null);

    void loadPreparation(preparationRequest)
      .then((prepared) => {
        if (cancelled) return;
        setPreparedPreview(prepared);
        setPreparedPreviewKey(preparationKey);
        setPreparationWarnings(prepared.warnings);
      })
      .catch((error: PreparationError) => {
        if (cancelled) return;
        setPreparationError(error.message);
        setPreparationWarnings(error.warnings ?? []);
      })
      .finally(() => {
        if (!cancelled) setPreparingPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadPreparation, preparationKey, preparationRequest, step]);

  const reset = () => {
    setStep('grade');
    setGrade(null);
    setTrack('general');
    setSubject(null);
    setSemester(1);
    setCourseId(null);
    setUnitId(null);
    setLessonId(null);
    setAudience('student');
    setSupportProfile('none');
    setPreparingPreview(false);
    setPreparedPreview(null);
    setPreparedPreviewKey(null);
    setPreparationWarnings([]);
    setPreparationError(null);
    setGenerationError(null);
  };

  const generate = async () => {
    if (!selectedCourse || !selectedUnit || grade === null) return;
    setPreparing(true);
    setGenerationError(null);
    try {
      const request = preparationRequest ?? {
        courseId: selectedCourse.courseId,
        unitId: selectedUnit.id,
        ...(selectedLesson ? { lessonId: selectedLesson.id } : {}),
        audience,
        supportProfile,
      };
      const prepared =
        preparedPreview && preparedPreviewKey === preparationKey
          ? preparedPreview
          : await loadPreparation(request);
      await onGenerate({ request, prepared });
      setOpen(false);
    } catch (error) {
      const preparationFailure = error as PreparationError;
      setGenerationError(error instanceof Error ? error.message : t('curriculum.prepareFailed'));
      if (preparationFailure.warnings?.length) {
        setPreparationWarnings(preparationFailure.warnings);
      }
    } finally {
      setPreparing(false);
    }
  };

  const stepIndex = Math.max(0, STEP_ORDER.indexOf(step));
  const stepLabel = t(`curriculum.steps.${step}`);
  const canGoBack = step !== 'grade';
  const goBack = () => {
    if (step === 'support') setStep('lesson');
    else if (step === 'lesson') setStep('unit');
    else if (step === 'unit') setStep(books.length > 1 ? 'book' : 'term');
    else if (step === 'book') setStep('term');
    else if (step === 'term') setStep('subject');
    else if (step === 'subject') setStep(tracks.length > 1 ? 'track' : 'grade');
    else if (step === 'track') setStep('grade');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadCatalog();
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid="curriculum-lesson-launcher"
          className={cn(
            'mt-3 inline-flex min-h-11 w-full touch-manipulation select-none items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.99] sm:w-auto',
            disabled
              ? 'cursor-not-allowed border-border/50 bg-muted/40 text-muted-foreground/50'
              : 'border-primary/20 bg-primary/8 text-primary hover:-translate-y-0.5 hover:bg-primary/14 hover:shadow-lg hover:shadow-primary/10',
          )}
        >
          <GraduationCap className="size-4" aria-hidden="true" />
          {t('curriculum.openPicker')}
        </button>
      </DialogTrigger>
      <DialogContent
        data-testid="curriculum-lesson-picker"
        className="curriculum-lesson-picker !flex max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[24px] border-primary/10 p-0 sm:max-w-[min(820px,calc(100vw-24px))] sm:rounded-[28px]"
      >
        <DialogHeader className="relative shrink-0 overflow-hidden border-b border-border/60 px-4 pb-4 pt-5 sm:px-7 sm:pb-5 sm:pt-6">
          <div className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-20 size-40 rounded-full bg-orange-400/10 blur-3xl" />
          <div className="relative">
            <DialogTitle className="flex items-center gap-2 pr-10 text-base sm:text-lg">
              <span className="flex size-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <GraduationCap className="size-5" aria-hidden="true" />
              </span>
              {t('curriculum.title')}
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-2xl text-xs leading-relaxed sm:text-sm">
              {t('curriculum.description')}
            </DialogDescription>
            <div
              className="scrollbar-hide -mx-1 mt-5 flex items-center gap-1.5 overflow-x-auto px-1 pb-1"
              aria-label={t('curriculum.progressLabel')}
            >
              {STEP_ORDER.map((item, index) => (
                <StepPill
                  key={item}
                  active={index <= stepIndex}
                  current={item === step}
                  label={t(`curriculum.steps.${item}`)}
                />
              ))}
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 py-4 sm:px-7 sm:py-5">
          {loadingCatalog && catalog === null ? (
            <div
              className="flex min-h-60 items-center justify-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t('curriculum.loading')}
            </div>
          ) : catalogError ? (
            <div
              className="rounded-2xl border border-destructive/20 bg-destructive/6 p-4 text-sm text-destructive"
              role="alert"
            >
              {catalogError}
            </div>
          ) : !(catalog?.length ?? 0) ? (
            <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
              {t('curriculum.empty')}
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, x: isArabic ? 12 : -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: isArabic ? -12 : 12 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="space-y-6"
              >
                {step === 'grade' ? (
                  <SelectionStep
                    title={t('curriculum.gradeLabel')}
                    hint={t('curriculum.gradeHint')}
                  >
                    <div className="grid grid-cols-3 gap-3">
                      {grades.map((value) => (
                        <button
                          key={value}
                          type="button"
                          data-testid={`curriculum-grade-${value}`}
                          aria-pressed={grade === value}
                          onClick={() => {
                            setGrade(value);
                            const nextCourses = (catalog ?? []).filter(
                              (course) => course.grade === value,
                            );
                            const nextTracks = [
                              ...new Set(nextCourses.map((course) => course.track)),
                            ];
                            setTrack(
                              (nextTracks[0] ?? 'general') as CurriculumCourseSummary['track'],
                            );
                            setSubject(null);
                            setCourseId(null);
                            setUnitId(null);
                            setLessonId(null);
                            setStep(nextTracks.length > 1 ? 'track' : 'subject');
                          }}
                          className={cn(
                            'group relative min-h-28 touch-manipulation select-none overflow-hidden rounded-3xl border p-4 text-start transition-all active:scale-[0.99] hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10',
                            grade === value
                              ? 'border-primary bg-primary/8 text-primary shadow-lg shadow-primary/10'
                              : 'border-border/60 bg-background hover:border-primary/30',
                          )}
                        >
                          <span className="absolute -right-3 -top-5 text-7xl font-black text-primary/5 transition-transform group-hover:scale-110">
                            {value}
                          </span>
                          <span className="relative block text-3xl font-black tracking-tight">
                            {value}
                          </span>
                          <span className="relative mt-1 block text-xs text-muted-foreground">
                            {t('curriculum.gradeShort')}
                          </span>
                          <ChevronRight
                            className={cn(
                              'absolute bottom-4 size-4 text-primary/60 transition-transform group-hover:translate-x-1',
                              isArabic ? 'left-4 rotate-180' : 'right-4',
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      ))}
                    </div>
                  </SelectionStep>
                ) : null}

                {step === 'track' ? (
                  <SelectionStep
                    title={t('curriculum.trackLabel')}
                    hint={t('curriculum.trackHint')}
                  >
                    <div className="grid gap-3 sm:grid-cols-3">
                      {tracks.map((value) => (
                        <ChoiceCard
                          key={value}
                          data-testid={`curriculum-track-${value}`}
                          selected={track === value}
                          onClick={() => {
                            setTrack(value);
                            setStep('subject');
                          }}
                          icon={<BookOpen className="size-5" aria-hidden="true" />}
                          title={t(`curriculum.tracks.${value}`)}
                          description={t('curriculum.chooseTrack')}
                        />
                      ))}
                    </div>
                  </SelectionStep>
                ) : null}

                {step === 'subject' ? (
                  <SelectionStep
                    title={t('curriculum.subjectLabel')}
                    hint={t('curriculum.chooseSubjectHint')}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      {subjects.map((value) => {
                        const Icon = SUBJECT_META[canonicalSubject(value)]?.icon ?? BookOpen;
                        return (
                          <ChoiceCard
                            key={value}
                            data-testid={`curriculum-subject-${canonicalSubject(value)}`}
                            selected={subject === value}
                            onClick={() => {
                              setSubject(value);
                              setCourseId(null);
                              setUnitId(null);
                              setLessonId(null);
                              setStep('term');
                            }}
                            icon={<Icon className="size-5" aria-hidden="true" />}
                            title={subjectLabel(value, locale)}
                            description={t('curriculum.chooseSubject')}
                          />
                        );
                      })}
                    </div>
                  </SelectionStep>
                ) : null}

                {step === 'term' ? (
                  <SelectionStep title={t('curriculum.termLabel')} hint={t('curriculum.termHint')}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {semesters.map((value) => (
                        <ChoiceCard
                          key={value}
                          data-testid={`curriculum-term-${value}`}
                          selected={semester === value}
                          onClick={() => {
                            const nextSemester = value as 1 | 2;
                            const nextBooks = subjectOptions.filter(
                              (course) => course.semester === nextSemester,
                            );
                            setSemester(nextSemester);
                            setCourseId(null);
                            setUnitId(null);
                            setLessonId(null);
                            if (nextBooks.length === 1) {
                              setCourseId(nextBooks[0]?.courseId ?? null);
                              setStep('unit');
                            } else {
                              setStep('book');
                            }
                          }}
                          icon={<BookMarked className="size-5" aria-hidden="true" />}
                          title={t('curriculum.term', { term: value })}
                          description={t('curriculum.termDescription')}
                        />
                      ))}
                    </div>
                  </SelectionStep>
                ) : null}

                {step === 'book' ? (
                  <SelectionStep title={t('curriculum.bookLabel')} hint={t('curriculum.bookHint')}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {books.map((course) => (
                        <ChoiceCard
                          key={course.courseId}
                          data-testid={`curriculum-course-${course.courseId}`}
                          selected={courseId === course.courseId}
                          onClick={() => {
                            setCourseId(course.courseId);
                            setUnitId(null);
                            setLessonId(null);
                            setStep('unit');
                          }}
                          icon={<BookMarked className="size-5" aria-hidden="true" />}
                          title={courseEdition(course, locale)}
                          description={`${subjectLabel(course.subject, locale)} · ${t('curriculum.term', { term: course.semester })} · ${t('curriculum.unitCount', { count: course.units.length })}`}
                        />
                      ))}
                    </div>
                  </SelectionStep>
                ) : null}

                {step === 'unit' ? (
                  <SelectionStep title={t('curriculum.unitLabel')} hint={t('curriculum.unitHint')}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {units.map((unit) => (
                        <UnitCard
                          key={unit.id}
                          data-testid={`curriculum-unit-${unit.id}`}
                          unit={unit}
                          selected={unitId === unit.id}
                          onClick={() => {
                            setUnitId(unit.id);
                            setLessonId(null);
                            setStep(unit.lessons.length > 0 ? 'lesson' : 'support');
                          }}
                          locale={locale}
                          t={t}
                        />
                      ))}
                    </div>
                  </SelectionStep>
                ) : null}

                {step === 'lesson' && selectedUnit ? (
                  <SelectionStep
                    title={t('curriculum.lessonLabel')}
                    hint={t('curriculum.lessonHint')}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ChoiceCard
                        data-testid="curriculum-lesson-whole-unit"
                        selected={lessonId === null}
                        onClick={() => {
                          setLessonId(null);
                          setStep('support');
                        }}
                        icon={<BookOpen className="size-5" aria-hidden="true" />}
                        title={t('curriculum.wholeUnit')}
                        description={t('curriculum.wholeUnitDescription')}
                      />
                      {selectedUnit.lessons.map((lesson) => (
                        <ChoiceCard
                          key={lesson.id}
                          data-testid={`curriculum-lesson-${lesson.id}`}
                          selected={lessonId === lesson.id}
                          onClick={() => {
                            setLessonId(lesson.id);
                            setStep('support');
                          }}
                          icon={<BookOpen className="size-5" aria-hidden="true" />}
                          title={lesson.title}
                          description={lesson.objectives[0] ?? t('curriculum.lessonDescription')}
                        />
                      ))}
                    </div>
                  </SelectionStep>
                ) : null}

                {step === 'support' && selectedCourse && selectedUnit ? (
                  <div className="space-y-6">
                    <div className="rounded-3xl border border-primary/15 bg-primary/5 p-4 break-words sm:p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <Sparkles className="size-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold">
                            {selectedLesson?.title ?? selectedUnit.title}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {subjectLabel(selectedCourse.subject, locale)} ·{' '}
                            {t('curriculum.term', { term: selectedCourse.semester })} ·{' '}
                            {selectedLesson
                              ? t('curriculum.selectedLessonReady')
                              : t('curriculum.unitReady', { count: selectedUnit.lessons.length })}
                          </p>
                        </div>
                      </div>
                    </div>
                    {preparingPreview ? (
                      <div
                        className="flex items-center gap-2 rounded-2xl border border-border/60 bg-muted/25 p-3 text-xs text-muted-foreground"
                        data-testid="curriculum-source-status"
                        role="status"
                      >
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        {t('curriculum.checkingSource')}
                      </div>
                    ) : preparationError ? (
                      <div
                        className="rounded-2xl border border-destructive/20 bg-destructive/6 p-3 text-xs break-words text-destructive"
                        data-testid="curriculum-source-status"
                        role="alert"
                      >
                        <p className="font-semibold">{preparationError}</p>
                        {preparationWarnings.length > 0 ? (
                          <WarningList warnings={preparationWarnings} />
                        ) : null}
                      </div>
                    ) : preparedPreview ? (
                      <div
                        className={cn(
                          'rounded-2xl border p-3 text-xs leading-relaxed break-words',
                          preparedPreview.status === 'partial'
                            ? 'border-amber-500/25 bg-amber-500/8 text-amber-900 dark:text-amber-100'
                            : 'border-emerald-500/25 bg-emerald-500/8 text-emerald-900 dark:text-emerald-100',
                        )}
                        data-testid="curriculum-source-status"
                        role="status"
                      >
                        <p className="font-semibold">
                          {preparedPreview.status === 'partial'
                            ? t('curriculum.sourcePartial')
                            : t('curriculum.sourceReady')}
                        </p>
                        {preparationWarnings.length > 0 ? (
                          <WarningList warnings={preparationWarnings} />
                        ) : (
                          <p className="mt-1">{t('curriculum.sourceWarning')}</p>
                        )}
                      </div>
                    ) : null}
                    <section aria-labelledby="curriculum-audience-heading">
                      <SectionHeading
                        id="curriculum-audience-heading"
                        label={t('curriculum.audienceLabel')}
                      />
                      <div className="grid gap-3 sm:grid-cols-3">
                        {AUDIENCES.map(({ id, icon: Icon }) => (
                          <ChoiceCard
                            key={id}
                            data-testid={`curriculum-audience-${id}`}
                            selected={audience === id}
                            onClick={() => setAudience(id)}
                            icon={<Icon className="size-5" aria-hidden="true" />}
                            title={t(`curriculum.audiences.${id}`)}
                            description={t(`curriculum.audienceDescriptions.${id}`)}
                          />
                        ))}
                      </div>
                    </section>
                    <section aria-labelledby="curriculum-support-heading">
                      <div className="flex items-center justify-between gap-3">
                        <SectionHeading
                          id="curriculum-support-heading"
                          label={t('curriculum.supportLabel')}
                        />
                        <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                          {t('curriculum.optional')}
                        </span>
                      </div>
                      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                        {t('curriculum.supportHint')}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {SUPPORT_PROFILES.map(({ id, icon: Icon }) => (
                          <ChoiceCard
                            key={id}
                            data-testid={`curriculum-support-${id}`}
                            selected={supportProfile === id}
                            onClick={() => setSupportProfile(id)}
                            icon={<Icon className="size-5" aria-hidden="true" />}
                            title={t(`curriculum.supportProfiles.${id}`)}
                            description={t(`curriculum.supportDescriptions.${id}`)}
                          />
                        ))}
                      </div>
                    </section>
                    {generationError ? (
                      <p
                        className="rounded-2xl border border-destructive/20 bg-destructive/6 p-3 text-xs break-words text-destructive"
                        role="alert"
                      >
                        {generationError}
                      </p>
                    ) : null}
                    <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/25 p-3 text-xs leading-relaxed text-muted-foreground">
                      <p>
                        <span className="font-semibold text-foreground">
                          {t('curriculum.motionLabel')}:
                        </span>{' '}
                        {t('curriculum.motionHint')}
                      </p>
                      <p>{t('curriculum.qualityHint')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void generate()}
                      disabled={preparing || preparingPreview || !preparedPreview}
                      data-testid="curriculum-generate-button"
                      className="inline-flex min-h-12 w-full touch-manipulation select-none items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all active:scale-[0.99] hover:-translate-y-0.5 hover:opacity-95 disabled:cursor-wait disabled:opacity-60"
                    >
                      {preparing ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Sparkles className="size-4" aria-hidden="true" />
                      )}
                      {preparing ? t('curriculum.preparing') : t('curriculum.generate')}
                    </button>
                    <p className="text-center text-[11px] text-muted-foreground">
                      {t('curriculum.sceneLimitHint')}
                    </p>
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:px-7">
          <span className="min-w-0 max-w-[55%] truncate text-xs text-muted-foreground">
            {stepLabel}
          </span>
          {canGoBack ? (
            <button
              type="button"
              onClick={goBack}
              className="inline-flex min-h-10 touch-manipulation select-none items-center gap-1 rounded-full px-3 text-xs font-semibold text-primary transition-colors active:bg-primary/8 hover:bg-primary/8"
            >
              {isArabic ? (
                <ArrowRight className="size-3.5" aria-hidden="true" />
              ) : (
                <ArrowLeft className="size-3.5" aria-hidden="true" />
              )}
              {t('curriculum.back')}
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground">{t('curriculum.stepHint')}</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SelectionStep({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-4">
        <h3 className="text-lg font-bold tracking-tight">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function StepPill({
  active,
  current,
  label,
}: {
  active: boolean;
  current: boolean;
  label: string;
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-bold transition-colors',
        current
          ? 'border-primary bg-primary text-primary-foreground'
          : active
            ? 'border-primary/20 bg-primary/8 text-primary'
            : 'border-border/60 text-muted-foreground',
      )}
    >
      {label}
    </span>
  );
}

function SectionHeading({ id, label }: { id: string; label: string }) {
  return (
    <h3 id={id} className="text-sm font-bold tracking-tight">
      {label}
    </h3>
  );
}

function WarningList({ warnings }: { warnings: string[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 ps-4">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}

function ChoiceCard({
  'data-testid': testId,
  selected,
  onClick,
  icon,
  title,
  description,
}: {
  'data-testid'?: string;
  selected: boolean;
  onClick: () => void;
  icon?: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'group flex min-h-24 touch-manipulation select-none items-start gap-3 rounded-3xl border p-4 text-start transition-all active:scale-[0.99] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/8',
        selected
          ? 'border-primary bg-primary/8 text-primary shadow-md shadow-primary/10'
          : 'border-border/60 bg-background hover:border-primary/30',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl border transition-transform group-hover:scale-105',
          selected
            ? 'border-primary/25 bg-primary/12'
            : 'border-border/60 bg-muted/40 text-muted-foreground',
        )}
      >
        {selected ? <Check className="size-4" aria-hidden="true" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block break-words text-sm font-bold leading-snug">{title}</span>
        <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

function UnitCard({
  'data-testid': testId,
  unit,
  selected,
  onClick,
  locale,
  t,
}: {
  'data-testid'?: string;
  unit: CurriculumUnitSummary;
  selected: boolean;
  onClick: () => void;
  locale: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const isArabic = locale.toLowerCase().startsWith('ar');
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'group flex min-h-28 touch-manipulation select-none items-start gap-3 rounded-3xl border p-4 text-start transition-all active:scale-[0.99] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/8',
        selected
          ? 'border-primary bg-primary/8 text-primary shadow-md shadow-primary/10'
          : 'border-border/60 bg-background hover:border-primary/30',
      )}
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-2xl text-sm font-black',
          selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {unit.order + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-bold">
          <span className="min-w-0 flex-1 break-words">{unit.title}</span>
          {isArabic ? (
            <ChevronLeft
              className="size-4 shrink-0 text-primary/60 transition-transform group-hover:-translate-x-1"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight
              className="size-4 shrink-0 text-primary/60 transition-transform group-hover:translate-x-1"
              aria-hidden="true"
            />
          )}
        </span>
        <span className="mt-2 block text-[11px] text-muted-foreground">
          {t('curriculum.lessonCount', { count: unit.lessons.length })}
        </span>
      </span>
    </button>
  );
}

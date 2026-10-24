import { z } from 'zod';

export const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/);
export const bboxSchema = z.tuple([
  z.number().min(0).max(1), z.number().min(0).max(1),
  z.number().positive().max(1), z.number().positive().max(1),
]).refine(([x, y, w, h]) => x + w <= 1.000001 && y + h <= 1.000001,
  'Crop must fit within page; use normalized top-left x, y, width, height');
export type BBox = z.infer<typeof bboxSchema>;

export const courseSchema = z.object({
  country: z.literal('KW').default('KW'),
  curriculum: identifier.default('kuwait-public'),
  academicYear: z.string().regex(/^20\d{2}\/20\d{2}$/),
  grade: z.number().int().min(10).max(12),
  track: z.enum(['general', 'scientific', 'literary']),
  subject: identifier,
  semester: z.union([z.literal(1), z.literal(2)]),
  edition: z.string().min(1).max(200),
  language: z.enum(['ar', 'en', 'fr']).default('ar'),
}).strict();
export type Course = z.infer<typeof courseSchema>;

export const resourceKinds = ['student_book', 'workbook', 'teacher_guide', 'summary', 'worksheet', 'exam', 'answer_key'] as const;
export const textStatuses = ['native', 'ocr', 'needs_ocr'] as const;
export type TextStatus = typeof textStatuses[number];
export const visualKinds = ['diagram', 'graph', 'table', 'map', 'illustration', 'equation', 'page'] as const;
export const segmentSchema = z.object({ page: z.number().int().positive(), bbox: bboxSchema.optional() }).strict();
export const visualSchema = z.object({
  id: identifier,
  page: z.number().int().positive(),
  bbox: bboxSchema,
  kind: z.enum(visualKinds).exclude(['page']),
  caption: z.string().min(1).max(2000),
  purpose: z.string().max(2000).default('Use the original textbook visual with its source citation.'),
}).strict();
export const lessonSchema = z.object({
  id: identifier,
  title: z.string().min(1).max(500),
  order: z.number().int().nonnegative(),
  objectives: z.array(z.string().max(2000)).max(100).default([]),
  segments: z.array(segmentSchema).min(1).max(500),
  visuals: z.array(visualSchema).max(200).default([]),
}).strict();

export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  course: courseSchema,
  resource: z.object({
    id: identifier,
    title: z.string().min(1).max(500),
    kind: z.enum(resourceKinds),
    sourceUrl: z.url(),
    downloadUrl: z.url().optional(),
    publicationYear: z.string().max(50).optional(),
    publisher: z.string().max(500).default('Unverified'),
    rightsNote: z.string().max(4000).default('Rights not established; private reference only.'),
    access: z.literal('private_reference').default('private_reference'),
  }).strict(),
  units: z.array(z.object({
    id: identifier, title: z.string().min(1).max(500), order: z.number().int().nonnegative(),
    lessons: z.array(lessonSchema).min(1).max(500),
  }).strict()).min(1).max(100),
  review: z.object({
    curriculumVerified: z.boolean().default(false),
    contentVerified: z.boolean().default(false),
    reviewer: z.string().max(200).optional(),
    evidence: z.string().max(4000).optional(),
  }).strict().default({ curriculumVerified: false, contentVerified: false }),
}).strict().superRefine((m, ctx) => {
  const units = new Set<string>();
  const lessons = new Set<string>();
  const visuals = new Set<string>();
  for (const u of m.units) {
    if (units.has(u.id)) ctx.addIssue({ code: 'custom', message: `Duplicate unit id: ${u.id}` });
    units.add(u.id);
    for (const l of u.lessons) {
      if (lessons.has(l.id)) ctx.addIssue({ code: 'custom', message: `Duplicate lesson id: ${l.id}` });
      lessons.add(l.id);
      for (const v of l.visuals) {
        if (visuals.has(v.id)) ctx.addIssue({ code: 'custom', message: `Duplicate visual id: ${v.id}` });
        visuals.add(v.id);
        if (!l.segments.some(s => s.page === v.page)) ctx.addIssue({ code: 'custom', message: `Visual ${v.id} is outside lesson pages` });
      }
    }
  }
  if ((m.review.curriculumVerified || m.review.contentVerified) && (!m.review.reviewer || !m.review.evidence)) {
    ctx.addIssue({ code: 'custom', message: 'Verified material requires reviewer and evidence' });
  }
});
export type ImportManifest = z.infer<typeof manifestSchema>;

export interface ExtractedPage {
  page: number;
  width: number;
  height: number;
  text: string;
  textStatus: TextStatus;
}
export interface VisualAsset {
  id: string;
  objectKey: string;
  sha256: string;
  mimeType: 'image/png';
  width: number;
  height: number;
  page: number;
  bbox: BBox;
  kind: typeof visualKinds[number];
  caption: string;
  purpose: string;
  lessonIds: string[];
}
export interface ExtractedLesson {
  lessonId: string;
  segments: Array<{ page: number; bbox?: BBox; text: string; textStatus: TextStatus }>;
  visualIds: string[];
}
export interface Extraction {
  versionId: string;
  sourceSha256: string;
  originalKey: string;
  pageCount: number;
  extractor: string;
  pages: ExtractedPage[];
  lessons: ExtractedLesson[];
  assets: VisualAsset[];
  warnings: string[];
}

export const contextRequestSchema = z.object({
  courseId: z.string().min(1).max(200),
  lessonId: identifier,
  maxChars: z.number().int().min(500).max(100000).default(24000),
  offset: z.number().int().min(0).default(0),
  includeSupplementary: z.boolean().default(true),
  allowUnverified: z.boolean().default(false),
}).strict();
export type ContextRequest = z.infer<typeof contextRequestSchema>;

export const unitContextRequestSchema = z.object({
  courseId: z.string().min(1).max(200),
  unitId: identifier,
  maxChars: z.number().int().min(500).max(200000).default(48000),
  offset: z.number().int().min(0).default(0),
  includeSupplementary: z.boolean().default(true),
  allowUnverified: z.boolean().default(false),
}).strict();
export type UnitContextRequest = z.infer<typeof unitContextRequestSchema>;

export interface Citation {
  resourceId: string;
  resourceVersionId: string;
  title: string;
  kind: typeof resourceKinds[number];
  sourceUrl: string;
  sourceSha256: string;
  page: number;
  bbox?: BBox;
  publicationYear?: string;
  rightsNote: string;
}
export interface ContextBlock {
  id: string;
  text: string;
  textStatus: TextStatus;
  lessonId?: string;
  citation: Citation;
}
export interface ContextVisual extends VisualAsset {
  citation: Citation;
  assetPath: string;
}
export interface LessonContext {
  schemaVersion: 1;
  bundleId: string;
  status: 'ready' | 'partial' | 'not_available';
  course: Course | null;
  lesson: { id: string; title: string; objectives: string[] } | null;
  primaryContent: ContextBlock[];
  supportingMaterial: ContextBlock[];
  visuals: ContextVisual[];
  warnings: string[];
  pagination: { offset: number; nextOffset: number | null; totalBlocks: number; truncated: boolean };
}

export interface UnitContext {
  schemaVersion: 1;
  bundleId: string;
  status: 'ready' | 'partial' | 'not_available';
  course: Course | null;
  unit: { id: string; title: string; order: number } | null;
  lessons: Array<{ id: string; title: string; objectives: string[] }>;
  primaryContent: ContextBlock[];
  supportingMaterial: ContextBlock[];
  visuals: ContextVisual[];
  warnings: string[];
  pagination: { offset: number; nextOffset: number | null; totalBlocks: number; truncated: boolean };
}

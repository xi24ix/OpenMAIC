import { createHash } from 'node:crypto';
import { contextRequestSchema, manifestSchema, unitContextRequestSchema, type BBox, type Citation, type ContextBlock, type ContextRequest, type ContextVisual, type Course, type Extraction, type ImportManifest, type LessonContext, type UnitContext, type UnitContextRequest, type VisualAsset } from './contracts.js';
import { applyInitialMigration, type Database } from './database.js';

type DbRow = Record<string, any>;
type CatalogCourse = Course & { courseId: string; units: Array<{ id: string; title: string; order: number; lessons: Array<{ id: string; title: string; order: number; objectives: string[] }> }> };

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonicalize(entry)]));
  return value;
};
const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));
const stableCourse = (course: Course): string => JSON.stringify([
  course.country, course.curriculum, course.academicYear, course.grade, course.track,
  course.subject, course.semester, course.edition, course.language,
]);
const json = (value: unknown): string => JSON.stringify(value);
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

function rowCourse(row: DbRow): Course & { courseId: string } {
  return {
    courseId: row.course_id,
    country: row.country,
    curriculum: row.curriculum,
    academicYear: row.academic_year,
    grade: Number(row.grade),
    track: row.track,
    subject: row.subject,
    semester: Number(row.semester) as 1 | 2,
    edition: row.edition,
    language: row.language,
  };
}

function citation(row: DbRow): Citation {
  return {
    resourceId: row.resource_id,
    resourceVersionId: row.resource_version_id,
    title: row.resource_title,
    kind: row.resource_kind,
    sourceUrl: row.source_url,
    sourceSha256: row.source_sha256,
    page: Number(row.page),
    ...(row.bbox ? { bbox: parseJson<BBox>(row.bbox, undefined as never) } : {}),
    ...(row.publication_year ? { publicationYear: row.publication_year } : {}),
    rightsNote: row.rights_note,
  };
}

export class CurriculumRepository {
  constructor(private readonly database: Database) {}

  async initialize(): Promise<void> {
    await applyInitialMigration(this.database);
  }

  async importResource(manifestInput: ImportManifest, extraction: Extraction): Promise<{ courseId: string; resourceVersionId: string }> {
    const manifest = manifestSchema.parse(manifestInput);
    if (manifest.resource.access !== 'private_reference') throw new Error('Only private_reference resources are supported');
    if (manifest.resource.kind === 'student_book' && extraction.lessons.length === 0) throw new Error('Primary resource extraction has no lesson blocks');
    if (extraction.sourceSha256.length === 0) throw new Error('Extraction sourceSha256 is required');
    if (extraction.versionId.length === 0) throw new Error('Extraction versionId is required');

    const courseId = `course-${hash(stableCourse(manifest.course)).slice(0, 40)}`;
    const resourceId = `${courseId}:resource:${manifest.resource.id}`;
    const mappingIdentity = hash(canonicalJson(manifest.units));
    const extractionIdentity = hash(canonicalJson({ versionId: extraction.versionId, extractor: extraction.extractor, pages: extraction.pages, lessons: extraction.lessons, assets: extraction.assets }));
    const versionIdentity = hash(canonicalJson([extraction.sourceSha256, extractionIdentity, mappingIdentity]));
    const resourceVersionId = `${resourceId}:version:${versionIdentity.slice(0, 48)}`;
    const incomingVerified = manifest.review.curriculumVerified && manifest.review.contentVerified;

    return this.database.transaction(async (db) => {
      await db.query(
        `INSERT INTO courses (course_id,country,curriculum,academic_year,grade,track,subject,semester,edition,language)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (course_id) DO UPDATE SET edition=EXCLUDED.edition`,
        [courseId, manifest.course.country, manifest.course.curriculum, manifest.course.academicYear, manifest.course.grade, manifest.course.track, manifest.course.subject, manifest.course.semester, manifest.course.edition, manifest.course.language],
      );
      for (const unit of manifest.units) {
        await db.query(
          `INSERT INTO units (course_id,unit_id,title,unit_order) VALUES ($1,$2,$3,$4)
           ON CONFLICT (course_id,unit_id) DO UPDATE SET title=EXCLUDED.title,unit_order=EXCLUDED.unit_order`,
          [courseId, unit.id, unit.title, unit.order],
        );
        for (const lesson of unit.lessons) {
          await db.query(
           `INSERT INTO lessons (course_id,unit_id,lesson_id,title,lesson_order,objectives,expected_segment_count,expected_visual_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (course_id,unit_id,lesson_id) DO UPDATE SET title=EXCLUDED.title,lesson_order=EXCLUDED.lesson_order,objectives=EXCLUDED.objectives,expected_segment_count=EXCLUDED.expected_segment_count,expected_visual_ids=EXCLUDED.expected_visual_ids`,
           [courseId, unit.id, lesson.id, lesson.title, lesson.order, json(lesson.objectives), lesson.segments.length, json(lesson.visuals.map((visual) => visual.id))],
          );
        }
      }
      await db.query(
        `INSERT INTO resources (resource_id,course_id,source_id,title,kind,source_url,download_url,publication_year,publisher,rights_note,access)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (resource_id) DO UPDATE SET title=EXCLUDED.title,source_url=EXCLUDED.source_url,download_url=EXCLUDED.download_url,publication_year=EXCLUDED.publication_year,publisher=EXCLUDED.publisher,rights_note=EXCLUDED.rights_note`,
        [resourceId, courseId, manifest.resource.id, manifest.resource.title, manifest.resource.kind, manifest.resource.sourceUrl, manifest.resource.downloadUrl ?? null, manifest.resource.publicationYear ?? null, manifest.resource.publisher, manifest.resource.rightsNote, manifest.resource.access],
      );

       const existing = await db.query<DbRow>('SELECT resource_version_id,is_active,curriculum_verified,content_verified FROM resource_versions WHERE resource_id=$1 AND source_sha256=$2 AND extraction_identity=$3 AND mapping_identity=$4', [resourceId, extraction.sourceSha256, extractionIdentity, mappingIdentity]);
      if (existing.rows.length > 0) {
        const existingVersion = existing.rows[0];
        if (incomingVerified && (!existingVersion.curriculum_verified || !existingVersion.content_verified)) {
          const active = await db.query<DbRow>('SELECT resource_version_id,curriculum_verified,content_verified FROM resource_versions WHERE resource_id=$1 AND is_active=TRUE', [resourceId]);
          const canActivate = active.rows.length === 0 || incomingVerified || active.rows[0].resource_version_id === existingVersion.resource_version_id;
          if (canActivate) await db.query('UPDATE resource_versions SET is_active=FALSE WHERE resource_id=$1', [resourceId]);
          await db.query('UPDATE resource_versions SET curriculum_verified=TRUE,content_verified=TRUE,reviewer=$2,review_evidence=$3,is_active=$4 WHERE resource_version_id=$1', [existingVersion.resource_version_id, manifest.review.reviewer ?? null, manifest.review.evidence ?? null, canActivate]);
        }
        return { courseId, resourceVersionId: existing.rows[0].resource_version_id as string };
      }
      const active = await db.query<DbRow>('SELECT curriculum_verified,content_verified FROM resource_versions WHERE resource_id=$1 AND is_active=TRUE', [resourceId]);
      const canActivate = active.rows.length === 0 || incomingVerified || (!Boolean(active.rows[0].curriculum_verified) || !Boolean(active.rows[0].content_verified));
      if (canActivate) await db.query('UPDATE resource_versions SET is_active=FALSE WHERE resource_id=$1', [resourceId]);
      await db.query(
         `INSERT INTO resource_versions (resource_version_id,resource_id,course_id,extraction_version_id,extraction_identity,mapping_identity,source_sha256,original_key,page_count,extractor,warnings,curriculum_verified,content_verified,reviewer,review_evidence,is_active)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
         [resourceVersionId, resourceId, courseId, extraction.versionId, extractionIdentity, mappingIdentity, extraction.sourceSha256, extraction.originalKey, extraction.pageCount, extraction.extractor, json(extraction.warnings), manifest.review.curriculumVerified, manifest.review.contentVerified, manifest.review.reviewer ?? null, manifest.review.evidence ?? null, canActivate],
      );
      for (const page of extraction.pages) {
        await db.query('INSERT INTO resource_pages (course_id,resource_version_id,page,width,height,text,text_status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [courseId, resourceVersionId, page.page, page.width, page.height, page.text, page.textStatus]);
      }
      const manifestLessons = new Map(manifest.units.flatMap((u) => u.lessons.map((l) => [l.id, { unitId: u.id, lesson: l }] as const)));
      for (const extractedLesson of extraction.lessons) {
        const target = manifestLessons.get(extractedLesson.lessonId);
        if (!target) continue;
        for (let index = 0; index < extractedLesson.segments.length; index += 1) {
          const block = extractedLesson.segments[index];
          await db.query(
            `INSERT INTO content_blocks (block_id,course_id,unit_id,lesson_id,resource_version_id,block_order,page,bbox,text,text_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [`${resourceVersionId}:block:${extractedLesson.lessonId}:${index}`, courseId, target.unitId, extractedLesson.lessonId, resourceVersionId, index, block.page, block.bbox ? json(block.bbox) : null, block.text, block.textStatus],
          );
        }
      }
      for (const asset of extraction.assets) {
        const scopedAssetId = `${resourceVersionId}:asset:${asset.id}`;
        await db.query(
          `INSERT INTO visual_assets (asset_id,course_id,resource_version_id,raw_asset_id,object_key,sha256,mime_type,width,height,page,bbox,kind,caption,purpose)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [scopedAssetId, courseId, resourceVersionId, asset.id, asset.objectKey, asset.sha256, asset.mimeType, asset.width, asset.height, asset.page, json(asset.bbox), asset.kind, asset.caption, asset.purpose],
        );
        for (const lessonId of asset.lessonIds) {
          const target = manifestLessons.get(lessonId);
          const declared = target?.lesson.visuals.some((visual) => visual.id === asset.id);
          const extracted = extraction.lessons.find((lesson) => lesson.lessonId === lessonId)?.visualIds.includes(asset.id) ?? false;
          if (!target || !declared || !extracted) continue;
          await db.query('INSERT INTO asset_lessons (course_id,unit_id,lesson_id,resource_version_id,asset_id) VALUES ($1,$2,$3,$4,$5)', [courseId, target.unitId, lessonId, resourceVersionId, scopedAssetId]);
        }
      }
      return { courseId, resourceVersionId };
    });
  }

  async listCatalog(): Promise<CatalogCourse[]> {
    const courses = await this.database.query<DbRow>('SELECT * FROM courses ORDER BY academic_year,grade,track,subject,semester,edition,course_id');
    const result: CatalogCourse[] = [];
    for (const courseRow of courses.rows) {
      const units = await this.database.query<DbRow>('SELECT u.unit_id,u.title,u.unit_order,l.lesson_id,l.title AS lesson_title,l.lesson_order,l.objectives FROM units u LEFT JOIN lessons l ON l.course_id=u.course_id AND l.unit_id=u.unit_id WHERE u.course_id=$1 ORDER BY u.unit_order,l.lesson_order', [courseRow.course_id]);
      const byUnit = new Map<string, { id: string; title: string; order: number; lessons: Array<{ id: string; title: string; order: number; objectives: string[] }> }>();
      for (const row of units.rows) {
        let unit = byUnit.get(row.unit_id);
        if (!unit) { unit = { id: row.unit_id, title: row.title, order: Number(row.unit_order), lessons: [] }; byUnit.set(row.unit_id, unit); }
        if (row.lesson_id) unit.lessons.push({ id: row.lesson_id, title: row.lesson_title, order: Number(row.lesson_order), objectives: parseJson<string[]>(row.objectives, []) });
      }
      result.push({ ...rowCourse(courseRow), units: [...byUnit.values()] });
    }
    return result;
  }

  async resolveSelection(selection: Partial<Course>): Promise<{ status: 'matched' | 'ambiguous' | 'not_found'; matches: CatalogCourse[]; candidates: CatalogCourse[] }> {
    const allowed: Record<string, string> = { country: 'country', curriculum: 'curriculum', academicYear: 'academic_year', grade: 'grade', track: 'track', subject: 'subject', semester: 'semester', edition: 'edition', language: 'language' };
    const clauses: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(allowed)) {
      const value = (selection as Record<string, unknown>)[key];
      if (value !== undefined) { values.push(value); clauses.push(`${column}=$${values.length}`); }
    }
    const rows = await this.database.query<DbRow>(`SELECT * FROM courses${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY course_id`, values);
    const catalog = await this.listCatalog();
    const matches = catalog.filter((course) => rows.rows.some((row) => row.course_id === course.courseId));
    const status = matches.length === 0 ? 'not_found' : matches.length === 1 ? 'matched' : 'ambiguous';
    return { status, matches, candidates: matches };
  }

  async getUnit(courseId: string, unitId: string): Promise<{ id: string; title: string; order: number; lessons: Array<{ id: string; title: string; order: number; objectives: string[] }> } | null> {
    const rows = await this.database.query<DbRow>('SELECT u.unit_id,u.title,u.unit_order,l.lesson_id,l.title AS lesson_title,l.lesson_order,l.objectives FROM units u LEFT JOIN lessons l ON l.course_id=u.course_id AND l.unit_id=u.unit_id WHERE u.course_id=$1 AND u.unit_id=$2 ORDER BY l.lesson_order', [courseId, unitId]);
    if (!rows.rows.length) return null;
    const first = rows.rows[0];
    return { id: first.unit_id, title: first.title, order: Number(first.unit_order), lessons: rows.rows.filter((row) => row.lesson_id).map((row) => ({ id: row.lesson_id, title: row.lesson_title, order: Number(row.lesson_order), objectives: parseJson<string[]>(row.objectives, []) })) };
  }

  async searchResources(input: { query: string; courseId?: string; limit?: number; allowUnverified?: boolean }): Promise<Array<ContextBlock & { resourceKind: string }>> {
    const query = input.query.trim();
    if (!query) return [];
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const verificationFilter = input.allowUnverified ? '' : ' AND rv.curriculum_verified=TRUE AND rv.content_verified=TRUE';
    const values: unknown[] = [query];
    const courseFilter = input.courseId ? ` AND cb.course_id=$${values.push(input.courseId)}` : '';
    values.push(limit);
    const rows = await this.database.query<DbRow>(
      `SELECT cb.*,r.resource_id,r.title AS resource_title,r.kind AS resource_kind,r.source_url,r.publication_year,r.rights_note,rv.source_sha256,rv.curriculum_verified,rv.content_verified
       FROM content_blocks cb
       JOIN resource_versions rv ON rv.resource_version_id=cb.resource_version_id AND rv.course_id=cb.course_id AND rv.is_active=TRUE
       JOIN resources r ON r.resource_id=rv.resource_id
       WHERE cb.text ILIKE '%' || $1 || '%'${courseFilter}${verificationFilter}
       ORDER BY CASE WHEN r.kind='student_book' THEN 0 ELSE 1 END, cb.course_id, cb.lesson_id, cb.block_order
       LIMIT $${values.length}`,
      values,
    );
    return rows.rows.map((row) => ({ ...({ id: row.block_id, text: row.text, textStatus: row.text_status, lessonId: row.lesson_id, citation: citation(row) } as ContextBlock), resourceKind: row.resource_kind }));
  }

  async getSourcePage(resourceVersionId: string, page: number, allowUnverified = false): Promise<Record<string, unknown> | null> {
    const verificationFilter = allowUnverified ? '' : ' AND rv.curriculum_verified=TRUE AND rv.content_verified=TRUE';
    const rows = await this.database.query<DbRow>(
      `SELECT rp.*,r.resource_id,r.title AS resource_title,r.kind AS resource_kind,r.source_url,r.publication_year,r.rights_note,rv.source_sha256,rv.curriculum_verified,rv.content_verified
       FROM resource_pages rp
       JOIN resource_versions rv ON rv.resource_version_id=rp.resource_version_id AND rv.course_id=rp.course_id AND rv.is_active=TRUE
       JOIN resources r ON r.resource_id=rv.resource_id
       WHERE rp.resource_version_id=$1 AND rp.page=$2${verificationFilter}`,
      [resourceVersionId, page],
    );
    if (!rows.rows.length) return null;
    const row = rows.rows[0];
    const assets = await this.database.query<DbRow>(
      `SELECT va.asset_id,va.raw_asset_id,va.object_key,va.sha256,va.mime_type,va.width,va.height,va.page,va.bbox,va.kind,va.caption,va.purpose
       FROM visual_assets va JOIN resource_versions rv ON rv.resource_version_id=va.resource_version_id AND rv.course_id=va.course_id AND rv.is_active=TRUE
       WHERE va.resource_version_id=$1 AND va.page=$2${verificationFilter}`,
      [resourceVersionId, page],
    );
    return {
      resourceVersionId,
      page: Number(row.page),
      width: Number(row.width),
      height: Number(row.height),
      text: row.text,
      textStatus: row.text_status,
      citation: citation(row),
      assets: assets.rows.map((asset) => ({
        id: asset.asset_id,
        rawAssetId: asset.raw_asset_id,
        assetPath: `/v1/assets/${encodeURIComponent(asset.asset_id)}`,
        objectKey: asset.object_key,
        sha256: asset.sha256,
        mimeType: asset.mime_type,
        width: Number(asset.width),
        height: Number(asset.height),
        page: Number(asset.page),
        bbox: parseJson<BBox>(asset.bbox, [0, 0, 1, 1]),
        kind: asset.kind,
        caption: asset.caption,
        purpose: asset.purpose,
      })),
    };
  }

  async getLessonContext(requestInput: ContextRequest): Promise<LessonContext> {
    const request = contextRequestSchema.parse(requestInput);
    const courseRows = await this.database.query<DbRow>('SELECT * FROM courses WHERE course_id=$1', [request.courseId]);
    if (!courseRows.rows.length) return this.emptyContext(request, 'Course is not available');
    const courseRow = courseRows.rows[0];
    const lessonRows = await this.database.query<DbRow>('SELECT * FROM lessons WHERE course_id=$1 AND lesson_id=$2 ORDER BY unit_id LIMIT 1', [request.courseId, request.lessonId]);
    if (!lessonRows.rows.length) return this.emptyContext(request, 'Lesson is not available', rowCourse(courseRow));
    const lessonRow = lessonRows.rows[0];
    const params = [request.courseId, request.lessonId];
    const versionFilter = request.allowUnverified ? '' : ' AND rv.curriculum_verified=TRUE AND rv.content_verified=TRUE';
    const blocks = await this.database.query<DbRow>(
      `SELECT cb.*,r.resource_id,r.title AS resource_title,r.kind AS resource_kind,r.source_url,r.publication_year,r.rights_note,rv.source_sha256,rv.curriculum_verified,rv.content_verified
       FROM content_blocks cb JOIN resource_versions rv ON rv.resource_version_id=cb.resource_version_id AND rv.course_id=cb.course_id AND rv.is_active=TRUE
       JOIN resources r ON r.resource_id=rv.resource_id
       WHERE cb.course_id=$1 AND cb.lesson_id=$2${versionFilter}
       ORDER BY CASE WHEN r.kind='student_book' THEN 0 ELSE 1 END, r.kind, r.resource_id, cb.block_order`, params);
    const primaryRows = blocks.rows.filter((row) => row.resource_kind === 'student_book');
    const supportingRows = blocks.rows.filter((row) => row.resource_kind !== 'student_book' && request.includeSupplementary);
    const warnings: string[] = [];
    const activeAll = await this.database.query<DbRow>(
      `SELECT rv.*,r.kind FROM resource_versions rv JOIN resources r ON r.resource_id=rv.resource_id WHERE rv.course_id=$1 AND rv.is_active=TRUE`, [request.courseId]);
    const activePrimary = activeAll.rows.filter((row) => row.kind === 'student_book');
    if (activePrimary.length === 0) return this.emptyContext(request, 'No active primary student_book is available', rowCourse(courseRow), { id: lessonRow.lesson_id, title: lessonRow.title, objectives: parseJson<string[]>(lessonRow.objectives, []) }, 'not_available');
    if (request.allowUnverified) warnings.push('Private evaluation mode is enabled; this context is not publication-ready and remains private reference only.');
    if (request.allowUnverified && activePrimary.some((row) => !row.curriculum_verified || !row.content_verified)) warnings.push('Unverified material included for private evaluation; this context is not publication-ready.');
    if (!request.allowUnverified && activePrimary.some((row) => !row.curriculum_verified || !row.content_verified)) warnings.push('Primary material is awaiting curriculum and content verification.');
     if (primaryRows.length === 0) warnings.push('Primary lesson content is missing from the active student_book version.');
     if (primaryRows.some((row) => row.text_status === 'needs_ocr')) warnings.push('One or more primary blocks need OCR and are not ready.');
     const expectedSegmentCount = Number(lessonRow.expected_segment_count ?? 0);
     const expectedVisualIds = parseJson<string[]>(lessonRow.expected_visual_ids, []);
     let missingSegments = false;
     let missingVisuals = false;
     for (const version of activePrimary) {
       const actualSegments = await this.database.query<DbRow>('SELECT COUNT(*)::int AS count FROM content_blocks WHERE course_id=$1 AND unit_id=$2 AND lesson_id=$3 AND resource_version_id=$4', [request.courseId, lessonRow.unit_id, request.lessonId, version.resource_version_id]);
       const segmentCount = Number(actualSegments.rows[0]?.count ?? 0);
       if (expectedSegmentCount > segmentCount) {
         missingSegments = true;
         warnings.push(`Missing ${expectedSegmentCount - segmentCount} extraction segment(s) for lesson ${request.lessonId} in active student_book version.`);
       }
       if (expectedVisualIds.length) {
         const actualVisuals = await this.database.query<DbRow>(
           `SELECT va.raw_asset_id FROM visual_assets va
            JOIN asset_lessons al ON al.asset_id=va.asset_id AND al.course_id=va.course_id AND al.resource_version_id=va.resource_version_id
            WHERE va.course_id=$1 AND va.resource_version_id=$2 AND al.unit_id=$3 AND al.lesson_id=$4`,
           [request.courseId, version.resource_version_id, lessonRow.unit_id, request.lessonId],
         );
         const actualVisualIds = new Set(actualVisuals.rows.map((row) => row.raw_asset_id as string));
         const missing = expectedVisualIds.filter((visualId) => !actualVisualIds.has(visualId));
         if (missing.length) {
           missingVisuals = true;
           warnings.push(`Missing visual asset(s) for lesson ${request.lessonId}: ${missing.join(', ')}.`);
         }
       }
     }
    const allRows = [...primaryRows, ...supportingRows];
    const totalBlocks = allRows.length;
    const offset = Math.min(request.offset, totalBlocks);
    const selected: DbRow[] = [];
    let used = 0;
    let nextOffset: number | null = null;
    for (let index = offset; index < allRows.length; index += 1) {
      const row = allRows[index];
      const length = row.text.length;
      if (selected.length > 0 && used + length > request.maxChars) { nextOffset = index; break; }
      if (selected.length === 0 && length > request.maxChars) warnings.push(`Oversized block ${row.block_id} exceeds maxChars; it was returned whole as a partial page. Continue at the next block.`);
      selected.push(row); used += length;
    }
    if (nextOffset === null && offset + selected.length < totalBlocks) nextOffset = offset + selected.length;
    const selectedIds = new Set(selected.map((row) => row.block_id));
    const toBlock = (row: DbRow): ContextBlock => ({ id: row.block_id, text: row.text, textStatus: row.text_status, lessonId: row.lesson_id, citation: citation(row) });
    const primaryContent = selected.filter((row) => row.resource_kind === 'student_book').map(toBlock);
    const supportingMaterial = selected.filter((row) => row.resource_kind !== 'student_book').map(toBlock);
    if (selected.some((row) => row.curriculum_verified !== true || row.content_verified !== true)) warnings.push('Some returned material is unverified and must remain private reference material.');
    if (supportingRows.length > 0 && !request.includeSupplementary) warnings.push('Supplementary material was excluded by request.');
    const visuals = await this.contextVisuals(request.courseId, request.lessonId, selected, request.allowUnverified);
     const ready = primaryRows.length > 0 && !missingSegments && !missingVisuals && primaryRows.every((row) => (row.text_status === 'native' || row.text_status === 'ocr') && row.curriculum_verified && row.content_verified) && !request.allowUnverified;
    const status: LessonContext['status'] = ready ? 'ready' : primaryRows.length === 0 ? 'not_available' : 'partial';
    const bundleId = `bundle-${hash(json([request.courseId, request.lessonId, request.maxChars, request.offset, request.includeSupplementary, request.allowUnverified, [...selectedIds]]))}`;
    return { schemaVersion: 1, bundleId, status, course: rowCourse(courseRow), lesson: { id: lessonRow.lesson_id, title: lessonRow.title, objectives: parseJson<string[]>(lessonRow.objectives, []) }, primaryContent, supportingMaterial, visuals, warnings, pagination: { offset, nextOffset, totalBlocks, truncated: nextOffset !== null } };
  }

  async getUnitContext(requestInput: UnitContextRequest): Promise<UnitContext> {
    const request = unitContextRequestSchema.parse(requestInput);
    const courseRows = await this.database.query<DbRow>('SELECT * FROM courses WHERE course_id=$1', [request.courseId]);
    if (!courseRows.rows.length) return this.emptyUnitContext(request, 'Course is not available');
    const courseRow = courseRows.rows[0];
    const unitRows = await this.database.query<DbRow>('SELECT * FROM units WHERE course_id=$1 AND unit_id=$2', [request.courseId, request.unitId]);
    if (!unitRows.rows.length) return this.emptyUnitContext(request, 'Unit is not available', rowCourse(courseRow));
    const unitRow = unitRows.rows[0];
    const unit = { id: unitRow.unit_id as string, title: unitRow.title as string, order: Number(unitRow.unit_order) };
    const lessonRows = await this.database.query<DbRow>('SELECT * FROM lessons WHERE course_id=$1 AND unit_id=$2 ORDER BY lesson_order', [request.courseId, request.unitId]);
    const lessons = lessonRows.rows.map((row) => ({ id: row.lesson_id as string, title: row.title as string, objectives: parseJson<string[]>(row.objectives, []) }));
    const activeAll = await this.database.query<DbRow>(
      `SELECT rv.*,r.kind FROM resource_versions rv JOIN resources r ON r.resource_id=rv.resource_id WHERE rv.course_id=$1 AND rv.is_active=TRUE`, [request.courseId]);
    const activePrimary = activeAll.rows.filter((row) => row.kind === 'student_book');
    if (activePrimary.length === 0) return this.emptyUnitContext(request, 'No active primary student_book is available', rowCourse(courseRow), unit, lessons, 'not_available');
    const versionFilter = request.allowUnverified ? '' : ' AND rv.curriculum_verified=TRUE AND rv.content_verified=TRUE';
    const blocks = await this.database.query<DbRow>(
      `SELECT cb.*,r.resource_id,r.title AS resource_title,r.kind AS resource_kind,r.source_url,r.publication_year,r.rights_note,rv.source_sha256,rv.curriculum_verified,rv.content_verified
       FROM content_blocks cb
       JOIN lessons l ON l.course_id=cb.course_id AND l.unit_id=cb.unit_id AND l.lesson_id=cb.lesson_id
       JOIN resource_versions rv ON rv.resource_version_id=cb.resource_version_id AND rv.course_id=cb.course_id AND rv.is_active=TRUE
       JOIN resources r ON r.resource_id=rv.resource_id
       WHERE cb.course_id=$1 AND cb.unit_id=$2${versionFilter}
       ORDER BY l.lesson_order, CASE WHEN r.kind='student_book' THEN 0 ELSE 1 END, r.kind, r.resource_id, cb.block_order`,
      [request.courseId, request.unitId],
    );
    const primaryRows = blocks.rows.filter((row) => row.resource_kind === 'student_book');
    const supportingRows = blocks.rows.filter((row) => row.resource_kind !== 'student_book' && request.includeSupplementary);
    const warnings: string[] = [];
    if (request.allowUnverified) warnings.push('Private evaluation mode is enabled; this context is not publication-ready and remains private reference only.');
    if (request.allowUnverified && activePrimary.some((row) => !row.curriculum_verified || !row.content_verified)) warnings.push('Unverified material included for private evaluation; this context is not publication-ready.');
    if (!request.allowUnverified && activePrimary.some((row) => !row.curriculum_verified || !row.content_verified)) warnings.push('Primary material is awaiting curriculum and content verification.');
    if (primaryRows.length === 0) warnings.push('Primary unit content is missing from the active student_book version.');
    if (primaryRows.some((row) => row.text_status === 'needs_ocr')) warnings.push('One or more primary blocks need OCR and are not ready.');
    const allRows = [...primaryRows, ...supportingRows];
    const totalBlocks = allRows.length;
    const offset = Math.min(request.offset, totalBlocks);
    const selected: DbRow[] = [];
    let used = 0;
    let nextOffset: number | null = null;
    for (let index = offset; index < allRows.length; index += 1) {
      const row = allRows[index];
      const length = row.text.length;
      if (selected.length > 0 && used + length > request.maxChars) { nextOffset = index; break; }
      if (selected.length === 0 && length > request.maxChars) warnings.push(`Oversized block ${row.block_id} exceeds maxChars; it was returned whole as a partial page. Continue at the next block.`);
      selected.push(row); used += length;
    }
    if (nextOffset === null && offset + selected.length < totalBlocks) nextOffset = offset + selected.length;
    const selectedIds = new Set(selected.map((row) => row.block_id));
    const toBlock = (row: DbRow): ContextBlock => ({ id: row.block_id, text: row.text, textStatus: row.text_status, lessonId: row.lesson_id, citation: citation(row) });
    const primaryContent = selected.filter((row) => row.resource_kind === 'student_book').map(toBlock);
    const supportingMaterial = selected.filter((row) => row.resource_kind !== 'student_book').map(toBlock);
    if (selected.some((row) => row.curriculum_verified !== true || row.content_verified !== true)) warnings.push('Some returned material is unverified and must remain private reference material.');
    if (supportingRows.length > 0 && !request.includeSupplementary) warnings.push('Supplementary material was excluded by request.');
    const selectedLessonIds = [...new Set(selected.map((row) => row.lesson_id as string))];
    const visuals = await this.unitVisuals(request.courseId, request.unitId, selectedLessonIds, selected, request.allowUnverified);
    const ready = primaryRows.length > 0 && primaryRows.every((row) => (row.text_status === 'native' || row.text_status === 'ocr') && row.curriculum_verified && row.content_verified) && !request.allowUnverified;
    const status: UnitContext['status'] = ready ? 'ready' : primaryRows.length === 0 ? 'not_available' : 'partial';
    const bundleId = `bundle-${hash(json([request.courseId, request.unitId, request.maxChars, request.offset, request.includeSupplementary, request.allowUnverified, [...selectedIds]]))}`;
    return { schemaVersion: 1, bundleId, status, course: rowCourse(courseRow), unit, lessons, primaryContent, supportingMaterial, visuals, warnings, pagination: { offset, nextOffset, totalBlocks, truncated: nextOffset !== null } };
  }

  private async unitVisuals(courseId: string, unitId: string, lessonIds: string[], selected: DbRow[], allowUnverified: boolean): Promise<ContextVisual[]> {
    const versionIds = [...new Set(selected.map((row) => row.resource_version_id))];
    if (!versionIds.length || !lessonIds.length) return [];
    const rows = await this.database.query<DbRow>(
      `SELECT va.*,al.lesson_id AS linked_lesson_id,r.resource_id,r.title AS resource_title,r.kind AS resource_kind,r.source_url,r.publication_year,r.rights_note,rv.source_sha256,rv.curriculum_verified,rv.content_verified
       FROM visual_assets va
       JOIN asset_lessons al ON al.asset_id=va.asset_id AND al.course_id=va.course_id AND al.unit_id=$2
       JOIN resource_versions rv ON rv.resource_version_id=va.resource_version_id AND rv.course_id=va.course_id AND rv.is_active=TRUE
       JOIN resources r ON r.resource_id=rv.resource_id
       WHERE va.course_id=$1 AND va.resource_version_id=ANY($3::text[]) AND al.lesson_id=ANY($4::text[])${allowUnverified ? '' : ' AND rv.curriculum_verified=TRUE AND rv.content_verified=TRUE'}`,
      [courseId, unitId, versionIds, lessonIds],
    );
    const byId = new Map<string, ContextVisual>();
    for (const row of rows.rows) {
      const existing = byId.get(row.asset_id);
      if (existing) {
        if (!existing.lessonIds.includes(row.linked_lesson_id)) existing.lessonIds.push(row.linked_lesson_id);
        continue;
      }
      byId.set(row.asset_id, {
        id: row.asset_id, objectKey: row.object_key, sha256: row.sha256, mimeType: row.mime_type, width: Number(row.width), height: Number(row.height), page: Number(row.page), bbox: parseJson<BBox>(row.bbox, [0, 0, 1, 1]), kind: row.kind, caption: row.caption, purpose: row.purpose,
        lessonIds: [row.linked_lesson_id], assetPath: `/v1/assets/${encodeURIComponent(row.asset_id)}`, citation: citation(row),
      });
    }
    return [...byId.values()];
  }

  private emptyUnitContext(request: UnitContextRequest, warning: string, course: Course | null = null, unit: UnitContext['unit'] = null, lessons: UnitContext['lessons'] = [], status: UnitContext['status'] = 'not_available'): UnitContext {
    return { schemaVersion: 1, bundleId: `bundle-${hash(json([request.courseId, request.unitId, request.offset]))}`, status, course, unit, lessons, primaryContent: [], supportingMaterial: [], visuals: [], warnings: [warning], pagination: { offset: request.offset, nextOffset: null, totalBlocks: 0, truncated: false } };
  }

  private async contextVisuals(courseId: string, lessonId: string, selected: DbRow[], allowUnverified: boolean): Promise<ContextVisual[]> {
    const versionIds = [...new Set(selected.map((row) => row.resource_version_id))];
    if (!versionIds.length) return [];
    const rows = await this.database.query<DbRow>(
      `SELECT va.*,r.resource_id,r.title AS resource_title,r.kind AS resource_kind,r.source_url,r.publication_year,r.rights_note,rv.source_sha256,rv.curriculum_verified,rv.content_verified
       FROM visual_assets va JOIN asset_lessons al ON al.asset_id=va.asset_id AND al.course_id=va.course_id AND al.lesson_id=$2
       JOIN resource_versions rv ON rv.resource_version_id=va.resource_version_id AND rv.course_id=va.course_id AND rv.is_active=TRUE
       JOIN resources r ON r.resource_id=rv.resource_id
       WHERE va.course_id=$1 AND va.resource_version_id = ANY($3::text[])${allowUnverified ? '' : ' AND rv.curriculum_verified=TRUE AND rv.content_verified=TRUE'}`,
      [courseId, lessonId, versionIds],
    );
    return rows.rows.map((row) => ({
      id: row.asset_id, objectKey: row.object_key, sha256: row.sha256, mimeType: row.mime_type, width: Number(row.width), height: Number(row.height), page: Number(row.page), bbox: parseJson<BBox>(row.bbox, [0, 0, 1, 1]), kind: row.kind, caption: row.caption, purpose: row.purpose,
      lessonIds: [lessonId], assetPath: `/v1/assets/${encodeURIComponent(row.asset_id)}`, citation: citation(row),
    }));
  }

  private emptyContext(request: ContextRequest, warning: string, course: Course | null = null, lesson: LessonContext['lesson'] = null, status: LessonContext['status'] = 'not_available'): LessonContext {
    return { schemaVersion: 1, bundleId: `bundle-${hash(json([request.courseId, request.lessonId, request.offset]))}`, status, course, lesson, primaryContent: [], supportingMaterial: [], visuals: [], warnings: [warning], pagination: { offset: request.offset, nextOffset: null, totalBlocks: 0, truncated: false } };
  }

  async getAsset(id: string): Promise<(VisualAsset & { source: Citation & { verified: boolean }; sourceMetadata: Citation & { verified: boolean } }) | null> {
    const rows = await this.database.query<DbRow>(
       `SELECT va.*,r.resource_id,r.title AS resource_title,r.kind AS resource_kind,r.source_url,r.publication_year,r.rights_note,rv.source_sha256,rv.curriculum_verified,rv.content_verified
        FROM visual_assets va JOIN resource_versions rv ON rv.resource_version_id=va.resource_version_id AND rv.course_id=va.course_id AND rv.is_active=TRUE AND rv.curriculum_verified=TRUE AND rv.content_verified=TRUE
       JOIN resources r ON r.resource_id=rv.resource_id WHERE va.asset_id=$1`, [id]);
    if (!rows.rows.length) return null;
    const row = rows.rows[0];
     const lessonRows = await this.database.query<DbRow>('SELECT lesson_id FROM asset_lessons WHERE asset_id=$1 ORDER BY lesson_id', [id]);
    const source = { ...citation({ ...row, page: row.page }), verified: Boolean(row.curriculum_verified && row.content_verified) };
    return { id: row.asset_id, objectKey: row.object_key, sha256: row.sha256, mimeType: row.mime_type, width: Number(row.width), height: Number(row.height), page: Number(row.page), bbox: parseJson<BBox>(row.bbox, [0, 0, 1, 1]), kind: row.kind, caption: row.caption, purpose: row.purpose, lessonIds: lessonRows.rows.map((lesson) => lesson.lesson_id), source, sourceMetadata: source };
  }

  async getCoverage(): Promise<Record<string, unknown>> {
    const [courses, units, lessons, resources, versions, blocks, assets] = await Promise.all([
      this.database.query<DbRow>('SELECT COUNT(*)::int AS count FROM courses'),
      this.database.query<DbRow>('SELECT COUNT(*)::int AS count FROM units'),
      this.database.query<DbRow>('SELECT COUNT(*)::int AS count FROM lessons'),
      this.database.query<DbRow>('SELECT COUNT(*)::int AS count FROM resources'),
      this.database.query<DbRow>('SELECT COUNT(*)::int AS count,COALESCE(SUM(CASE WHEN curriculum_verified AND content_verified THEN 1 ELSE 0 END),0)::int AS verified FROM resource_versions WHERE is_active=TRUE'),
      this.database.query<DbRow>(`SELECT COUNT(*)::int AS count,COUNT(DISTINCT CASE WHEN r.kind='student_book' AND rv.curriculum_verified AND rv.content_verified AND (cb.text_status='native' OR cb.text_status='ocr') THEN cb.course_id||':'||cb.lesson_id END)::int AS ready_lessons FROM content_blocks cb JOIN lessons l ON l.course_id=cb.course_id AND l.lesson_id=cb.lesson_id JOIN resource_versions rv ON rv.resource_version_id=cb.resource_version_id AND rv.course_id=cb.course_id AND rv.is_active=TRUE JOIN resources r ON r.resource_id=rv.resource_id WHERE rv.is_active=TRUE`),
      this.database.query<DbRow>('SELECT COUNT(*)::int AS count FROM visual_assets'),
    ]);
    return { courses: Number(courses.rows[0].count), units: Number(units.rows[0].count), lessons: Number(lessons.rows[0].count), resources: Number(resources.rows[0].count), activeVersions: Number(versions.rows[0].count), verifiedActiveVersions: Number(versions.rows[0].verified), contentBlocks: Number(blocks.rows[0].count), readyLessons: Number(blocks.rows[0].ready_lessons), assets: Number(assets.rows[0].count) };
  }
}

ALTER TABLE resource_versions
  ADD COLUMN IF NOT EXISTS mapping_identity TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE resource_versions
  ADD COLUMN IF NOT EXISTS extraction_identity TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS expected_segment_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS expected_visual_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE resource_versions
  DROP CONSTRAINT IF EXISTS resource_versions_resource_id_source_sha256_key;

DROP INDEX IF EXISTS resource_versions_identity;

CREATE UNIQUE INDEX IF NOT EXISTS resource_versions_identity
  ON resource_versions(resource_id, source_sha256, extraction_identity, mapping_identity);

CREATE UNIQUE INDEX IF NOT EXISTS lessons_course_lesson_unique
  ON lessons(course_id, lesson_id);

CREATE UNIQUE INDEX IF NOT EXISTS resources_id_course_unique
  ON resources(resource_id, course_id);

ALTER TABLE resource_versions
  DROP CONSTRAINT IF EXISTS resource_versions_resource_course_fkey;

ALTER TABLE resource_versions
  ADD CONSTRAINT resource_versions_resource_course_fkey
  FOREIGN KEY (resource_id, course_id)
  REFERENCES resources(resource_id, course_id) ON DELETE CASCADE;

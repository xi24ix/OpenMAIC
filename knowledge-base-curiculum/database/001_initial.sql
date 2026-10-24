CREATE TABLE IF NOT EXISTS courses (
  course_id TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  curriculum TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  grade INTEGER NOT NULL,
  track TEXT NOT NULL,
  subject TEXT NOT NULL,
  semester INTEGER NOT NULL,
  edition TEXT NOT NULL,
  language TEXT NOT NULL,
  UNIQUE (country, curriculum, academic_year, grade, track, subject, semester, edition, language)
);

CREATE TABLE IF NOT EXISTS units (
  course_id TEXT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL,
  title TEXT NOT NULL,
  unit_order INTEGER NOT NULL,
  PRIMARY KEY (course_id, unit_id),
  UNIQUE (course_id, unit_id)
);

CREATE TABLE IF NOT EXISTS lessons (
  course_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  title TEXT NOT NULL,
  lesson_order INTEGER NOT NULL,
  objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (course_id, unit_id, lesson_id),
  FOREIGN KEY (course_id, unit_id) REFERENCES units(course_id, unit_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS resources (
  resource_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_url TEXT NOT NULL,
  download_url TEXT,
  publication_year TEXT,
  publisher TEXT NOT NULL,
  rights_note TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'private_reference',
  UNIQUE (course_id, source_id)
);

CREATE TABLE IF NOT EXISTS resource_versions (
  resource_version_id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(resource_id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  extraction_version_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  original_key TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  extractor TEXT NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  curriculum_verified BOOLEAN NOT NULL DEFAULT FALSE,
  content_verified BOOLEAN NOT NULL DEFAULT FALSE,
  reviewer TEXT,
  review_evidence TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (resource_id, source_sha256),
  UNIQUE (resource_version_id, course_id),
  FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS resource_versions_one_active
  ON resource_versions(resource_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS resource_pages (
  course_id TEXT NOT NULL,
  resource_version_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  width DOUBLE PRECISION NOT NULL,
  height DOUBLE PRECISION NOT NULL,
  text TEXT NOT NULL,
  text_status TEXT NOT NULL,
  PRIMARY KEY (course_id, resource_version_id, page),
  FOREIGN KEY (resource_version_id, course_id)
    REFERENCES resource_versions(resource_version_id, course_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS content_blocks (
  block_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  resource_version_id TEXT NOT NULL,
  block_order INTEGER NOT NULL,
  page INTEGER NOT NULL,
  bbox JSONB,
  text TEXT NOT NULL,
  text_status TEXT NOT NULL,
  UNIQUE (course_id, resource_version_id, lesson_id, block_order),
  FOREIGN KEY (course_id, unit_id, lesson_id)
    REFERENCES lessons(course_id, unit_id, lesson_id) ON DELETE CASCADE,
  FOREIGN KEY (resource_version_id, course_id)
    REFERENCES resource_versions(resource_version_id, course_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS visual_assets (
  asset_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  resource_version_id TEXT NOT NULL,
  raw_asset_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  page INTEGER NOT NULL,
  bbox JSONB NOT NULL,
  kind TEXT NOT NULL,
  caption TEXT NOT NULL,
  purpose TEXT NOT NULL,
  UNIQUE (course_id, resource_version_id, raw_asset_id),
  UNIQUE (asset_id, resource_version_id, course_id),
  FOREIGN KEY (resource_version_id, course_id)
    REFERENCES resource_versions(resource_version_id, course_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS asset_lessons (
  course_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  resource_version_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  PRIMARY KEY (course_id, resource_version_id, asset_id, unit_id, lesson_id),
  FOREIGN KEY (course_id, unit_id, lesson_id)
    REFERENCES lessons(course_id, unit_id, lesson_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES visual_assets(asset_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, resource_version_id, course_id)
    REFERENCES visual_assets(asset_id, resource_version_id, course_id) ON DELETE CASCADE,
  FOREIGN KEY (resource_version_id, course_id)
    REFERENCES resource_versions(resource_version_id, course_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS lessons_catalog_order ON lessons(course_id, unit_id, lesson_order);
CREATE INDEX IF NOT EXISTS blocks_lesson_order ON content_blocks(course_id, lesson_id, resource_version_id, block_order);
CREATE INDEX IF NOT EXISTS assets_lesson_lookup ON asset_lessons(course_id, unit_id, lesson_id);

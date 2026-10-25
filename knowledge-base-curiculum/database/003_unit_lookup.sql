CREATE INDEX IF NOT EXISTS content_blocks_unit_lookup
  ON content_blocks(course_id, unit_id, resource_version_id, lesson_id, block_order);

CREATE INDEX IF NOT EXISTS asset_lessons_unit_lookup
  ON asset_lessons(course_id, unit_id, resource_version_id, lesson_id, asset_id);

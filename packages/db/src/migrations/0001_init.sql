-- StarLine schema v1 — migration 0001_init.sql
-- Source of truth: SPECIFICATION.md §3 (v1.0.0) with the DECISIONS.md audit resolutions applied:
--   * `series` table added (referenced by project.series_id but absent from the spec's SQL).
--   * custom_field_def uniqueness enforced via two partial indexes (NULL lore_kind safe).
-- Conventions (spec §3.1): UUIDv7 TEXT ids, epoch-millisecond INTEGER timestamps,
-- fractional-indexing order_key, enums via CHECK, all tables STRICT, FTS5 for search.

CREATE TABLE series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description_json TEXT, description_text TEXT NOT NULL DEFAULT '',
  order_key TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;

CREATE TABLE project (
  id TEXT PRIMARY KEY, series_id TEXT REFERENCES series(id) ON DELETE SET NULL,
  series_order_key TEXT, title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  subtitle TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '',
  form TEXT NOT NULL CHECK (form IN ('novel','novella','short_story','fairy_tale','fanfiction','screenplay_treatment')),
  method TEXT NOT NULL CHECK (method IN ('snowflake','freeform')),
  genres TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(genres)),
  logline TEXT NOT NULL DEFAULT '',
  description_json TEXT, description_text TEXT NOT NULL DEFAULT '',
  target_word_count INTEGER CHECK (target_word_count IS NULL OR target_word_count BETWEEN 0 AND 10000000),
  deadline TEXT, cover_attachment_id TEXT REFERENCES attachment(id) ON DELETE SET NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  settings TEXT NOT NULL CHECK (json_valid(settings)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;

CREATE TABLE attachment (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL, width INTEGER, height INTEGER, thumb BLOB, created_at INTEGER NOT NULL,
  UNIQUE (project_id, sha256)
) STRICT;

CREATE TABLE attachment_blob (
  attachment_id TEXT PRIMARY KEY REFERENCES attachment(id) ON DELETE CASCADE,
  data BLOB NOT NULL
) STRICT;
-- split so listing galleries never reads image bytes

CREATE TABLE snowflake_step (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  step INTEGER NOT NULL CHECK (step BETWEEN 1 AND 9),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','complete')),
  content TEXT NOT NULL CHECK (json_valid(content)),
  completed_at INTEGER, overrides TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(overrides)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (project_id, step),
  CHECK ((status = 'complete') = (completed_at IS NOT NULL))
) STRICT;

CREATE TABLE character (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  aliases TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases)),
  role TEXT NOT NULL DEFAULT 'supporting' CHECK (role IN ('protagonist','antagonist','major','supporting','minor','mentioned')),
  color TEXT NOT NULL, avatar_attachment_id TEXT REFERENCES attachment(id) ON DELETE SET NULL,
  pronouns TEXT NOT NULL DEFAULT '', age TEXT NOT NULL DEFAULT '', birth_story_date REAL, occupation TEXT NOT NULL DEFAULT '',
  one_line TEXT NOT NULL DEFAULT '', one_paragraph_json TEXT, one_paragraph_text TEXT NOT NULL DEFAULT '',
  motivation TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '', conflict TEXT NOT NULL DEFAULT '', epiphany TEXT NOT NULL DEFAULT '',
  want TEXT NOT NULL DEFAULT '', need TEXT NOT NULL DEFAULT '', lie TEXT NOT NULL DEFAULT '', truth TEXT NOT NULL DEFAULT '',
  flaws TEXT NOT NULL DEFAULT '[]', strengths TEXT NOT NULL DEFAULT '[]', fears TEXT NOT NULL DEFAULT '[]', "values" TEXT NOT NULL DEFAULT '[]',
  internal_conflict_json TEXT, internal_conflict_text TEXT NOT NULL DEFAULT '',
  external_conflict_json TEXT, external_conflict_text TEXT NOT NULL DEFAULT '',
  arc_type TEXT NOT NULL DEFAULT 'none' CHECK (arc_type IN ('positive_change','flat','negative_fall','negative_corruption','negative_disillusionment','none')),
  ghost_json TEXT, ghost_text TEXT NOT NULL DEFAULT '', voice_notes_json TEXT, voice_notes_text TEXT NOT NULL DEFAULT '',
  appearance_json TEXT, appearance_text TEXT NOT NULL DEFAULT '', backstory_json TEXT, backstory_text TEXT NOT NULL DEFAULT '',
  storyline_json TEXT, storyline_text TEXT NOT NULL DEFAULT '', bible_json TEXT, bible_text TEXT NOT NULL DEFAULT '',
  order_key TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;
CREATE INDEX idx_character_project_order ON character(project_id, order_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_character_project_role  ON character(project_id, role)      WHERE deleted_at IS NULL;

CREATE TABLE relationship_group (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL, order_key TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;

CREATE TABLE part (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title TEXT NOT NULL, summary_json TEXT, summary_text TEXT NOT NULL DEFAULT '', order_key TEXT NOT NULL, color TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;

CREATE TABLE chapter (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  part_id TEXT REFERENCES part(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '', summary_json TEXT, summary_text TEXT NOT NULL DEFAULT '',
  order_key TEXT NOT NULL, target_word_count INTEGER CHECK (target_word_count IS NULL OR target_word_count >= 0), color TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;
CREATE INDEX idx_chapter_order ON chapter(project_id, part_id, order_key) WHERE deleted_at IS NULL;

CREATE TABLE scene (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES chapter(id) ON DELETE SET NULL, order_key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', synopsis_json TEXT, synopsis_text TEXT NOT NULL DEFAULT '',
  pov_character_id TEXT REFERENCES character(id) ON DELETE SET NULL,
  location_id TEXT REFERENCES lore_entry(id) ON DELETE SET NULL,
  objective TEXT NOT NULL DEFAULT '', obstacle TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'unresolved' CHECK (outcome IN ('yes','no','yes_but','no_and','unresolved')),
  outcome_note TEXT NOT NULL DEFAULT '', emotion_start TEXT NOT NULL DEFAULT '', emotion_end TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','outlined','drafting','drafted','revising','done')),
  body_json TEXT, body_text TEXT NOT NULL DEFAULT '', body_word_count INTEGER NOT NULL DEFAULT 0,
  target_word_count INTEGER CHECK (target_word_count IS NULL OR target_word_count >= 0),
  story_time REAL, story_time_label TEXT NOT NULL DEFAULT '',
  time_of_day TEXT NOT NULL DEFAULT 'unspecified' CHECK (time_of_day IN ('dawn','morning','noon','afternoon','evening','night','unspecified')),
  color TEXT, is_flashback INTEGER NOT NULL DEFAULT 0 CHECK (is_flashback IN (0,1)),
  snowflake_source TEXT CHECK (snowflake_source IS NULL OR json_valid(snowflake_source)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;
CREATE INDEX idx_scene_chapter_order ON scene(project_id, chapter_id, order_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_scene_pov      ON scene(pov_character_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_scene_location ON scene(location_id)      WHERE deleted_at IS NULL;
CREATE INDEX idx_scene_status   ON scene(project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_scene_time     ON scene(project_id, story_time) WHERE deleted_at IS NULL AND story_time IS NOT NULL;

CREATE TABLE character_relationship (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('family_parent','family_child','family_sibling','family_spouse','family_other','romantic','friend','ally','rival','enemy','mentor','mentee','employer','employee','servant','master','acquaintance','custom')),
  custom_label TEXT NOT NULL DEFAULT '', directed INTEGER NOT NULL DEFAULT 0 CHECK (directed IN (0,1)),
  sentiment INTEGER NOT NULL DEFAULT 0 CHECK (sentiment BETWEEN -5 AND 5),
  notes_json TEXT, notes_text TEXT NOT NULL DEFAULT '',
  group_id TEXT REFERENCES relationship_group(id) ON DELETE SET NULL,
  starts_at_scene_id TEXT REFERENCES scene(id) ON DELETE SET NULL,
  ends_at_scene_id   TEXT REFERENCES scene(id) ON DELETE SET NULL,
  secret INTEGER NOT NULL DEFAULT 0 CHECK (secret IN (0,1)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  CHECK (source_id <> target_id),
  CHECK ((kind = 'custom') = (length(custom_label) > 0))
) STRICT;
-- Prevent duplicate edges. Undirected edges are normalised so source_id < target_id before insert (command layer).
CREATE UNIQUE INDEX uq_rel_edge ON character_relationship(source_id, target_id, kind, custom_label) WHERE deleted_at IS NULL;
CREATE INDEX idx_rel_target ON character_relationship(target_id);
CREATE INDEX idx_rel_project ON character_relationship(project_id);

CREATE TABLE plotline (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description_json TEXT, description_text TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL, order_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'subplot' CHECK (kind IN ('main','subplot','character_arc','mystery','theme')),
  character_id TEXT REFERENCES character(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;

CREATE TABLE scene_character (
  scene_id TEXT NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  presence TEXT NOT NULL DEFAULT 'present' CHECK (presence IN ('present','mentioned','offstage')),
  PRIMARY KEY (scene_id, character_id)) STRICT, WITHOUT ROWID;
CREATE INDEX idx_scene_character_char ON scene_character(character_id);

CREATE TABLE lore_category (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES lore_category(id) ON DELETE CASCADE,
  name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', order_key TEXT NOT NULL, color TEXT, default_kind TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  CHECK (parent_id IS NULL OR parent_id <> id)) STRICT;
CREATE INDEX idx_lore_category_parent ON lore_category(project_id, parent_id, order_key);

CREATE TABLE lore_entry (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES lore_category(id) ON DELETE SET NULL,
  parent_entry_id TEXT REFERENCES lore_entry(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('location','faction','magic_system','technology','geography','history_event','culture','religion','politics','economy','species','language','item','organization','antagonistic_force','custom')),
  custom_kind_label TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160), aliases TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 280),
  body_json TEXT, body_text TEXT NOT NULL DEFAULT '',
  image_attachment_id TEXT REFERENCES attachment(id) ON DELETE SET NULL,
  coordinates TEXT CHECK (coordinates IS NULL OR json_valid(coordinates)),
  order_key TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  CHECK (parent_entry_id IS NULL OR parent_entry_id <> id),
  CHECK ((kind = 'custom') = (length(custom_kind_label) > 0))) STRICT;
CREATE INDEX idx_lore_cat    ON lore_entry(project_id, category_id, order_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_lore_kind   ON lore_entry(project_id, kind) WHERE deleted_at IS NULL;
CREATE INDEX idx_lore_parent ON lore_entry(parent_entry_id);

CREATE TABLE scene_lore (
  scene_id TEXT NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
  lore_entry_id TEXT NOT NULL REFERENCES lore_entry(id) ON DELETE CASCADE,
  PRIMARY KEY (scene_id, lore_entry_id)) STRICT, WITHOUT ROWID;
CREATE INDEX idx_scene_lore_lore ON scene_lore(lore_entry_id);

CREATE TABLE scene_plotline (
  scene_id TEXT NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
  plotline_id TEXT NOT NULL REFERENCES plotline(id) ON DELETE CASCADE,
  beat TEXT NOT NULL DEFAULT '' CHECK (length(beat) <= 120),
  PRIMARY KEY (scene_id, plotline_id)) STRICT, WITHOUT ROWID;
CREATE INDEX idx_scene_plotline_pl ON scene_plotline(plotline_id);

CREATE TABLE entity_link (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  from_type TEXT NOT NULL, from_id TEXT NOT NULL, to_type TEXT NOT NULL, to_id TEXT NOT NULL,
  kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
  UNIQUE (from_type, from_id, to_type, to_id, kind)) STRICT;
CREATE INDEX idx_entity_link_to ON entity_link(to_type, to_id);

CREATE TABLE idea_note (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'idea' CHECK (kind IN ('idea','research','dialogue','scene_seed','question','todo')),
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','incubating','used','archived')),
  body_json TEXT, body_text TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0, color TEXT,
  promoted_to_type TEXT, promoted_to_id TEXT, order_key TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  CHECK ((promoted_to_type IS NULL) = (promoted_to_id IS NULL))) STRICT;
CREATE INDEX idx_note_status ON idea_note(project_id, status, order_key) WHERE deleted_at IS NULL;

CREATE TABLE tag (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE, color TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE (project_id, name)) STRICT;

CREATE TABLE entity_tag (
  tag_id TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  PRIMARY KEY (tag_id, entity_type, entity_id)) STRICT, WITHOUT ROWID;
CREATE INDEX idx_entity_tag_entity ON entity_tag(entity_type, entity_id);

CREATE TABLE mention (
  source_type TEXT NOT NULL, source_id TEXT NOT NULL, field TEXT NOT NULL,
  target_type TEXT NOT NULL, target_id TEXT NOT NULL, count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (source_type, source_id, field, target_type, target_id)) STRICT, WITHOUT ROWID;
CREATE INDEX idx_mention_target ON mention(target_type, target_id);   -- backlinks query

CREATE TABLE timeline_event (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description_json TEXT, description_text TEXT NOT NULL DEFAULT '',
  story_time REAL NOT NULL, story_time_end REAL, story_time_label TEXT NOT NULL DEFAULT '',
  lane TEXT NOT NULL CHECK (lane IN ('world','character','plot')),
  character_id TEXT REFERENCES character(id) ON DELETE CASCADE,
  plotline_id  TEXT REFERENCES plotline(id)  ON DELETE CASCADE,
  scene_id     TEXT REFERENCES scene(id)     ON DELETE SET NULL,
  lore_entry_id TEXT REFERENCES lore_entry(id) ON DELETE SET NULL, color TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  CHECK (story_time_end IS NULL OR story_time_end >= story_time)) STRICT;
CREATE INDEX idx_timeline_time ON timeline_event(project_id, story_time) WHERE deleted_at IS NULL;

CREATE TABLE character_gallery (
  character_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachment(id) ON DELETE CASCADE,
  caption TEXT NOT NULL DEFAULT '', order_key TEXT NOT NULL,
  PRIMARY KEY (character_id, attachment_id)) STRICT, WITHOUT ROWID;

CREATE TABLE custom_field_def (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('character','lore','scene','location')), lore_kind TEXT,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  type TEXT NOT NULL CHECK (type IN ('text','longtext','number','date','boolean','select','multiselect','url','color','entity_ref')),
  options TEXT CHECK (options IS NULL OR json_valid(options)), entity_ref_target TEXT,
  required INTEGER NOT NULL DEFAULT 0, order_key TEXT NOT NULL, section TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;
-- DECISIONS.md #4: label unique per (project, target, lore_kind); two partial indexes because
-- SQLite treats NULLs as distinct in a plain UNIQUE, which would let duplicate unscoped labels in.
CREATE UNIQUE INDEX uq_custom_field_def_scoped   ON custom_field_def(project_id, target, lore_kind, label) WHERE lore_kind IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_custom_field_def_unscoped ON custom_field_def(project_id, target, label)            WHERE lore_kind IS NULL     AND deleted_at IS NULL;

CREATE TABLE custom_field_value (
  id TEXT PRIMARY KEY,
  def_id TEXT NOT NULL REFERENCES custom_field_def(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)), updated_at INTEGER NOT NULL,
  UNIQUE (def_id, owner_type, owner_id)) STRICT;
CREATE INDEX idx_cfv_owner ON custom_field_value(owner_type, owner_id);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
-- keys: 'revision' (monotonic int, +1 per committed transaction), 'created_by_version',
-- 'last_opened_by_version', 'file_uuid', 'graph_positions'

CREATE TABLE snapshot_record (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, reason TEXT NOT NULL, file_name TEXT NOT NULL,
  byte_size INTEGER NOT NULL, schema_version INTEGER NOT NULL, word_count INTEGER NOT NULL,
  scene_count INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '') STRICT;

-- Full-text search (spec §3.10): maintained by triggers that rewrite each row's entry.
CREATE VIRTUAL TABLE search_fts USING fts5(
  entity_type UNINDEXED, entity_id UNINDEXED, title, body,
  tokenize = "unicode61 remove_diacritics 2", prefix = '2 3 4');
CREATE VIRTUAL TABLE search_trigram USING fts5(
  entity_type UNINDEXED, entity_id UNINDEXED, title, tokenize = "trigram");

CREATE TRIGGER trg_fts_character_ai AFTER INSERT ON character BEGIN
  INSERT INTO search_fts(entity_type, entity_id, title, body) VALUES (
    'character', NEW.id, NEW.name,
    COALESCE(NEW.one_line,'') || ' ' || COALESCE(NEW.one_paragraph_text,'') || ' ' ||
    COALESCE(NEW.motivation,'') || ' ' || COALESCE(NEW.goal,'') || ' ' || COALESCE(NEW.conflict,'') || ' ' ||
    COALESCE(NEW.epiphany,'') || ' ' || COALESCE(NEW.want,'') || ' ' || COALESCE(NEW.need,'') || ' ' ||
    COALESCE(NEW.lie,'') || ' ' || COALESCE(NEW.truth,'') || ' ' || COALESCE(NEW.internal_conflict_text,'') || ' ' ||
    COALESCE(NEW.external_conflict_text,'') || ' ' || COALESCE(NEW.ghost_text,'') || ' ' ||
    COALESCE(NEW.voice_notes_text,'') || ' ' || COALESCE(NEW.appearance_text,'') || ' ' ||
    COALESCE(NEW.backstory_text,'') || ' ' || COALESCE(NEW.storyline_text,'') || ' ' || COALESCE(NEW.bible_text,'')
  );
  INSERT INTO search_trigram(entity_type, entity_id, title) VALUES ('character', NEW.id, NEW.name);
END;

CREATE TRIGGER trg_fts_character_au AFTER UPDATE ON character BEGIN
  DELETE FROM search_fts     WHERE entity_type = 'character' AND entity_id = OLD.id;
  DELETE FROM search_trigram WHERE entity_type = 'character' AND entity_id = OLD.id;
  INSERT INTO search_fts(entity_type, entity_id, title, body) VALUES (
    'character', NEW.id, NEW.name,
    COALESCE(NEW.one_line,'') || ' ' || COALESCE(NEW.one_paragraph_text,'') || ' ' ||
    COALESCE(NEW.motivation,'') || ' ' || COALESCE(NEW.goal,'') || ' ' || COALESCE(NEW.conflict,'') || ' ' ||
    COALESCE(NEW.epiphany,'') || ' ' || COALESCE(NEW.want,'') || ' ' || COALESCE(NEW.need,'') || ' ' ||
    COALESCE(NEW.lie,'') || ' ' || COALESCE(NEW.truth,'') || ' ' || COALESCE(NEW.internal_conflict_text,'') || ' ' ||
    COALESCE(NEW.external_conflict_text,'') || ' ' || COALESCE(NEW.ghost_text,'') || ' ' ||
    COALESCE(NEW.voice_notes_text,'') || ' ' || COALESCE(NEW.appearance_text,'') || ' ' ||
    COALESCE(NEW.backstory_text,'') || ' ' || COALESCE(NEW.storyline_text,'') || ' ' || COALESCE(NEW.bible_text,'')
  );
  INSERT INTO search_trigram(entity_type, entity_id, title) VALUES ('character', NEW.id, NEW.name);
END;

CREATE TRIGGER trg_fts_character_ad AFTER DELETE ON character BEGIN
  DELETE FROM search_fts     WHERE entity_type = 'character' AND entity_id = OLD.id;
  DELETE FROM search_trigram WHERE entity_type = 'character' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_fts_scene_ai AFTER INSERT ON scene BEGIN
  INSERT INTO search_fts(entity_type, entity_id, title, body) VALUES (
    'scene', NEW.id, NEW.title,
    COALESCE(NEW.synopsis_text,'') || ' ' || COALESCE(NEW.objective,'') || ' ' || COALESCE(NEW.obstacle,'') || ' ' ||
    COALESCE(NEW.outcome_note,'') || ' ' || COALESCE(NEW.emotion_start,'') || ' ' || COALESCE(NEW.emotion_end,'') || ' ' ||
    COALESCE(NEW.body_text,'')
  );
  INSERT INTO search_trigram(entity_type, entity_id, title) VALUES ('scene', NEW.id, NEW.title);
END;

CREATE TRIGGER trg_fts_scene_au AFTER UPDATE ON scene BEGIN
  DELETE FROM search_fts     WHERE entity_type = 'scene' AND entity_id = OLD.id;
  DELETE FROM search_trigram WHERE entity_type = 'scene' AND entity_id = OLD.id;
  INSERT INTO search_fts(entity_type, entity_id, title, body) VALUES (
    'scene', NEW.id, NEW.title,
    COALESCE(NEW.synopsis_text,'') || ' ' || COALESCE(NEW.objective,'') || ' ' || COALESCE(NEW.obstacle,'') || ' ' ||
    COALESCE(NEW.outcome_note,'') || ' ' || COALESCE(NEW.emotion_start,'') || ' ' || COALESCE(NEW.emotion_end,'') || ' ' ||
    COALESCE(NEW.body_text,'')
  );
  INSERT INTO search_trigram(entity_type, entity_id, title) VALUES ('scene', NEW.id, NEW.title);
END;

CREATE TRIGGER trg_fts_scene_ad AFTER DELETE ON scene BEGIN
  DELETE FROM search_fts     WHERE entity_type = 'scene' AND entity_id = OLD.id;
  DELETE FROM search_trigram WHERE entity_type = 'scene' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_fts_chapter_ai AFTER INSERT ON chapter BEGIN
  INSERT INTO search_fts(entity_type, entity_id, title, body) VALUES ('chapter', NEW.id, NEW.title, COALESCE(NEW.summary_text,''));
  INSERT INTO search_trigram(entity_type, entity_id, title) VALUES ('chapter', NEW.id, NEW.title);
END;
CREATE TRIGGER trg_fts_chapter_au AFTER UPDATE ON chapter BEGIN
  DELETE FROM search_fts     WHERE entity_type = 'chapter' AND entity_id = OLD.id;
  DELETE FROM search_trigram WHERE entity_type = 'chapter' AND entity_id = OLD.id;
  INSERT INTO search_fts(entity_type, entity_id, title, body) VALUES ('chapter', NEW.id, NEW.title, COALESCE(NEW.summary_text,''));
  INSERT INTO search_trigram(entity_type, entity_id, title) VALUES ('chapter', NEW.id, NEW.title);
END;
CREATE TRIGGER trg_fts_chapter_ad AFTER DELETE ON chapter BEGIN
  DELETE FROM search_fts     WHERE entity_type = 'chapter' AND entity_id = OLD.id;
  DELETE FROM search_trigram WHERE entity_type = 'chapter' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_fts_lore_ai AFTER INSERT ON lore_entry BEGIN
  INSERT INTO search_fts(entity_type, entity_id, title, body) VALUES ('lore', NEW.id, NEW.name, COALESCE(NEW.summary,'') || ' ' || COALESCE(NEW.body_text,''));
  INSERT INTO search_trigram(entity_type, entity_id, title) VALUES ('lore', NEW.id, NEW.name);
END;
CREATE TRIGGER trg_fts_lore_au AFTER UPDATE ON lore_entry BEGIN
  DELETE FROM search_fts     WHERE entity_type = 'lore' AND entity_id = OLD.id;
  DELETE FROM search_trigram WHERE entity_type = 'lore' AND entity_id = OLD.id;
  INSERT INTO search_fts(entity_type, entity_id, title, body) VALUES ('lore', NEW.id, NEW.name, COALESCE(NEW.summary,'') || ' ' || COALESCE(NEW.body_text,''));
  INSERT INTO search_trigram(entity_type, entity_id, title) VALUES ('lore', NEW.id, NEW.name);
END;
CREATE TRIGGER trg_fts_lore_ad AFTER DELETE ON lore_entry BEGIN
  DELETE FROM search_fts     WHERE entity_type = 'lore' AND entity_id = OLD.id;
  DELETE FROM search_trigram WHERE entity_type = 'lore' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_fts_note_ai AFTER INSERT ON idea_note BEGIN
  INSERT INTO search_fts(entity_type, entity_id, title, body) VALUES ('note', NEW.id, NEW.title, COALESCE(NEW.body_text,''));
  INSERT INTO search_trigram(entity_type, entity_id, title) VALUES ('note', NEW.id, NEW.title);
END;
CREATE TRIGGER trg_fts_note_au AFTER UPDATE ON idea_note BEGIN
  DELETE FROM search_fts     WHERE entity_type = 'note' AND entity_id = OLD.id;
  DELETE FROM search_trigram WHERE entity_type = 'note' AND entity_id = OLD.id;
  INSERT INTO search_fts(entity_type, entity_id, title, body) VALUES ('note', NEW.id, NEW.title, COALESCE(NEW.body_text,''));
  INSERT INTO search_trigram(entity_type, entity_id, title) VALUES ('note', NEW.id, NEW.title);
END;
CREATE TRIGGER trg_fts_note_ad AFTER DELETE ON idea_note BEGIN
  DELETE FROM search_fts     WHERE entity_type = 'note' AND entity_id = OLD.id;
  DELETE FROM search_trigram WHERE entity_type = 'note' AND entity_id = OLD.id;
END;

-- Invariants (spec §3.6), enforced in the schema where SQLite can:
CREATE TRIGGER trg_scene_location_kind_bi BEFORE INSERT ON scene
WHEN NEW.location_id IS NOT NULL AND (SELECT kind FROM lore_entry WHERE id = NEW.location_id) IS NOT 'location'
BEGIN SELECT RAISE(ABORT, 'scene.location_id must reference a lore_entry with kind=location'); END;
CREATE TRIGGER trg_scene_location_kind_bu BEFORE UPDATE OF location_id ON scene
WHEN NEW.location_id IS NOT NULL AND (SELECT kind FROM lore_entry WHERE id = NEW.location_id) IS NOT 'location'
BEGIN SELECT RAISE(ABORT, 'scene.location_id must reference a lore_entry with kind=location'); END;

CREATE TRIGGER trg_chapter_part_project_bi BEFORE INSERT ON chapter
WHEN NEW.part_id IS NOT NULL AND (SELECT project_id FROM part WHERE id = NEW.part_id) IS NOT NEW.project_id
BEGIN SELECT RAISE(ABORT, 'chapter.part_id must belong to the same project'); END;
CREATE TRIGGER trg_chapter_part_project_bu BEFORE UPDATE OF part_id ON chapter
WHEN NEW.part_id IS NOT NULL AND (SELECT project_id FROM part WHERE id = NEW.part_id) IS NOT NEW.project_id
BEGIN SELECT RAISE(ABORT, 'chapter.part_id must belong to the same project'); END;

CREATE TRIGGER trg_scene_chapter_project_bi BEFORE INSERT ON scene
WHEN NEW.chapter_id IS NOT NULL AND (SELECT project_id FROM chapter WHERE id = NEW.chapter_id) IS NOT NEW.project_id
BEGIN SELECT RAISE(ABORT, 'scene.chapter_id must belong to the same project'); END;
CREATE TRIGGER trg_scene_chapter_project_bu BEFORE UPDATE OF chapter_id ON scene
WHEN NEW.chapter_id IS NOT NULL AND (SELECT project_id FROM chapter WHERE id = NEW.chapter_id) IS NOT NEW.project_id
BEGIN SELECT RAISE(ABORT, 'scene.chapter_id must belong to the same project'); END;

-- POV characters are automatically present (spec §3.6, invariant 1).
CREATE TRIGGER trg_scene_pov_ai AFTER INSERT ON scene
WHEN NEW.pov_character_id IS NOT NULL
BEGIN INSERT OR IGNORE INTO scene_character(scene_id, character_id, presence) VALUES (NEW.id, NEW.pov_character_id, 'present'); END;
CREATE TRIGGER trg_scene_pov_au AFTER UPDATE OF pov_character_id ON scene
WHEN NEW.pov_character_id IS NOT NULL
BEGIN INSERT OR IGNORE INTO scene_character(scene_id, character_id, presence) VALUES (NEW.id, NEW.pov_character_id, 'present'); END;

-- Polymorphic references are cleaned on hard delete (spec §3.12, trg_cleanup_refs_character).
CREATE TRIGGER trg_cleanup_refs_character AFTER DELETE ON character BEGIN
  DELETE FROM mention            WHERE target_type = 'character' AND target_id = OLD.id;
  DELETE FROM entity_tag         WHERE entity_type = 'character' AND entity_id = OLD.id;
  DELETE FROM entity_link        WHERE (from_type = 'character' AND from_id = OLD.id) OR (to_type = 'character' AND to_id = OLD.id);
  DELETE FROM custom_field_value WHERE owner_type = 'character' AND owner_id = OLD.id;
END;

INSERT INTO meta(key, value) VALUES ('revision', '0');

PRAGMA application_id = 0x5354524C;
PRAGMA user_version = 1;

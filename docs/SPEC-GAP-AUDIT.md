# Spec-to-code gap audit (2026-10-13)

An independent sweep of `docs/SPECIFICATION.md` section 4 (the feature/UX inventory) against
the codebase, line by line, then triaged by hand. Every entry carries the spec line and what
was searched. Owner decisions that override the spec are listed separately, not as gaps.

**92 items** where the spec asks for something the code does not do, plus **15 judgement calls**.

> **Status: closed (2026-10-14, M5).** Every item below was triaged into slices 21-38 and
> shipped; superseded items are struck where the evidence moved. This file stays as the input record.

## How to read this

- **Tier 1 - forgotten:** never in a plan, decision or carry-over list, and worth building.
- **Tier 2 - deferred then lost:** a slice deferred it and it never came back.
- **Tier 3 - spec detail:** real, but low value on a phone (the owner's pivot, decision 6).
- **Superseded:** an owner decision replaced it; not a gap.
- **Known and tracked:** already on the carry-over list.

## Tier 1 - never planned, worth doing

| Item | Effort |
| --- | --- |
| Ingermanson attribution in-app + a link to his published description (spec A.4.6, a legal and ethical requirement) | 1-2 h |
| Cold-open <= 1.5 s and typing latency < 16 ms: budgets defined in PLAN section 7, never measured | 2-4 h |
| Snapshot before import, bulk delete and migration (the spec's data-safety default, 4.5.4) | 2-3 h |
| Scene editor: the lore picker is still a placeholder saying the World tab arrives in a later slice - it arrived in slice 6 | 2-3 h |
| Sepia and high-contrast themes (spec 4.6 lists four; two ship) | 2-3 h |
| entity_link typed links (member_of, located_in, ...): the table and the consistency checks expect them, no writer exists | 1-2 days |
| Command palette (spec 5.7 M2: FTS + palette - search shipped, the palette did not) | ~1 day |
| Export dialog: chapter scope, include-notes, 2-page preview, progress bar - all declared, none wired | ~1 day |
| Migration property tests with fast-check (declared in package.json, imported nowhere) | ~1 day |
| Settings: Editor (smart quotes, auto-pair, spellcheck), Statuses (rename/recolour), Keyboard, Privacy | 1-2 days |
| enabledModules is dead code: a module-visibility setting nothing reads (spec L1092) - wire it or delete it | 2-4 h |

## Tier 2 - deferred, then lost

| Item | Where it was deferred to | Effort |
| --- | --- | --- |
| Merge duplicate characters (select two, merge, rewrite mentions, undoable) | slice 2: deferred to M2 because it needs the mention system; M2 shipped without it and mentions exist now | ~1 day |
| Character dossier tabs: Psychology, Story (arc strip), Appearance, Backstory, Voice, Appearances, Gallery, Custom | the columns exist in the schema; no UI ever read them | 3-5 days |
| Lore: tag filters, kind filter, orphans-only, pinned; list/cards/map views; coordinate pins | slice 6 shipped v1 without them | 2-3 days |
| Outliner: multi-select and bulk actions, filters and dimming, saved filters, column chooser, group-by, keyboard | slice 4 shipped the list; the rest never came | 2-3 days |
| @mention depth: rename safety (chips re-resolve), hover preview, fuzzy and recency ranking, backlinks for scenes and notes | spec 4.4; only characters and lore are mention targets | 2-3 days |
| Timeline: lore history events in the World lane; notes board drag between columns; note tags | slices 10 and 14 shipped v1 | 1-2 days |
| Import: open a .starline directly, per-entity issue report, DOCX or manuscript file input for the split wizard | slice 12 shipped paste plus JSON and zip | 1-2 days |
| Published JSON-Schema for the export format (schema/export-v1.schema.json) | spec 4.5.2 | 2-3 h |
| Downgrade policy: a newer file opens read-only with 'Update StarLine to edit' (it throws today) | spec 4.5.5 | 2-3 h |

## Tier 3 - spec detail, low value on a phone

- The desktop keyboard map (4.7); the phone pivot (decision 6) makes most of it moot, and the PWA shortcuts that exist are the manifest ones.

- Dashboard extras: form and genre chips, deadline countdown, lore/note counts (the data exists, the UI does not).

- Creation flow extras: genre chips, form picker, target-word presets, deadline, idea seed, method cards, sample project, coach-marks tour.

- First-run onboarding wizard, and the module visibility it would set.

- Character list: avatars, scene counts, pinning, filters, sorts.

- Bundled 200-entry trait list with autocompletion.

- Statistics strip in the Scenes tab (stacked bars, distributions, pace chart).

- Scene editor: draft text collapsed in-sheet, location picker, rich-text synopsis with mentions.

- Export: user-configurable scene separator, HTML images as data URIs, Markdown mentions as wiki-links.

- Consistency: factions with no members; duplicate-name trigram similarity (a Levenshtein version ships).


## Superseded by owner decisions - not gaps

- de and ru locales (decision 20: en and uk only).

- The desktop rail and inspector shell with its toggles (decision 6: phone pivot).

- ICU message format via react-intl or lingui (a typed custom runtime ships; the capability is there).

- Ctrl+Shift+I global quick capture (decision 21: the PWA manifest shortcut instead).

- The native 'where to save' dialog (libraries live in OPFS and app-scoped storage).


## Known and tracked - already on the list

- Corkboard/card view of the outline (M1's outliner corkboard, and Fabula parity).

- World category drag-nest.

- Multi-book UI (a second book inside one library).

- Timeline wide-zoom clustering.

- The accessibility sign-off line (owner reads docs/ACCESSIBILITY.md).

- The PWA's authorized JavaScript origins in the Google console.


## Corrections to the record

An earlier pass claimed the **HTML export** was missing. It is not: `buildHtml`
(packages/core/src/interchange/manuscript.ts:265) ships, and `html` is in the export dialog's
FORMAT_ORDER. What is missing is only its sub-feature (images as data URIs) and E2E coverage.
Separately, docs/PLAN.md still lists the slice-3 `reviewedCharacterIds` stub as remaining; it
is implemented in Step5Editor.tsx, and that line is stale.

## The full sweep

Every item the independent pass found, with its spec line and evidence (92 total):

| Spec line | Feature | Evidence |
| --- | --- | --- |
| 1092 | Module visibility (ProjectSettings.enabledModules) | rg enabledModules: defined and defaulted in packages/core/src/settings.ts:37,69 but read by nothing; apps/web/src/TabBar.tsx:4-10 is a static 5-tab const and SettingsScreen has no module toggles. |
| 1098 | Dashboard project card: form + genre chips | PlanScreen.tsx:156-167 renders title/steps/ProgressRing only; no read of project.form or project.genres anywhere in apps/web (rg genres\|.form: 0 hits) and i18n has no genre/form labels. |
| 1098 | Dashboard counts: lore + notes | getDashboardStats returns loreCount/noteCount (snowflake/queries.ts:139-140,229-232) but PlanScreen.tsx:237 renders messages.dashboard.counts = '{characters} characters · {scenes} scenes' (en.ts:588). |
| 1098 | Dashboard deadline countdown | rg deadline in apps/web/src: 0 hits; project.deadline (0001_init.sql:26) is written only by the interchange import (interchange/read.ts:23, write.ts). |
| 1100 | First-run onboarding/creation wizard (chained screens 1-6, resumable, skippable) | rg firstRun\|onboard\|wizard in apps/web/src: none; StartScreen.tsx is a library picker and project creation is a single title input (PlanScreen.tsx:115-153). |
| 1104 | 'Try sample project' button on Welcome | StartScreen.tsx:99-188 offers create/import/open only; rg -i 'sample project' repo-wide matches only docs/SPECIFICATION.md:1104; no sample generator in core or web. |
| 1106 | Genre chips at creation (max 8, seeded list of 30) | rg -i genre in apps/web + packages/core/src: only the raw column and interchange; CreateProjectArgs = {title, form?, method?} (snowflake/commands.ts:29-32); useCreateProject sends title only (data.ts:234-242). |
| 1106 | Form picker (novel/novella/...) at creation | StoryForm exists (entities.ts:27-33) and createProject defaults form='novel' (commands.ts:52), but no web UI sets or shows it (rg '.form' apps/web: 0 hits). |
| 1106 | Target word-count presets (20k/50k/80k/120k/custom) | No project-level setter: rg targetWordCount in apps/web shows display reads (PlanScreen.tsx:247, Step8Editor.tsx:101) and per-scene edits only; no command writes project.target_word_count after creation. |
| 1106 | Optional deadline at creation | CreateProjectArgs (snowflake/commands.ts:29-32) has no deadline and the INSERT omits the column; rg deadline in apps/web: 0 hits. |
| 1107 | Method cards - Snowflake vs Freeform (blank outliner) | PlanningMethod + project.method exist (entities.ts:35; commands.ts:30,52) but no UI chooses a method and no Freeform branch exists anywhere in apps/web (rg method: 0 hits). |
| 1108 | Idea seed (inline step 1, skippable) inside creation | Creation collects a title only (PlanScreen.tsx:115-153); Step1Editor is reachable only via /plan/step/$step after the project exists. |
| 1109 | Tour coach-marks (5) + meta.tour_done=1 | rg tour_done\|coach repo-wide matches only docs/SPECIFICATION.md:1109; no tour component, overlay or meta write in apps/web/src or packages/core/src. |
| 1111 | Resumable wizard state in app prefs + skip controls | No wizard progress is stored (localStorage keys are locale/typography/theme/daily/search only) and no creation screen has a skip control. |
| 1134 | Validation issues clickable -> focus the field | IssueList.tsx renders blocking issues as plain <li> (:25-29) and warnings as <li> + ignore checkbox (:39-56); no onClick/ref/focus wiring (rg focusField\|scrollIntoView tied to issues: none). |
| 1136 | Step 3 card: one-paragraph field | Step3Editor.tsx CharacterCard renders name/role/major/motivation/goal/conflict/epiphany/one-line; the step3 i18n block (en.ts:101-115) has no one-paragraph key; oneParagraphText is edited only in CharacterScreen.tsx:211-218. |
| 1138 | Step 8 spreadsheet-style grid + keyboard cell navigation (arrows/Enter/Tab) | Step8Editor.tsx:464 renders <div class='sl-card sl-scene-row'> lists, not a grid; the only key handler is Enter->blur on the one-line input (:502-504); no arrows/Enter-edit/Tab-cell model. |
| 1138 | Step 8 paste-from-clipboard: CSV (comma) parsing | packages/core/src/scenes/parse.ts splitCells (:60-62) splits only on tab and pipe; executing parseSceneList on a comma line returns one unparsed cell while the TSV form parses correctly. |
| 1141 | Edge case: deleting a referenced character shows '1 major character removed' and prunes majorCharacterIds | rg 'character removed' repo-wide: nothing; deleteCharacter (characters/commands.ts:155) soft-deletes only; validators.ts:129 comments deleted characters are ignored, not flagged. |
| 1147 | Character list cards: avatar/initials, scene count, pin icon; grid/table layout | PeopleScreen.tsx:160-192 is a single-column <ul>; card = colour dot, name, one-line, sl-rel-count chip, role chip; no avatar/initials, no scene count, no pin control (character.pinned exists, 0001_init.sql:74). |
| 1148 | Character filters: role, tag, 'appears in chapter X', 'not in any scene' | PeopleScreen.tsx:64-75 filters by name/alias substring plus one 'no relationships' checkbox; no role/tag/chapter/no-scene filter in the file or i18n. |
| 1148 | Character sorts: manual (drag), name, role, first appearance, scene count | No sort control in PeopleScreen; list is fixed ORDER BY order_key (characters/queries.ts:41); dnd-kit is imported only by ScenesScreen. |
| 1150 | Merge duplicate characters (select 2 -> Merge into..., undoable, rewrites mentions, auto-snapshot) | characters/commands.ts registers create/update/delete only - no merge command and no mention rewrite; PeopleScreen has no multi-select; the only merge is tags (tags/commands.ts). |
| 1155 | Dossier header: avatar image, aliases editor, pin toggle | CharacterScreen.tsx:95-107 header is back-button + name; ImageSlot (Gallery.tsx:264) is used only by LoreSheet.tsx:403; aliases are written only by the CSV importer; no character pin control. |
| 1157 | Dossier tab set (Overview/Psychology/Story/Appearance/Backstory/Voice/Relationships/Appearances/Gallery/Custom) | CharacterScreen.tsx:93-241 is one flat form with no tablist (role=tab exists only in NotesScreen.tsx:246) and no per-tab routes. |
| 1163 | Psychology tab fields (Want/Need, Lie<->Truth, flaws/strengths/fears/values chips, internal/external conflict, ghost/wound) | Columns exist (0001_init.sql:66-71) but UPDATABLE_COLUMNS (characters/commands.ts:62-80) cannot write them and no component in apps/web reads them. |
| 1163 | Bundled 200-entry editable trait list with autocompletion | rg -i trait across packages/core/src + apps/web/src: only a lore template {label:'Traits'} (lore/types.ts:175); no trait catalogue file and no combobox/autocomplete component. |
| 1164 | Story tab: step-5 storyline + 3-point arc strip (Start->Midpoint->End) | CharacterScreen never renders storyline (rg storyline there: 0 hits; it is edited only in Step5Editor.tsx:153-204); no start/midpoint/end columns or arc-strip UI exists. |
| 1165 | Appearance / Backstory / Voice tabs (rich text + @mentions; Voice 'sample lines') | appearance_json/backstory_json/voice_notes_json exist (0001_init.sql:71-72) but no component edits them; rg sampleLines\|'sample lines': no feature. |
| 1167 | Appearances tab (scenes grouped by chapter, first/last appearance, POV-share %) | No per-character appearances query: scene_character is read only for shared-scene pairs (relationships/queries.ts:179-210) and scene POV lists; nothing aggregates first/last or POV share. |
| 1168 | Gallery: set-as-avatar action and editable captions | setEntityImage/ImageSlot is wired only for lore (LoreSheet.tsx:403); no code sets target 'character'. No caption edit UI: rg caption in Gallery.tsx returns display strings only (:41,46,48,92) while attachGallery accepts a caption the UI never passes. |
| 1169 | Custom tab on the character dossier (fields grouped by section) | CustomFieldsSection (CustomFields.tsx:153-203) is imported only by LoreSheet and SceneSheet; FIELD_TARGETS includes 'character' and Settings offers it, but CharacterScreen renders no custom fields. |
| 1173 | Import/export of custom field sets as JSON ('Character template packs') | rg 'template pack' repo-wide: nothing; field defs travel only inside the whole-project interchange bundle (interchange/types.ts fieldDefs); no import/export control in SettingsScreen. |
| 1178 | Radial layout around a selected character | rg -i radial in apps/web + packages/core/src: only Starfield.tsx:104; RelationshipGraph runs a single d3-force + group worker layout with no layout selector. |
| 1179 | Create edge by dragging from a node handle (+popover) and 'E' with two nodes selected | RelationshipGraph.tsx:402-418 wires no onConnect/onConnectEnd; Handles exist only so xyflow can attach existing edges; no node-selection state and no 'e' key handler. |
| 1181 | Export relationship matrix as CSV | rg -i 'csv\|export' in relationships/matrix.ts and RelationshipMatrix.tsx: 0 hits; ExportScreen has no matrix option. |
| 1182 | Selection inspector (dossier snippet, edge list, shared scenes) | No selection panel in RelationshipGraph (no onNodeClick); the shared-scene count is rendered only inside the edge sheet (EdgeSheet.tsx:206-213). |
| 1184 | Large-graph degradation (>300 nodes: labels hidden until zoom>=1.0, canvas-rendered circles) | No thresholds/zoom gating/canvas fallback in apps/web/src/relationships (rg 300\|1000\|zoom: only a doc comment); edge labels are always rendered (RelationshipGraph.tsx:242) and nodes are DOM elements. |
| 1208 | Outliner multi-select + bulk actions (set status/POV/tag/plotline, move to chapter, delete) | ScenesScreen.tsx has no selection state and no bulk command; rg shiftKey\|ctrlKey\|selectedIds\|bulk in apps/web: nothing (also absent from the known-carryover card view). |
| 1210 | Outliner filters/dimming by POV/status/tag/plotline/character/location + saved filters | ScenesScreen.tsx has no filter UI (only structural chapter grouping, :116-120); rg savedFilter\|starline.filter: nothing; the only search surface is the global SearchSheet. |
| 1215 | Outline list: inline editable columns, Location + Plotlines columns, column chooser, group-by POV/status, virtualization | ScenesScreen.tsx:454-487 rows are read-only buttons (#/title/POV/status/words) that open SceneSheet; no column chooser or group-by; @tanstack/react-virtual is imported only by RelationshipMatrix.tsx. |
| 1215 | Outline list keyboard: arrows/Enter edit, Tab/Shift+Tab scene<->chapter promotion, Alt+Up/Down reorder | No key handlers on rows (rg event.key in ScenesScreen: only the new-chapter/rename inputs); reorder is dnd-kit drag + the row menu; rg indent\|outdent\|promoteScene: no such command or UI. |
| 1223 | Scene editor: Location as a lore picker | SceneSheet.tsx:248-253 renders Location as a read-only chip of detail.locationName; locationId is read into the draft (:37) but no control ever sets it. |
| 1223 | Scene editor: Lore touched multi-picker | SceneSheet.tsx:450-453 renders a static placeholder ('No lore entries yet - the World tab arrives in a later slice.'); useSetSceneLore (data.ts:419) is imported nowhere. |
| 1223 | Scene editor: Synopsis (rich text, @mentions) | No synopsis control in SceneSheet (draft carries it at :30/:48 but nothing renders messages.sceneSheet.synopsis); the only synopsis editor is Step9Editor.tsx:236, which passes no mentionables. |
| 1227 | Statistics strip (by-status stacked bar, POV distribution, est vs actual words, pace chart) | Scenes tab header shows only 'N scenes / ~words' (ScenesScreen.tsx:237-240); rg pace\|distribution\|stacked\|histogram\|sparkline: no chart code; the only <svg> is the Plan progress ring. |
| 1243 | Default lore seed tree: Geography sub-folders (Continents/Countries/Cities/Landmarks) and spec category names | DEFAULT_LORE_TAXONOMY (lore/types.ts:51-65) seeds 9 top-level categories with parent_id NULL (commands.ts:64-89); rg Continents\|Countries\|Landmarks hits only docs/SPECIFICATION.md; names History/Species/Items differ from History & Timeline/Species & Creatures/Items & Artifacts. |
| 1244 | Ctrl/Cmd+Shift+N - create a lore entry anywhere (with kind chooser) | rg shiftKey in apps/web/src: 0 hits; entry creation ships only as the World-tab form (WorldScreen.tsx:119-128, 272-289), taking kind from the category's defaultKind with no kind picker. |
| 1245 | Lore tag-based filtering (tag multi-select AND/OR, kind filter, orphans only, pinned) | WorldScreen.tsx filters by category plus substring search only (:88-102, 204-210); rg orphan\|tagFilter\|selectedTags\|matchAll: nothing; pinned renders a marker with no filter. |
| 1245 | Lore result view toggles (list / cards with image / map with coordinates pins) | WorldScreen renders one list (:291-341); rg coordinates in apps/web: no reader/writer of lore_entry.coordinates (0001_init.sql:180); no map-image upload or pin rendering. |
| 1246 | @mention picker: fuzzy trigram matching + recency weighting | RichTextEditor.tsx:197-200 filters by label.includes(query).slice(0,8); listMentionables (lore/queries.ts:234-264) returns alphabetical/order-key/updated_at lists with no scoring. |
| 1246 | Mention chip hover-preview card (summary + image) | EntityMention (RichTextEditor.tsx:24-50) renders id/type/label attrs only - no hover/tooltip/popover; Mentionable carries no summary or image field. |
| 1246 | Typed EntityLinks (member_of, located_in, ...) with a Links section and inverse labels | entity_link (0001_init.sql:202-207) has no writer in packages/core/src; LoreSheet has no Links section; backlinks.ts reads only the mention table; rg member_of\|located_in hits only entities/checks/spec. |
| 1246 | Backlinks for @mentions of scenes and notes | Mentions mirror only targetType 'character'\|'lore' (lore/mentions.ts:11,24-44); BacklinksPanel accepts only lore\|character and is mounted only in LoreSheet.tsx:411 and CharacterScreen.tsx:231. |
| 1246 | @mention autocomplete in every rich-text field | mentionables= is passed only by LoreSheet.tsx:390, CustomFields.tsx:194, NoteSheet.tsx:303, WriteScreen.tsx:292; the scene synopsis (Step9Editor) and the step 4/5/6 editors pass none. |
| 1247 | Rename safety: mention chips resolved at render time | RichTextEditor stores the label in node attrs at insert (:201-217) and renders attrs.label (:39-49); no code re-resolves mention labels on rename (rg resolve/relabel/rename: none). |
| 1249 | Consistency check 'factions with no members' | checks.ts:103-127 flags factions with no entity_link rows and comments it is 'the honest version until entity_link gets its editor'; no member_of rule exists or can run. |
| 1250 | Large-document support: >150k-char 'large entry' banner + size handling | rg 150000\|150_000\|'large entry' in apps/web + packages/core/src: nothing; RichTextEditor renders the whole document with no guard. |
| 1254 | Timeline World lane includes lore history events | getTimeline (timeline/queries.ts:174-185) builds worldItems from timeline_event lane='world' rows only; no query reads lore_entry kind='history_event'; EventSheet has no lore-entry field (loreEntryId exists only in core commands). |
| 1259 | Notes board: drag between Inbox/Incubating/Used/Archived columns | NotesScreen.tsx moves notes only via the row menu (moveNote); no drag handlers in the file (dnd/draggable appear in ScenesScreen, TimelineView, Gallery, graph). |
| 1259 | Notes list filters by tag (notes cannot be tagged at all) | NotesScreen filters = kind select, pinned checkbox, text search; TagPicker is wired for character/lore/scene only; no entity_tag writes exist for notes. |
| 1271 | Markdown export: mentions as [[wiki-links]] in bodies | markdown.ts emits mentions only as a frontmatter array (mentionsOf :162-178); bodies render chips as plain label text (richtext.ts:51-53); rg '[[' in markdown.ts matches TS tuples only. |
| 1272 | Published export JSON-Schema (/schema/export-v1.schema.json) | find -iname '*schema*' (excluding node_modules/target): no such file; rg export-v1 hits only docs/SPECIFICATION.md; validation is hand-written (interchange/json.ts:57-121). |
| 1274 | HTML export: embedded images as data URIs | buildHtml (manuscript.ts:265-336) emits escaped text only; rg data:image\|toDataURL\|dataUri hits only Capacitor deviceStorage base64; attachments never reach the HTML builder. |
| 1275 | User-configurable scene separator for the text/markdown manuscript | sceneSeparator is code-only (manuscript.ts:10-12, hard-coded '#'/'***'); the export dialog builds options from includeSynopsis/includeBody/status only (ExportScreen.tsx:99-108). |
| 1279 | Export dialog scope: selected chapters | ExportOptions.chapterIds (export/build.ts:36-37) is never set by any caller; the dialog's only scope control is a status select (ExportScreen.tsx:293-308). |
| 1279 | Export dialog options: include notes / include trashed | ExportScreen renders exactly two checkboxes (includeSynopsis, includeBody); includeNotes is declared but never read (manuscript.ts:14, build.ts:35); readProjectExport always filters deleted_at IS NULL (read.ts:111). |
| 1279 | Export dialog: preview of the first 2 pages | ExportScreen flows preset -> status -> options -> Export/Cancel; the only 'preview' is the manuscript split preview (:545); build.ts/export.worker.ts return final bytes only. |
| 1279 | Export progress bar | The worker posts only 'building'/'packing' stage strings (export.worker.ts:14-32), shown as button text (ExportScreen.tsx:337); rg progress: no bar/percent/<progress> element. |
| 1285 | Import: open a *.starline file directly | StartScreen.tsx:142 accepts '.json,.zip' only; no Android intent filter for .starline; the byte-level replacePoolFile path is used only by snapshot restore (snapshots.ts:313). |
| 1286 | Import: per-entity issue report | ImportReport.issues is collected (interchange/write.ts:283-347) but StartScreen.tsx:71-72 renders only '{library}: {N} rows imported'; rg '.issues' in apps/web: no consumer. |
| 1288 | Manuscript import: DOCX (and file) input for the split-into-chapters/scenes wizard | The split wizard is a paste-only textarea (ExportScreen.tsx:481-492); no .txt/.md/.docx input and no DOCX reader (interchange/docx.ts is an export writer). |
| 1294 | Snapshot triggers: before migration / before import / before bulk delete | rg 'takeSnapshot(' callers: only 'open', 'activity', 'manual', 'pre_restore' (snapshots.ts:342,355,305; PlanScreen.tsx:308; BackupsScreen.tsx:168); emptyTrash, importLibrary and runMigrations take no snapshot (reasons exist only in types/i18n). |
| 1294 | Manual 'Snapshot now' with a label | Both manual buttons call takeSnapshot('manual') with no label (PlanScreen.tsx:308, BackupsScreen.tsx:168) and neither has a label input; the label param is only supplied by the pre-restore guard (snapshots.ts:305). |
| 1295 | Configurable snapshot retention | DEFAULT_RETENTION is fixed (snapshots/types.ts:65-70) and every caller uses the default (snapshots.ts:239-250); rg retention in apps/web: nothing. |
| 1298 | Integrity check runs monthly | assessSessionHealth runs driver.integrityCheck only inside the open sequence (health.ts:38-65, storage.ts:180-183); no monthly schedule or last-check timestamp (rg -i monthly: none). |
| 1298 | Integrity failure: offer 'Recover from latest snapshot' / .recover extraction | The banner only advises taking a snapshot (en.ts:510-511, AppLayout.tsx:81-95); rg 'Recover from latest snapshot'\|'.recover': no such action exists. |
| 1302 | TS-side migrations via MigrationContext in the same transaction | rg MigrationContext hits only docs/SPECIFICATION.md:1302; the runner applies raw SQL strings in one transaction (packages/db/src/migrate.ts:27-33) with no TS/JSON-reshape hook. |
| 1304 | Per-migration property tests (random DBs at N-1, foreign_key_check, export/import idempotency) | fast-check is declared in package.json but imported nowhere; migration tests are fixed scenarios (packages/db/src/testing/contract.ts:97-150); no PRAGMA foreign_key_check appears in tests. |
| 1305 | Downgrade: opening a newer file opens read-only with 'Update StarLine to edit' | migrate.ts:19-24 throws instead of opening read-only; openLibrary always opens readOnly:false (storage.ts:148); the only read-only runner is the snapshot preview. |
| 1309 | Appearance settings: font family from 3 bundled families + editor width | Settings Appearance holds only the starfield toggle (SettingsScreen.tsx:599-618); writing mode offers serif on/off + size 14-24 (write/prefs.ts:10-17); no family picker and no editor-width control. |
| 1309 | Editor settings: smart quotes on/off, auto-pair, spellcheck language | No Editor section exists (SettingsScreen.tsx:38 Section = tags\|fields\|language\|appearance\|cloud); rg smart.?quote\|auto.?pair\|spellcheck: no feature code. |
| 1309 | Privacy panel: 'This app makes no network requests' with a verifiable status line | No privacy section in Settings; the status line exists only inside the cloud panel (messages.cloud.off, en.ts:273, CloudPanel.tsx). |
| 1309 | Opt-in update check that fetches only a version JSON | rg update.?check\|version.json\|checkForUpdate in apps/web, packages/core/src and scripts: nothing; no Settings toggle and no version-fetch path. |
| 1311 | RTL layout via logical CSS properties | styles.css has 2 logical declarations (inset-inline, :192,:294) against ~10 physical directional ones; rg 'rtl\|dir=' in styles.css/main.tsx/App.tsx: no direction handling. |
| 1319 | Ctrl/Cmd+N - context-aware new (scene/character/lore) | rg ctrlKey\|metaKey\|altKey\|shiftKey across apps/web/src: 0 hits; creation is on-screen buttons only (PlanScreen.tsx:131-138, ScenesScreen.tsx:270, WorldScreen.tsx:262-287). |
| 1320 | Ctrl/Cmd+1...9 - switch module | No modifier-key handler anywhere (rg ctrlKey\|metaKey\|altKey: 0 hits); TabBar navigates by pointer via TanStack <Link>. |
| 1321 | ] / [ - next/previous Snowflake step (also required at 4.1, L1132) | No keydown handler in StepScreen.tsx or PlanScreen.tsx; rg BracketLeft\|BracketRight: none; steps open by clicking .sl-step-row. |
| 1322 | 1 / 2 / 3 - corkboard/outline/plotline-grid switch | ScenesScreen.tsx:70 holds a list/grid mode toggled by buttons (:249); no digit-key handler exists (rg event.key: Escape/Enter/arrows only). |
| 1323 | Alt+Up / Alt+Down - move selected item | rg altKey: 0 hits; reordering is drag (dnd-kit) plus the row menu (moveSceneBy); no Alt-arrow keyboard path. |
| 1326 | Ctrl/Cmd+Shift+F - distraction-free mode | WriteScreen.tsx:357-364 has a focus-mode button and its only key handler is Escape (:175-179); no Ctrl+Shift+F binding (rg ctrlKey\|metaKey\|shiftKey: 0 hits). |
| 1327 | Ctrl/Cmd+Alt+S - Snapshot now | Snapshots trigger only from the dashboard button (PlanScreen.tsx:308), the automatic timers and the Backups screen; rg ctrlKey\|altKey: 0 hits. |

### Judgement calls (not counted as gaps)

- **Desktop >=1024 px shell: left rail (collapsible), centre workspace, resizable right inspector (300-420 px, remembers per-view) - spec L1077** - Phone-first pivot (docs/DECISIONS.md decisions 6 and 17) replaces this with an app bar + five-tab bar + sheets; rg sl-rail|sidebar|inspector in apps/web/src: nothing. Not counted as a gap because the pivot may override the desktop wording.
- **Fixed nine-item rail order (Dashboard/Snowflake/Characters/Relationships/Outliner/Timeline/World/Notes/Export) - spec L1092** - Shipped navigation is the five-tab model (TabBar.tsx:4-10: Plan/Scenes/People/World/Notes) accepted in decision 17; Relationships lives inside People, Timeline inside World. Override question, not counted as a gap.
- **Screen 2 'Where to save' native save dialog defaulting to ~/Documents/StarLine/<title>.starline - spec L1105** - Desktop-only; libraries live in the OPFS sahpool (storage.ts) and Android writes exports to the app-scoped files dir (deviceStorage.ts, decision 20). No save/open dialog code exists.
- **Steps 4/6 'side-by-side source sentence -> your paragraph' layout - spec L1137** - The pinned collapsible source header exists (<details class='sl-source' open>, Step4Editor.tsx:118-125, Step6Editor.tsx) but the layout is stacked, plausibly the phone adaptation.
- **i18n launch locales de + ru - spec L1311** - Absent by owner override: docs/DECISIONS.md decision 20 - 'Languages: English + Ukrainian. No Russian, no German at launch.' availableLocales = ['en','uk'] (i18n/index.ts:12). Listed so the parent can confirm the override covers it.
- **Ctrl/Cmd+Shift+I global quick capture - spec L1258/L1318** - No binding exists; decision 21 substitutes the PWA manifest 'Quick capture' shortcut (#/notes?capture=1, vite.config.ts:104-110) which loads the full app view. Whether that satisfies the spec's 'global shortcut' is a judgement call.
- **Ctrl+Z / Ctrl+Shift+Z undo/redo in the keyboard map - spec L1325** - Text undo/redo works via TipTap StarterKit defaults, but the structural undo stack (undo.ts) is undo-only via the UndoToast button; no keyboard path for structural undo/redo.
- **Ctrl+period / Ctrl+backslash - toggle inspector / rail - spec L1328** - No rail or inspector exists in the phone shell (sheets instead), so the toggle target is absent; same pivot question as L1077.
- **ICU message format with react-intl/lingui - spec L1311** - Custom runtime instead: format() is a {placeholder} replacer and plural() uses Intl.PluralRules over PluralForms (i18n/index.ts:58-81); no react-intl/lingui/i18next dependency and no ICU syntax. Capability present, format not ICU.
- **Duplicate-name check via trigram similarity >= 0.8 - spec L1249** - Implemented as Levenshtein edit distance <=1/2 (search/text.ts nearDuplicatePairs :149-167); the check exists with a different algorithm.
- **Plotline grid columns 'grouped by chapter' - spec L1219** - Chapter title appears only in the cell tooltip (PlotlineGrid.tsx); the header is one flat sticky row even though the query returns chapterTitle/partTitle. Partial.
- **Fabula paste-in 'documented template' - spec L1289** - No template document exists (rg -i fabula in apps/web + packages/core/src: nothing; docs has no import guide/CSV template); docs/PLAN.md:773 defers Fabula import out of v1. Paste surfaces themselves exist.
- **PDF via the system print dialog from the HTML export - spec L1277** - No in-app print action (rg window.print: none), but the HTML export carries print CSS (@media print, manuscript.ts:325) so Save-as-PDF works from the exported file; desktop wording.
- **Scene editor 'Draft text (collapsed by default)' - spec L1223** - No draft-text field in SceneSheet; a Write button (:167-177) opens the distraction-free /write/$sceneId editor, so 'Write opens the distraction-free editor' is met but the collapsed in-sheet draft field is not.
- **Stepper lives inside the wizard view - spec L1132** - The glyph stepper is rendered on the Plan dashboard (PlanScreen StepRow :405-428); StepScreen.tsx shows only 'Step n of 9' + back. Functionally present, not in the wizard layout the spec draws.

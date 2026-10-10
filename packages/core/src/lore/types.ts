import type { CustomFieldType, LoreKind } from "../entities";
import type { EpochMs, HexColor, OrderKey, UUID } from "../primitives";
import type { RichText } from "../richtext";

/** Worldbuilding bible (spec §3.7). Slice 6: categories, entries, kind templates, mentions.
 * The `LoreKind` union lives in `entities.ts` (spec §3.1); this module adds the runtime list. */

export const LORE_KINDS: readonly LoreKind[] = [
  "location",
  "faction",
  "magic_system",
  "technology",
  "geography",
  "history_event",
  "culture",
  "religion",
  "politics",
  "economy",
  "species",
  "language",
  "item",
  "organization",
  "antagonistic_force",
  "custom",
];

export const LORE_NAME_MAX = 160;
export const LORE_SUMMARY_MAX = 280;
export const LORE_ALIASES_MAX = 10;

export const LORE_KIND_GLYPHS: Record<LoreKind, string> = {
  location: "⌖",
  faction: "⚑",
  magic_system: "✶",
  technology: "⚙",
  geography: "⛰",
  history_event: "◷",
  culture: "☘",
  religion: "✦",
  politics: "⚖",
  economy: "◈",
  species: "❋",
  language: "✎",
  item: "◆",
  organization: "⬡",
  antagonistic_force: "☄",
  custom: "✧",
};

/** The seeded category tree (PLAN slice 6): nine folders, each with a default entry kind. */
export const DEFAULT_LORE_TAXONOMY: readonly {
  name: string;
  icon: string;
  defaultKind: LoreKind;
}[] = [
  { name: "Geography", icon: "⛰", defaultKind: "geography" },
  { name: "Factions & Organizations", icon: "⚑", defaultKind: "faction" },
  { name: "Magic & Technology", icon: "✶", defaultKind: "magic_system" },
  { name: "History", icon: "◷", defaultKind: "history_event" },
  { name: "Cultures & Religions", icon: "☘", defaultKind: "culture" },
  { name: "Politics & Economy", icon: "⚖", defaultKind: "politics" },
  { name: "Species", icon: "❋", defaultKind: "species" },
  { name: "Items", icon: "◆", defaultKind: "item" },
  { name: "Languages", icon: "✎", defaultKind: "language" },
];

/** Kind-specific field templates (spec §3.7 table) — seeded into `custom_field_def` lazily,
 * the first time an entry of that kind is created, and editable from the Fields screen (S9). */
export const LORE_KIND_TEMPLATES: Record<
  LoreKind,
  readonly {
    label: string;
    type: CustomFieldType;
    options?: readonly string[];
    entityRefTarget?: string;
  }[]
> = {
  location: [
    { label: "Region", type: "text" },
    { label: "Climate", type: "text" },
    { label: "Population", type: "number" },
    { label: "Ruler", type: "entity_ref", entityRefTarget: "character" },
    { label: "Notable sites", type: "longtext" },
  ],
  faction: [
    { label: "Goals", type: "longtext" },
    { label: "Leader", type: "entity_ref", entityRefTarget: "character" },
    { label: "Headquarters", type: "entity_ref", entityRefTarget: "lore" },
    { label: "Strength", type: "select", options: ["Minor", "Regional", "Major", "Dominant"] },
    { label: "Symbol / Colours", type: "text" },
  ],
  organization: [
    { label: "Goals", type: "longtext" },
    { label: "Leader", type: "entity_ref", entityRefTarget: "character" },
    { label: "Headquarters", type: "entity_ref", entityRefTarget: "lore" },
    { label: "Strength", type: "select", options: ["Minor", "Regional", "Major", "Dominant"] },
    { label: "Symbol / Colours", type: "text" },
  ],
  magic_system: [
    { label: "Source", type: "text" },
    { label: "Cost / limits", type: "longtext" },
    { label: "Who can use it", type: "longtext" },
    { label: "Rules", type: "longtext" },
    { label: "Known failures", type: "longtext" },
  ],
  technology: [
    {
      label: "Tech level",
      type: "select",
      options: [
        "Stone",
        "Bronze/Iron",
        "Medieval",
        "Industrial",
        "Modern",
        "Near-future",
        "Far-future",
      ],
    },
    { label: "Availability", type: "text" },
    { label: "Side effects", type: "longtext" },
  ],
  geography: [
    { label: "Terrain", type: "text" },
    { label: "Climate", type: "text" },
    {
      label: "Resources",
      type: "multiselect",
      options: ["Water", "Ore", "Timber", "Farmland", "Trade routes", "Wildlife"],
    },
    { label: "Hazards", type: "longtext" },
  ],
  history_event: [
    { label: "Era", type: "text" },
    { label: "Story date", type: "text" },
    { label: "Participants", type: "entity_ref", entityRefTarget: "any" },
    { label: "Consequences", type: "longtext" },
  ],
  culture: [
    { label: "Values", type: "longtext" },
    { label: "Traditions", type: "longtext" },
    { label: "Taboos", type: "longtext" },
    { label: "Language", type: "text" },
    { label: "Holidays", type: "longtext" },
  ],
  religion: [
    { label: "Values", type: "longtext" },
    { label: "Traditions", type: "longtext" },
    { label: "Taboos", type: "longtext" },
    { label: "Language", type: "text" },
    { label: "Holidays", type: "longtext" },
  ],
  politics: [
    {
      label: "Government form",
      type: "select",
      options: ["Monarchy", "Republic", "Theocracy", "Oligarchy", "Tribal", "Council", "Empire"],
    },
    { label: "Currency", type: "text" },
    { label: "Main trade", type: "text" },
    { label: "Law", type: "longtext" },
  ],
  economy: [
    {
      label: "Government form",
      type: "select",
      options: ["Monarchy", "Republic", "Theocracy", "Oligarchy", "Tribal", "Council", "Empire"],
    },
    { label: "Currency", type: "text" },
    { label: "Main trade", type: "text" },
    { label: "Law", type: "longtext" },
  ],
  species: [
    { label: "Lifespan", type: "text" },
    { label: "Traits", type: "longtext" },
    { label: "Home region", type: "entity_ref", entityRefTarget: "lore" },
  ],
  language: [
    { label: "Speakers", type: "text" },
    { label: "Family", type: "text" },
    { label: "Notes", type: "longtext" },
  ],
  item: [
    { label: "Kind", type: "text" },
    { label: "Powers", type: "longtext" },
    { label: "Owner", type: "entity_ref", entityRefTarget: "any" },
  ],
  antagonistic_force: [
    { label: "Nature", type: "text" },
    { label: "Threat level", type: "select", options: ["Local", "Regional", "Global", "Cosmic"] },
    { label: "Weakness", type: "longtext" },
  ],
  custom: [],
};

export interface LoreCategory {
  id: UUID;
  projectId: UUID;
  parentId: UUID | null;
  name: string;
  icon: string;
  color: HexColor | null;
  defaultKind: LoreKind | null;
  orderKey: OrderKey;
}

/** A category with its children resolved (built by `buildCategoryTree`). */
export interface LoreCategoryNode extends LoreCategory {
  children: LoreCategoryNode[];
  entryCount: number;
}

export interface LoreEntrySummary {
  id: UUID;
  projectId: UUID;
  categoryId: UUID | null;
  parentEntryId: UUID | null;
  kind: LoreKind;
  customKindLabel: string;
  name: string;
  aliases: string[];
  summary: string;
  pinned: boolean;
  orderKey: OrderKey;
  updatedAt: EpochMs;
}

export interface LoreEntryDetail extends LoreEntrySummary {
  body: RichText;
  /** The single-image slot (spec §3.1 `lore_entry.image_attachment_id`). */
  imageAttachmentId: UUID | null;
}

/** One @-mention candidate for the editor's picker (characters + lore entries). */
export interface Mentionable {
  id: UUID;
  type: "character" | "lore" | "scene" | "note";
  label: string;
  glyph: string;
  /** Kind label or character role, for the picker's second line. */
  detail: string;
}

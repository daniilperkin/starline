import {
  attachToGallery,
  type Backlinks,
  ChangeBus,
  type ChapterSummary,
  type CharacterPatch,
  type CharacterRole,
  type Command,
  type ConsistencyCheck,
  type CustomFieldTarget,
  copyLineToSceneSynopsis,
  countFieldValuesByDef,
  countNotesByStatus,
  countRelationshipsByCharacter,
  createChapter,
  createCharacter,
  createFieldDef,
  createLoreCategory,
  createLoreEntry,
  createNote,
  createPlotline,
  createProject,
  createRelationship,
  createRelationshipGroup,
  createScene,
  createScenesFromList,
  createTag,
  createTimelineEvent,
  deleteAttachment,
  deleteChapter,
  deleteCharacter,
  deleteFieldDef,
  deleteLoreCategory,
  deleteLoreEntry,
  deleteNote,
  deletePlotline,
  deleteProject,
  deleteRelationship,
  deleteRelationshipGroup,
  deleteScene,
  deleteTag,
  deleteTimelineEvent,
  detachFromGallery,
  type EntityType,
  emptyTrash,
  executeCommand,
  getContinueTarget,
  getDashboardStats,
  getGraphPositions,
  getLoreEntry,
  getNote,
  getPlotlineBalance,
  getPlotlineGrid,
  getRelationshipMatrix,
  getSceneBody,
  getSceneDetail,
  getTimeline,
  getTimelineCoverage,
  type LoreEntryPatch,
  type LoreKind,
  linkMention,
  listAllFieldDefs,
  listBacklinks,
  listChapters,
  listCharacterGallery,
  listCharacters,
  listEntityTags,
  listFieldDefs,
  listFieldValues,
  listLoreCategories,
  listLoreEntries,
  listMentionables,
  listNotes,
  listParts,
  listPlotlines,
  listPossibleMentions,
  listProjectAttachments,
  listProjects,
  listRelationshipGroups,
  listRelationships,
  listScenes,
  listSharedScenes,
  listStaleIdeas,
  listSteps,
  listTags,
  listTrash,
  markStepComplete,
  mergeTags,
  moveChapter,
  moveFieldDef,
  moveLoreCategory,
  moveLoreEntry,
  moveNote,
  moveScene,
  moveTimelineItem,
  type NoteKind,
  type NoteStatus,
  type PartSummary,
  type PossibleMention,
  promoteNote,
  purgeExpiredTrash,
  type RelationshipPatch,
  renameProject,
  renameTag,
  restoreEntity,
  restoreProject,
  runConsistencyChecks,
  type SceneSummary,
  type SearchResults,
  type SnowflakeStepContent,
  type SnowflakeStepNumber,
  saveStepContent,
  searchProject,
  seedLoreTaxonomy,
  setEditorLastScene,
  setEntityImage,
  setEntityTags,
  setFieldValue,
  setGraphPositions,
  setSceneBody,
  setSceneCharacters,
  setSceneLore,
  setScenePlacement,
  setScenePlotline,
  setSceneTags,
  setTagColor,
  type TrashEntityType,
  toggleEntityTag,
  type UUID,
  unlinkMention,
  updateChapter,
  updateCharacter,
  updateFieldDef,
  updateLoreEntry,
  updateNote,
  updateRelationship,
  updateRelationshipGroup,
  updateScene,
  updateTimelineEvent,
} from "@starline/core";
import type { TauriStorageDriver } from "@starline/driver-wasm";
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useSessionStore } from "./session";
import { listSnapshots, type SnapshotReason, takeSnapshot } from "./snapshots";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
});

/**
 * One bus per app instance. Every command publishes its ChangeEvents after commit; the
 * cache invalidation below is the only coupling between writes and reads (spec §2.3.1).
 */
const bus = new ChangeBus();
bus.subscribe(() => {
  void queryClient.invalidateQueries({ queryKey: ["projects"] });
  void queryClient.invalidateQueries({ queryKey: ["steps"] });
  void queryClient.invalidateQueries({ queryKey: ["characters"] });
  void queryClient.invalidateQueries({ queryKey: ["scenes"] });
  void queryClient.invalidateQueries({ queryKey: ["scene"] });
  void queryClient.invalidateQueries({ queryKey: ["plotlines"] });
  void queryClient.invalidateQueries({ queryKey: ["tags"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["trash"] });
  void queryClient.invalidateQueries({ queryKey: ["lore"] });
  void queryClient.invalidateQueries({ queryKey: ["fields"] });
  // Slice 7: a mention, a rename or a delete all change what search and the panels show.
  void queryClient.invalidateQueries({ queryKey: ["search"] });
  void queryClient.invalidateQueries({ queryKey: ["backlinks"] });
  void queryClient.invalidateQueries({ queryKey: ["possible"] });
  void queryClient.invalidateQueries({ queryKey: ["checks"] });
  // Slice 8: edges, groups and the manual pins all feed the matrix, the web and the dossier.
  void queryClient.invalidateQueries({ queryKey: ["relationships"] });
  void queryClient.invalidateQueries({ queryKey: ["relationshipCounts"] });
  void queryClient.invalidateQueries({ queryKey: ["sharedScenes"] });
  void queryClient.invalidateQueries({ queryKey: ["graphPositions"] });
  // Slice 9: tag chips, the settings lists and the plotline grid.
  void queryClient.invalidateQueries({ queryKey: ["entityTags"] });
  void queryClient.invalidateQueries({ queryKey: ["fieldDefs"] });
  void queryClient.invalidateQueries({ queryKey: ["plotlineGrid"] });
  void queryClient.invalidateQueries({ queryKey: ["plotlineBalance"] });
  // Slice 10: the timeline lanes, the tray and the conflict list.
  void queryClient.invalidateQueries({ queryKey: ["timeline"] });
  // Slice 13: writing a scene moves the resume target and the body count.
  void queryClient.invalidateQueries({ queryKey: ["editor"] });
  // Slice 14: notes, the incubator nudge and attachment galleries.
  void queryClient.invalidateQueries({ queryKey: ["notes"] });
  void queryClient.invalidateQueries({ queryKey: ["staleIdeas"] });
  void queryClient.invalidateQueries({ queryKey: ["gallery"] });
});

let lastActivityAt = Date.now();

/** Subscribes to command activity — the 15-minute snapshot trigger reads `lastActivityAt`. */
export function onActivity(listener: () => void): () => void {
  return bus.subscribe(() => {
    lastActivityAt = Date.now();
    listener();
  });
}

export function lastActivityTime(): number {
  return lastActivityAt;
}

export function runCommand<A, R>(
  driver: TauriStorageDriver,
  command: Command<A, R>,
  args: A,
): Promise<R> {
  return executeCommand({ transaction: (fn) => driver.transaction(fn) }, bus, command, args);
}

export function useProjects() {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["projects", session?.name ?? null],
    enabled: session !== null,
    queryFn: async () => {
      if (!session) throw new Error("no library open");
      return listProjects(session.driver);
    },
  });
}

export function useSteps(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["steps", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listSteps(session.driver, projectId);
    },
  });
}

export function useCreateProject() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (title: string) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, createProject, { title });
    },
  });
}

export interface SaveStepVariables {
  projectId: UUID;
  step: SnowflakeStepNumber;
  content: SnowflakeStepContent;
}

export function useSaveStep() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (variables: SaveStepVariables) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, saveStepContent, variables);
    },
  });
}

export function useCharacters(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["characters", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listCharacters(session.driver, projectId);
    },
  });
}

export interface CreateCharacterVariables {
  projectId: UUID;
  name: string;
  role?: CharacterRole;
}

export function useCreateCharacter() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (variables: CreateCharacterVariables) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, createCharacter, variables);
    },
  });
}

export interface UpdateCharacterVariables {
  projectId: UUID;
  characterId: UUID;
  patch: CharacterPatch;
}

export function useUpdateCharacter() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (variables: UpdateCharacterVariables) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, updateCharacter, variables);
    },
  });
}

export interface DeleteCharacterVariables {
  projectId: UUID;
  characterId: UUID;
}

export function useDeleteCharacter() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (variables: DeleteCharacterVariables) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, deleteCharacter, variables);
    },
  });
}

export interface CompleteStepVariables {
  projectId: UUID;
  step: SnowflakeStepNumber;
  overrides?: string[];
}

export function useCompleteStep() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (variables: CompleteStepVariables) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, markStepComplete, variables);
    },
  });
}

export interface SceneTree {
  parts: PartSummary[];
  chapters: ChapterSummary[];
  scenes: SceneSummary[];
}

/** Parts + chapters + scenes in one shot; ordering helpers live in the core. */
export function useSceneTree(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["scenes", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async (): Promise<SceneTree> => {
      if (!session || !projectId) throw new Error("no project open");
      // Sequential: the wasm driver funnels every statement through one worker.
      const parts = await listParts(session.driver, projectId);
      const chapters = await listChapters(session.driver, projectId);
      const scenes = await listScenes(session.driver, projectId);
      return { parts, chapters, scenes };
    },
  });
}

export function useSceneDetail(projectId: UUID | null, sceneId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["scene", session?.name ?? null, projectId, sceneId],
    enabled: session !== null && projectId !== null && sceneId !== null,
    queryFn: async () => {
      if (!session || !projectId || !sceneId) throw new Error("no scene open");
      return getSceneDetail(session.driver, projectId, sceneId);
    },
  });
}

export function usePlotlines(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["plotlines", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listPlotlines(session.driver, projectId);
    },
  });
}

export function useTags(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["tags", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listTags(session.driver, projectId);
    },
  });
}

/** One factory for the scene/chapter/plotline commands — they all take `{ projectId, … }`. */
function useSceneCommand<A, R>(command: Command<A, R>) {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: A): Promise<R> => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, command, args);
    },
  });
}

export const useCreateScene = () => useSceneCommand(createScene);
export const useUpdateScene = () => useSceneCommand(updateScene);
export const useDeleteScene = () => useSceneCommand(deleteScene);
export const useMoveScene = () => useSceneCommand(moveScene);
export const useCreateScenesFromList = () => useSceneCommand(createScenesFromList);
export const useCreateChapter = () => useSceneCommand(createChapter);
export const useUpdateChapter = () => useSceneCommand(updateChapter);
export const useMoveChapter = () => useSceneCommand(moveChapter);
export const useDeleteChapter = () => useSceneCommand(deleteChapter);
export const useCreatePlotline = () => useSceneCommand(createPlotline);
export const useDeletePlotline = () => useSceneCommand(deletePlotline);
export const useSetSceneCharacters = () => useSceneCommand(setSceneCharacters);
export const useSetScenePlotline = () => useSceneCommand(setScenePlotline);
export const useSetSceneTags = () => useSceneCommand(setSceneTags);
export const useSetSceneLore = () => useSceneCommand(setSceneLore);
export const useSetScenePlacement = () => useSceneCommand(setScenePlacement);
export const useCopyLineToSynopsis = () => useSceneCommand(copyLineToSceneSynopsis);

// ---- Slice 13: writing mode --------------------------------------------------------------

/** The draft body, fetched once per open — the editor owns it from then on. */
export function useSceneBody(projectId: UUID | null, sceneId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["sceneBody", session?.name ?? null, projectId, sceneId],
    enabled: session !== null && projectId !== null && sceneId !== null,
    queryFn: async () => {
      if (!session || !projectId || !sceneId) throw new Error("no scene open");
      return getSceneBody(session.driver, projectId, sceneId);
    },
  });
}

/** Where "continue writing" lands: the last scene, else the next unwritten one. */
export function useContinueTarget(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["editor", "continue", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return getContinueTarget(session.driver, projectId);
    },
  });
}

export const useSetSceneBody = () => useSceneCommand(setSceneBody);
export const useSetEditorLastScene = () => useSceneCommand(setEditorLastScene);

// ---- Slice 9: tags, field definitions, plotline grid -------------------------------------

export const useCreateTag = () => useSceneCommand(createTag);
export const useRenameTag = () => useSceneCommand(renameTag);
export const useSetTagColor = () => useSceneCommand(setTagColor);
export const useDeleteTag = () => useSceneCommand(deleteTag);
export const useMergeTags = () => useSceneCommand(mergeTags);
export const useSetEntityTags = () => useSceneCommand(setEntityTags);
export const useToggleEntityTag = () => useSceneCommand(toggleEntityTag);

/** One entity's tags — the picker's checked state and the chips row. */
export function useEntityTags(entityType: EntityType, entityId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["entityTags", session?.name ?? null, entityType, entityId],
    enabled: session !== null && entityId !== null,
    queryFn: async () => {
      if (!session || !entityId) throw new Error("no entity");
      return listEntityTags(session.driver, entityType, entityId);
    },
  });
}

/** Settings -> Fields: every definition with its usage count, whatever the target. */
export function useFieldDefsAdmin(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["fieldDefs", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      const [defs, usage] = await Promise.all([
        listAllFieldDefs(session.driver, projectId),
        countFieldValuesByDef(session.driver, projectId),
      ]);
      return defs.map((def) => ({ ...def, usage: usage.get(def.id) ?? 0 }));
    },
  });
}

export const useCreateFieldDef = () => useSceneCommand(createFieldDef);
export const useUpdateFieldDef = () => useSceneCommand(updateFieldDef);
export const useMoveFieldDef = () => useSceneCommand(moveFieldDef);
export const useDeleteFieldDef = () => useSceneCommand(deleteFieldDef);

/** Plotline rows x scene columns with the `scene_plotline` cells. */
export function usePlotlineGrid(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["plotlineGrid", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return getPlotlineGrid(session.driver, projectId);
    },
  });
}

/** Balance statistics for the grid's header line. */
export function usePlotlineBalance(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["plotlineBalance", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return getPlotlineBalance(session.driver, projectId);
    },
  });
}

// ---- Slice 10: the timeline ---------------------------------------------------------------

export const useCreateTimelineEvent = () => useSceneCommand(createTimelineEvent);
export const useUpdateTimelineEvent = () => useSceneCommand(updateTimelineEvent);
export const useDeleteTimelineEvent = () => useSceneCommand(deleteTimelineEvent);
export const useMoveTimelineItem = () => useSceneCommand(moveTimelineItem);

/** Lanes, placed items, the no-time tray and the "two places at once" warnings. */
export function useTimeline(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["timeline", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return getTimeline(session.driver, projectId);
    },
  });
}

/** Placed vs unplaced scenes, for the header line. */
export function useTimelineCoverage(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["timeline", "coverage", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return getTimelineCoverage(session.driver, projectId);
    },
  });
}

/** Dashboard aggregates (counts, estimate, recent edits) for one project. */
export function useDashboardStats(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["dashboard", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return getDashboardStats(session.driver, projectId);
    },
  });
}

/** The Trash list for one project. */
export function useTrash(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["trash", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listTrash(session.driver, projectId);
    },
  });
}

export function useRestoreEntity() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: { projectId: UUID; entityType: TrashEntityType; entityId: UUID }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, restoreEntity, args);
    },
  });
}

export function useEmptyTrash() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: { projectId: UUID }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, emptyTrash, args);
    },
  });
}

export function usePurgeExpiredTrash() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: { projectId: UUID }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, purgeExpiredTrash, args);
    },
  });
}

/** Snapshot files for the open library (spec §4.5.3); newest first. */
export function useSnapshots() {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["snapshots", session?.name ?? null],
    enabled: session !== null,
    queryFn: async () => {
      if (!session) throw new Error("no library open");
      return listSnapshots(session.name);
    },
  });
}

export function useTakeSnapshot() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (reason: SnapshotReason) => {
      if (!session) throw new Error("no library open");
      const entry = await takeSnapshot(session, reason);
      await queryClient.invalidateQueries({ queryKey: ["snapshots"] });
      return entry;
    },
  });
}

/**
 * Dev-only test hook for scripts/chaos/web.mjs and scripts/verify-android.mjs: exposes the open
 * session's driver, the command set and the slice-7 reads, so the harnesses can drive random
 * writes, simulate mid-write crashes and measure the §5.1 budgets without going through the UI.
 * `import.meta.env.DEV` is statically false in production builds, so none of this ships; the
 * sideloaded QA APK is built with `VITE_STARLINE_DEV=1` to keep the hook available on-device
 * (the offline/no-network gate also stays green — no fetch anywhere).
 */
const chaosCommands: Record<string, Command<never, unknown>> = {
  createScene: createScene as Command<never, unknown>,
  updateScene: updateScene as Command<never, unknown>,
  deleteScene: deleteScene as Command<never, unknown>,
  moveScene: moveScene as Command<never, unknown>,
  createChapter: createChapter as Command<never, unknown>,
  createCharacter: createCharacter as Command<never, unknown>,
  saveStepContent: saveStepContent as Command<never, unknown>,
  restoreEntity: restoreEntity as Command<never, unknown>,
  setScenePlacement: setScenePlacement as Command<never, unknown>,
  createLoreEntry: createLoreEntry as Command<never, unknown>,
  updateLoreEntry: updateLoreEntry as Command<never, unknown>,
  deleteLoreEntry: deleteLoreEntry as Command<never, unknown>,
  seedLoreTaxonomy: seedLoreTaxonomy as Command<never, unknown>,
  linkMention: linkMention as Command<never, unknown>,
  unlinkMention: unlinkMention as Command<never, unknown>,
  createRelationship: createRelationship as Command<never, unknown>,
  updateRelationship: updateRelationship as Command<never, unknown>,
  deleteRelationship: deleteRelationship as Command<never, unknown>,
  createRelationshipGroup: createRelationshipGroup as Command<never, unknown>,
  deleteRelationshipGroup: deleteRelationshipGroup as Command<never, unknown>,
  setGraphPositions: setGraphPositions as Command<never, unknown>,
  createTag: createTag as Command<never, unknown>,
  renameTag: renameTag as Command<never, unknown>,
  deleteTag: deleteTag as Command<never, unknown>,
  mergeTags: mergeTags as Command<never, unknown>,
  setEntityTags: setEntityTags as Command<never, unknown>,
  toggleEntityTag: toggleEntityTag as Command<never, unknown>,
  createFieldDef: createFieldDef as Command<never, unknown>,
  moveFieldDef: moveFieldDef as Command<never, unknown>,
  deleteFieldDef: deleteFieldDef as Command<never, unknown>,
  setScenePlotline: setScenePlotline as Command<never, unknown>,
  setSceneCharacters: setSceneCharacters as Command<never, unknown>,
  createTimelineEvent: createTimelineEvent as Command<never, unknown>,
  updateTimelineEvent: updateTimelineEvent as Command<never, unknown>,
  deleteTimelineEvent: deleteTimelineEvent as Command<never, unknown>,
  moveTimelineItem: moveTimelineItem as Command<never, unknown>,
};

if (import.meta.env.DEV || import.meta.env.VITE_STARLINE_DEV === "1") {
  (window as unknown as Record<string, unknown>).__starlineDev = {
    session: () => useSessionStore.getState().session,
    run: (name: string, args: unknown) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      const command = chaosCommands[name];
      if (!command) throw new Error(`unknown chaos command: ${name}`);
      return executeCommand(
        { transaction: (fn) => session.driver.transaction(fn) },
        bus,
        command,
        args as never,
      );
    },
    /** Pool occupancy for e2e (capacity/fileCount/files) — snapshot temps must not leak slots. */
    poolStats: () => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return session.transport.request("pool_stats", {});
    },
    /** Slice-7 reads, straight off the driver, for the e2e journey and the perf check. */
    search: (projectId: string, query: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return searchProject(session.driver, projectId as UUID, query);
    },
    backlinks: (projectId: string, targetType: string, targetId: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return listBacklinks(session.driver, projectId as UUID, targetType, targetId as UUID);
    },
    possibleMentions: (projectId: string, targetType: string, targetId: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return listPossibleMentions(session.driver, projectId as UUID, targetType, targetId as UUID);
    },
    checks: (projectId: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return runConsistencyChecks(session.driver, projectId as UUID);
    },
    /** Slice-10 read for the E2E journey: the timeline lanes, tray and conflicts. */
    timeline: (projectId: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return getTimeline(session.driver, projectId as UUID);
    },
    /** Slice-9 reads for the E2E journey: tags with counts, the grid and its balance. */
    tags: (projectId: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return listTags(session.driver, projectId as UUID);
    },
    entityTags: (entityType: string, entityId: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return listEntityTags(session.driver, entityType as EntityType, entityId as UUID);
    },
    grid: (projectId: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return getPlotlineGrid(session.driver, projectId as UUID);
    },
    balance: (projectId: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return getPlotlineBalance(session.driver, projectId as UUID);
    },
    fieldDefs: (projectId: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return listAllFieldDefs(session.driver, projectId as UUID);
    },
    /** Slice-8 reads for the E2E journey: the matrix (characters + edges + groups) and the pins. */
    relationships: (projectId: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return getRelationshipMatrix(session.driver, projectId as UUID);
    },
    graphPositions: (projectId: string) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      return getGraphPositions(session.driver, projectId as UUID);
    },
    /**
     * Phone-path perf check (spec §5.1): times the two slice-7 reads through the real wasm
     * driver on this device, with the same payload shape the UI uses.
     */
    perf: async (projectId: string, targetType: string, targetId: string, queries: string[]) => {
      const session = useSessionStore.getState().session;
      if (!session) throw new Error("no library open");
      const time = async <T>(fn: () => Promise<T>): Promise<number> => {
        const started = performance.now();
        await fn();
        return Math.round((performance.now() - started) * 100) / 100;
      };
      const searchSamples: number[] = [];
      for (const query of queries) {
        searchSamples.push(
          await time(() => searchProject(session.driver, projectId as UUID, query)),
        );
      }
      const backlinkSamples: number[] = [];
      // One warm-up call, then enough samples that p95 is a percentile and not the maximum:
      // with 15 samples the p95 index IS the maximum, so a single GC pause or a background
      // snapshot failed the budget without the read ever being slow.
      await time(() =>
        listBacklinks(session.driver, projectId as UUID, targetType, targetId as UUID),
      );
      for (let run = 0; run < 40; run++) {
        backlinkSamples.push(
          await time(() =>
            listBacklinks(session.driver, projectId as UUID, targetType, targetId as UUID),
          ),
        );
      }
      const pick = (samples: number[], p: number) => {
        const sorted = [...samples].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
      };
      return {
        searchP50: pick(searchSamples, 50),
        searchP95: pick(searchSamples, 95),
        backlinkP50: pick(backlinkSamples, 50),
        backlinkP95: pick(backlinkSamples, 95),
      };
    },
  };
}

/** World/lore reads and writes (PLAN slice 6). */

export function useLoreCategories(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["lore", session?.name ?? null, projectId, "categories"],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listLoreCategories(session.driver, projectId);
    },
  });
}

export function useLoreEntries(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["lore", session?.name ?? null, projectId, "entries"],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listLoreEntries(session.driver, projectId);
    },
  });
}

export function useLoreEntry(projectId: UUID | null, entryId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["lore", session?.name ?? null, projectId, "entry", entryId],
    enabled: session !== null && projectId !== null && entryId !== null,
    queryFn: async () => {
      if (!session || !projectId || !entryId) throw new Error("no entry open");
      return getLoreEntry(session.driver, projectId, entryId);
    },
  });
}

export function useMentionables(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["lore", session?.name ?? null, projectId, "mentionables"],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listMentionables(session.driver, projectId);
    },
  });
}

export function useLoreFieldDefs(projectId: UUID | null, kind: string | null) {
  return useFieldDefsFor(projectId, "lore", kind);
}

/** Field definitions for one target — the same read the settings screen manages. */
export function useFieldDefsFor(
  projectId: UUID | null,
  target: CustomFieldTarget,
  loreKind: string | null = null,
) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["fields", session?.name ?? null, projectId, target, loreKind],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listFieldDefs(session.driver, projectId, target, loreKind);
    },
  });
}

export function useFieldValues(ownerId: UUID | null) {
  return useFieldValuesFor("lore", ownerId);
}

/** Values of one owner, whatever the target — scenes, lore entries and characters alike. */
export function useFieldValuesFor(ownerType: string, ownerId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["fields", session?.name ?? null, "values", ownerType, ownerId],
    enabled: session !== null && ownerId !== null,
    queryFn: async () => {
      if (!session || !ownerId) throw new Error("no owner");
      return listFieldValues(session.driver, ownerType, ownerId);
    },
  });
}

export function useSeedLoreTaxonomy() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (projectId: UUID) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, seedLoreTaxonomy, { projectId });
    },
  });
}

export function useCreateLoreCategory() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: { projectId: UUID; name: string; parentId?: UUID | null }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, createLoreCategory, args);
    },
  });
}

export function useCreateLoreEntry() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: {
      projectId: UUID;
      name: string;
      kind: LoreKind;
      customKindLabel?: string;
      categoryId?: UUID | null;
      parentEntryId?: UUID | null;
    }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, createLoreEntry, args);
    },
  });
}

export function useUpdateLoreEntry() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: { projectId: UUID; entryId: UUID; patch: LoreEntryPatch }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, updateLoreEntry, args);
    },
  });
}

export function useDeleteLoreEntry() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: { projectId: UUID; entryId: UUID }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, deleteLoreEntry, args);
    },
  });
}

export function useMoveLoreEntry() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: {
      projectId: UUID;
      entryId: UUID;
      categoryId: UUID | null;
      parentEntryId: UUID | null;
      orderKey: string;
    }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, moveLoreEntry, args);
    },
  });
}

export function useMoveLoreCategory() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: {
      projectId: UUID;
      categoryId: UUID;
      parentId: UUID | null;
      orderKey: string;
    }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, moveLoreCategory, args);
    },
  });
}

export function useRenameProject() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: { projectId: UUID; title: string }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, renameProject, args);
    },
  });
}

export function useDeleteProject() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: { projectId: UUID }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, deleteProject, args);
    },
  });
}

export function useRestoreProject() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: { projectId: UUID }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, restoreProject, args);
    },
  });
}

export function useDeleteLoreCategory() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: { projectId: UUID; categoryId: UUID; cascade?: boolean }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, deleteLoreCategory, args);
    },
  });
}

export function useSetFieldValue() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: { defId: UUID; ownerType: string; ownerId: UUID; value: unknown }) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, setFieldValue, args);
    },
  });
}

/** Search, backlinks, possible mentions and the consistency checks (PLAN slice 7). */

export function useSearch(projectId: UUID | null, query: string) {
  const session = useSessionStore((state) => state.session);
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["search", session?.name ?? null, projectId, trimmed],
    enabled: session !== null && projectId !== null && trimmed.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<SearchResults> => {
      if (!session || !projectId) throw new Error("no project open");
      return searchProject(session.driver, projectId, trimmed);
    },
  });
}

export function useBacklinks(
  projectId: UUID | null,
  targetType: string | null,
  targetId: UUID | null,
) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["backlinks", session?.name ?? null, projectId, targetType, targetId],
    enabled: session !== null && projectId !== null && targetType !== null && targetId !== null,
    staleTime: 10_000,
    queryFn: async (): Promise<Backlinks> => {
      if (!session || !projectId || !targetType || !targetId) throw new Error("no target");
      return listBacklinks(session.driver, projectId, targetType, targetId);
    },
  });
}

export function usePossibleMentions(
  projectId: UUID | null,
  targetType: string | null,
  targetId: UUID | null,
) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["possible", session?.name ?? null, projectId, targetType, targetId],
    enabled: session !== null && projectId !== null && targetType !== null && targetId !== null,
    staleTime: 10_000,
    queryFn: async (): Promise<PossibleMention[]> => {
      if (!session || !projectId || !targetType || !targetId) throw new Error("no target");
      return listPossibleMentions(session.driver, projectId, targetType, targetId);
    },
  });
}

export function useConsistencyChecks(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["checks", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    staleTime: 15_000,
    queryFn: async (): Promise<ConsistencyCheck[]> => {
      if (!session || !projectId) throw new Error("no project open");
      return runConsistencyChecks(session.driver, projectId);
    },
  });
}

export interface LinkMentionVariables {
  projectId: UUID;
  sourceType: string;
  sourceId: UUID;
  field: string;
  targetType: string;
  targetId: UUID;
}

export function useLinkMention() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: LinkMentionVariables) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, linkMention, args);
    },
  });
}

export function useUnlinkMention() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: LinkMentionVariables) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, unlinkMention, args);
    },
  });
}

/** Relationships (PLAN slice 8): one matrix read feeds the list, the matrix and the web. */

export function useRelationshipMatrix(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["relationships", session?.name ?? null, projectId, "matrix"],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return getRelationshipMatrix(session.driver, projectId);
    },
  });
}

export function useRelationshipGroups(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["relationships", session?.name ?? null, projectId, "groups"],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listRelationshipGroups(session.driver, projectId);
    },
  });
}

/** Edge counts per character — the People cards show them and the filter reads the zeroes. */
export function useRelationshipCounts(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["relationshipCounts", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return countRelationshipsByCharacter(session.driver, projectId);
    },
  });
}

export function useGraphPositions(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["graphPositions", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    staleTime: 30_000,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return getGraphPositions(session.driver, projectId);
    },
  });
}

export function useSharedScenes(
  projectId: UUID | null,
  firstId: UUID | null,
  secondId: UUID | null,
) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["sharedScenes", session?.name ?? null, projectId, firstId, secondId],
    enabled:
      session !== null &&
      projectId !== null &&
      firstId !== null &&
      secondId !== null &&
      firstId !== secondId,
    queryFn: async () => {
      if (!session || !projectId || !firstId || !secondId) throw new Error("no pair");
      return listSharedScenes(session.driver, projectId, firstId, secondId);
    },
  });
}

export function useCreateRelationship() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof createRelationship.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, createRelationship, args);
    },
  });
}

export interface UpdateRelationshipVariables {
  projectId: UUID;
  relationshipId: UUID;
  patch: RelationshipPatch;
}

export function useUpdateRelationship() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: UpdateRelationshipVariables) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, updateRelationship, args);
    },
  });
}

export interface DeleteRelationshipVariables {
  projectId: UUID;
  relationshipId: UUID;
}

export function useDeleteRelationship() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: DeleteRelationshipVariables) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, deleteRelationship, args);
    },
  });
}

export function useCreateRelationshipGroup() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof createRelationshipGroup.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, createRelationshipGroup, args);
    },
  });
}

export function useUpdateRelationshipGroup() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof updateRelationshipGroup.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, updateRelationshipGroup, args);
    },
  });
}

export function useDeleteRelationshipGroup() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof deleteRelationshipGroup.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, deleteRelationshipGroup, args);
    },
  });
}

/** Manual pins are written on drag-end, so the mutation stays quiet and cheap. */
export function useSetGraphPositions() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof setGraphPositions.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, setGraphPositions, args);
    },
  });
}

/** Raw reads for the E2E journey (DEV hook only). */
export function readRelationshipMatrix(driver: TauriStorageDriver, projectId: UUID) {
  return getRelationshipMatrix(driver, projectId);
}

export function readRelationships(driver: TauriStorageDriver, projectId: UUID) {
  return listRelationships(driver, projectId);
}

// ── Slice 14: the notes incubator and attachments ────────────────────────────────────────────

export interface NotesQueryOptions {
  status?: NoteStatus;
  kind?: NoteKind;
  pinnedOnly?: boolean;
  search?: string;
}

export function useNotes(projectId: UUID | null, options: NotesQueryOptions = {}) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: [
      "notes",
      session?.name ?? null,
      projectId,
      options.status ?? null,
      options.kind ?? null,
      options.pinnedOnly ?? false,
      options.search ?? "",
    ],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listNotes(session.driver, projectId, options);
    },
  });
}

export function useNote(projectId: UUID | null, noteId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["notes", "one", session?.name ?? null, projectId, noteId],
    enabled: session !== null && projectId !== null && noteId !== null,
    queryFn: async () => {
      if (!session || !projectId || !noteId) throw new Error("no project open");
      return getNote(session.driver, projectId, noteId);
    },
  });
}

export function useNoteCounts(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["notes", "counts", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return countNotesByStatus(session.driver, projectId);
    },
  });
}
export function useStaleIdeas(projectId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["staleIdeas", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return listStaleIdeas(session.driver, projectId);
    },
  });
}

export function useCreateNote() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof createNote.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, createNote, args);
    },
  });
}

export function useUpdateNote() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof updateNote.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, updateNote, args);
    },
  });
}

export function useMoveNote() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof moveNote.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, moveNote, args);
    },
  });
}

export function useDeleteNote() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof deleteNote.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, deleteNote, args);
    },
  });
}

export function usePromoteNote() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof promoteNote.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, promoteNote, args);
    },
  });
}

export function useCharacterGallery(characterId: UUID | null) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: ["gallery", session?.name ?? null, characterId],
    enabled: session !== null && characterId !== null,
    queryFn: async () => {
      if (!session || !characterId) throw new Error("no character open");
      return listCharacterGallery(session.driver, characterId);
    },
  });
}

export function useAttachToGallery() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof attachToGallery.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, attachToGallery, args);
    },
  });
}

export function useDetachFromGallery() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof detachFromGallery.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, detachFromGallery, args);
    },
  });
}

export function useSetEntityImage() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof setEntityImage.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, setEntityImage, args);
    },
  });
}

export function useDeleteAttachment() {
  const session = useSessionStore((state) => state.session);
  return useMutation({
    mutationFn: async (args: Parameters<typeof deleteAttachment.run>[1]) => {
      if (!session) throw new Error("no library open");
      return runCommand(session.driver, deleteAttachment, args);
    },
  });
}

/** Raw read for the E2E journey (DEV hook only): every attachment of a project, metadata only. */
export function readAttachments(driver: TauriStorageDriver, projectId: UUID) {
  return listProjectAttachments(driver, projectId);
}

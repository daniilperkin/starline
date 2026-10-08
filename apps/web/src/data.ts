import {
  ChangeBus,
  type ChapterSummary,
  type CharacterPatch,
  type CharacterRole,
  type Command,
  createChapter,
  createCharacter,
  createPlotline,
  createProject,
  createScene,
  createScenesFromList,
  deleteChapter,
  deleteCharacter,
  deleteScene,
  executeCommand,
  getSceneDetail,
  listChapters,
  listCharacters,
  listParts,
  listPlotlines,
  listProjects,
  listScenes,
  listSteps,
  listTags,
  markStepComplete,
  moveChapter,
  moveScene,
  type PartSummary,
  type SceneSummary,
  type SnowflakeStepContent,
  type SnowflakeStepNumber,
  saveStepContent,
  setSceneCharacters,
  setSceneLore,
  setScenePlotline,
  setSceneTags,
  type UUID,
  updateChapter,
  updateCharacter,
  updateScene,
} from "@starline/core";
import type { TauriStorageDriver } from "@starline/driver-wasm";
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useSessionStore } from "./session";

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
});

function runCommand<A, R>(driver: TauriStorageDriver, command: Command<A, R>, args: A): Promise<R> {
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
export const useSetSceneCharacters = () => useSceneCommand(setSceneCharacters);
export const useSetScenePlotline = () => useSceneCommand(setScenePlotline);
export const useSetSceneTags = () => useSceneCommand(setSceneTags);
export const useSetSceneLore = () => useSceneCommand(setSceneLore);

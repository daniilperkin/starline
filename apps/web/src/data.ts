import {
  ChangeBus,
  type CharacterPatch,
  type CharacterRole,
  type Command,
  createCharacter,
  createProject,
  deleteCharacter,
  executeCommand,
  listCharacters,
  listProjects,
  listSteps,
  markStepComplete,
  type SnowflakeStepContent,
  type SnowflakeStepNumber,
  saveStepContent,
  type UUID,
  updateCharacter,
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

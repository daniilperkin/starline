import {
  ChangeBus,
  type Command,
  createProject,
  executeCommand,
  listProjects,
  listSteps,
  markStepComplete,
  type SnowflakeStepContent,
  type SnowflakeStepNumber,
  saveStepContent,
  type UUID,
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

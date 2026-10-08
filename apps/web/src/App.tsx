import type { MigrationReport, OpenResult } from "@starline/db";
import type { TauriStorageDriver, WorkerTransport } from "@starline/driver-wasm";
import { useState } from "react";
import { StartScreen } from "./StartScreen";
import { closeLibrary } from "./storage";
import { Workspace } from "./Workspace";

export interface LibrarySession {
  driver: TauriStorageDriver;
  transport: WorkerTransport;
  name: string;
  info: OpenResult;
  report: MigrationReport;
}

export function App() {
  const [session, setSession] = useState<LibrarySession | null>(null);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {session ? (
        <Workspace
          session={session}
          onClose={async () => {
            await closeLibrary(session);
            setSession(null);
          }}
        />
      ) : (
        <StartScreen onOpen={setSession} />
      )}
    </div>
  );
}

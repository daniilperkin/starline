import type { MigrationReport, OpenResult } from "@starline/db";
import type { TauriStorageDriver, WorkerTransport } from "@starline/driver-wasm";
import { useState } from "react";
import { Starfield } from "./Starfield";
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
    <div className="relative min-h-dvh bg-canvas text-ink">
      <Starfield />
      <div className="sl-shell relative z-10">
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
    </div>
  );
}

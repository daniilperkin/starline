import type { ChangeBus, ChangeEvent } from "./changes";

export type SqlValue = string | number | bigint | Uint8Array | null;

/** The statement surface available inside a transaction. */
export interface SqlRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  execScript(sql: string): Promise<void>;
}

export interface CommandContext {
  readonly tx: SqlRunner;
}

export interface CommandResult<R> {
  result: R;
  changes: ChangeEvent[];
}

/** Every user action is one command = one transaction (spec §2.3.3). */
export interface Command<A, R> {
  readonly name: string;
  run(ctx: CommandContext, args: A): Promise<CommandResult<R>>;
}

/** Minimal slice of StorageDriver the executor needs (keeps core free of a db dependency). */
export interface TransactionRunner {
  transaction<R>(fn: (tx: SqlRunner) => Promise<R>): Promise<R>;
}

/**
 * Runs one command inside one transaction, bumps `meta.revision`, then publishes the
 * command's change events. The revision bump happens before the command body so that a
 * rolled-back command leaves no trace (rollback discards it).
 */
export async function executeCommand<A, R>(
  runner: TransactionRunner,
  bus: ChangeBus,
  command: Command<A, R>,
  args: A,
): Promise<R> {
  const outcome = await runner.transaction(async (tx) => {
    await tx.query(
      "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'revision'",
    );
    return command.run({ tx }, args);
  });
  bus.publish(outcome.changes);
  return outcome.result;
}

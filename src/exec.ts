import { spawnSync } from "node:child_process";

export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type ExecFn = (command: string, args: string[]) => ExecResult;

/**
 * Runs a command synchronously and reports the raw result instead of throwing,
 * so callers can decide what counts as a failure (e.g. `git fetch` writes
 * progress output to stderr even on success).
 */
export const exec: ExecFn = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error
  };
};

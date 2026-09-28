import { exec as defaultExec, type ExecFn } from "./exec.js";

const run = (exec: ExecFn, args: string[], describe: string): string => {
  const result = exec("git", args);
  if (result.error) {
    throw new Error(`Failed to run \`git ${args[0]}\`: ${result.error.message}. Is git installed?`);
  }
  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim();
    throw new Error(`${describe}: ${details}`);
  }
  return result.stdout;
};

/**
 * @returns current git branch name
 */
export function getCurrentBranch({ exec = defaultExec }: { exec?: ExecFn } = {}): string {
  return run(exec, ["rev-parse", "--abbrev-ref", "HEAD"], "Cannot determine the current git branch").trim();
}

/**
 * Fetches fresh remote state first (fail closed if that is not possible), then
 * counts how many commits the current branch is behind its upstream.
 *
 * @returns number of commits behind the upstream tracking branch
 */
export function getBehindCount({ exec = defaultExec }: { exec?: ExecFn } = {}): number {
  run(exec, ["fetch", "--quiet"], "`git fetch` failed — cannot safely verify that the branch is up to date");
  const count = run(
    exec,
    ["rev-list", "--count", "HEAD..@{u}"],
    "Cannot compare against the upstream tracking branch (is one configured?)"
  );
  return Number(count.trim());
}

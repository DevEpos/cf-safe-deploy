import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exec as defaultExec, type ExecFn } from "./exec.js";
import { CONFIG_FILE_NAME, findConfigPath, validateConfig, type ExistsFn, type ReadFileFn } from "./config.js";
import { getCfTarget } from "./cf-target.js";
import { createLogger, type Logger } from "./log.js";

export type ExitCode = 0 | 1;

export type WriteFileFn = (file: string, content: string) => void;

export interface AddTargetOptions {
  cwd?: string;
  configPath?: string;
  region?: string;
  requireBranch?: string;
  requireUpToDate?: boolean;
  warnProduction?: boolean;
  /** Sets `confirm: false` on the new entry. */
  noConfirm?: boolean;
}

/** Injectable side effects (for tests). */
export interface AddTargetDeps {
  exec?: ExecFn;
  log?: Logger;
  exists?: ExistsFn;
  readFile?: ReadFileFn;
  writeFile?: WriteFileFn;
}

const isSameRegion = (a: unknown, region: string): boolean =>
  typeof a === "string" && a.toLowerCase() === region.toLowerCase();

/**
 * Adds the currently targeted CF org/space to the whitelist in `.cf-safe-deploy.json`,
 * creating the file if none is found. Never throws; logs the reason and returns the
 * process exit code instead.
 *
 * @returns 0 = target added, 1 = blocked or configuration/lookup error
 */
export function addTarget(
  {
    cwd = process.cwd(),
    configPath,
    region: regionOverride,
    requireBranch,
    requireUpToDate = false,
    warnProduction = false,
    noConfirm = false
  }: AddTargetOptions = {},
  {
    exec = defaultExec,
    log = createLogger("cf-safe-deploy"),
    exists = existsSync,
    readFile = (file: string) => readFileSync(file, "utf8"),
    writeFile = (file: string, content: string) => writeFileSync(file, content)
  }: AddTargetDeps = {}
): ExitCode {
  try {
    const { org, space, region: detectedRegion } = getCfTarget({ exec });
    const region = regionOverride ?? detectedRegion;

    const file = configPath
      ? path.resolve(cwd, configPath)
      : (findConfigPath(cwd, { exists }) ?? path.join(cwd, CONFIG_FILE_NAME));

    let allowedTargets: Record<string, unknown>[] = [];
    if (exists(file)) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFile(file));
      } catch (err) {
        throw new Error(
          `Config file "${file}" contains invalid JSON: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      validateConfig(raw); // fail closed on schema violations before touching the file
      allowedTargets = (raw as { allowedTargets: Record<string, unknown>[] }).allowedTargets;
    }

    const duplicate = allowedTargets.find(
      (target) =>
        target.org === org && target.space === space && (region === undefined || isSameRegion(target.region, region))
    );
    if (duplicate) {
      log.error(
        `Target ${org}/${space}${region ? ` (region "${region}")` : ""} is already whitelisted in "${file}": ` +
          JSON.stringify(duplicate)
      );
      return 1;
    }

    const newTarget: Record<string, unknown> = { org, space };
    if (region !== undefined) newTarget.region = region;
    if (requireBranch !== undefined) newTarget.requireBranch = requireBranch;
    if (requireUpToDate) newTarget.requireUpToDate = true;
    if (warnProduction) newTarget.warnProduction = true;
    if (noConfirm) newTarget.confirm = false;

    writeFile(file, `${JSON.stringify({ allowedTargets: [...allowedTargets, newTarget] }, null, 2)}\n`);

    log.info(`Added ${org}/${space} to ${file}`);
    return 0;
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

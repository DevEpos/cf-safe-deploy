import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const CONFIG_FILE_NAME = ".cf-safe-deploy.json";

export interface TargetConfig {
  org: string;
  space: string;
  region?: string;
  requireBranch?: string;
  requireUpToDate: boolean;
  warnProduction: boolean;
  confirm: boolean;
}

export interface Config {
  allowedTargets: TargetConfig[];
}

export type ExistsFn = (file: string) => boolean;
export type ReadFileFn = (file: string) => string;

export interface LoadConfigOptions {
  cwd?: string;
  configPath?: string;
  exists?: ExistsFn;
  readFile?: ReadFileFn;
}

const TARGET_KEYS = ["org", "space", "region", "requireBranch", "requireUpToDate", "warnProduction", "confirm"];

/**
 * Searches for the config file upward from `startDir` to the filesystem root.
 *
 * @returns absolute path of the first match
 */
export function findConfigPath(
  startDir: string,
  { exists = existsSync }: { exists?: ExistsFn } = {}
): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (exists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function fail(message: string): never {
  throw new Error(`Invalid configuration: ${message}`);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim() === "") fail(`${name} must be a non-empty string`);
  return value;
};

const optionalString = (value: unknown, name: string): string | undefined => {
  if (value !== undefined && typeof value !== "string") fail(`${name} must be a string`);
  return value;
};

const optionalNonEmptyString = (value: unknown, name: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") fail(`${name} must be a non-empty string`);
  return value;
};

const optionalBoolean = (value: unknown, name: string): boolean | undefined => {
  if (value !== undefined && typeof value !== "boolean") fail(`${name} must be a boolean`);
  return value;
};

/**
 * Validates the raw config against the expected schema (fail closed on
 * unknown keys) and applies per-target defaults.
 */
export function validateConfig(raw: unknown): Config {
  if (!isPlainObject(raw)) fail("config root must be an object");

  for (const key of Object.keys(raw)) {
    if (key !== "allowedTargets") fail(`unknown key "${key}"`);
  }
  if (!("allowedTargets" in raw)) fail(`missing required key "allowedTargets"`);
  if (!Array.isArray(raw.allowedTargets)) fail(`"allowedTargets" must be an array`);
  if (raw.allowedTargets.length === 0) fail(`"allowedTargets" must be a non-empty array`);

  const allowedTargets = raw.allowedTargets.map((target: unknown, index): TargetConfig => {
    const at = `allowedTargets[${index}]`;
    if (!isPlainObject(target)) fail(`${at} must be an object`);

    for (const key of Object.keys(target)) {
      if (!TARGET_KEYS.includes(key)) fail(`${at} contains unknown key "${key}"`);
    }

    return {
      org: requiredString(target.org, `${at}.org`),
      space: requiredString(target.space, `${at}.space`),
      region: optionalNonEmptyString(target.region, `${at}.region`),
      requireBranch: optionalString(target.requireBranch, `${at}.requireBranch`),
      requireUpToDate: optionalBoolean(target.requireUpToDate, `${at}.requireUpToDate`) ?? false,
      warnProduction: optionalBoolean(target.warnProduction, `${at}.warnProduction`) ?? false,
      confirm: optionalBoolean(target.confirm, `${at}.confirm`) ?? true
    };
  });

  return { allowedTargets };
}

/**
 * Loads the configuration — from `configPath` if given, otherwise by searching
 * upward from `cwd`. Throws on missing file, invalid JSON or schema violations.
 */
export function loadConfig({
  cwd = process.cwd(),
  configPath,
  exists = existsSync,
  readFile
}: LoadConfigOptions = {}): Config {
  const read = readFile ?? ((file: string) => readFileSync(file, "utf8"));

  const file = configPath ? path.resolve(cwd, configPath) : findConfigPath(cwd, { exists });
  if (!file) {
    throw new Error(`No ${CONFIG_FILE_NAME} found in "${cwd}" or any parent directory`);
  }

  let content: string;
  try {
    content = read(file);
  } catch (err) {
    throw new Error(`Cannot read config file "${file}": ${err instanceof Error ? err.message : String(err)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new Error(`Config file "${file}" contains invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  return validateConfig(raw);
}

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { verify as defaultVerify, type ExitCode, type VerifyDeps } from "./verify.js";
import { addTarget as defaultAddTarget, type AddTargetDeps } from "./add-target.js";
import { createLogger, type Logger } from "./log.js";

export const USAGE = `Usage: cf-safe-deploy [options]
       cf-safe-deploy add-target [options]

Verifies the currently targeted Cloud Foundry org/space against the
allowed targets in .cf-safe-deploy.json before a deploy may proceed.

Options:
  -y, --yes            skip the interactive confirmation prompt
      --config <path>  use this config file instead of searching for .cf-safe-deploy.json
  -h, --help           show this help
  -v, --version        print the version

add-target: adds the currently targeted CF org/space to .cf-safe-deploy.json

  --region <region>         pin a region (default: auto-detected from the API endpoint)
  --require-branch <branch> require this git branch for deploys to this target
  --require-up-to-date      require the branch to be up to date with its upstream
  --warn-production         show the production warning banner for this target
  --no-confirm              skip the confirmation prompt for this target
      --config <path>       use/create this config file instead of searching for one
  -h, --help                show this help

Exit codes:
  0  deploy may proceed / target added
  1  blocked, aborted or configuration error`;

export type CliArgs =
  | { command: "verify"; yes: boolean; config?: string; help: boolean; version: boolean }
  | {
      command: "add-target";
      config?: string;
      help: boolean;
      region?: string;
      requireBranch?: string;
      requireUpToDate: boolean;
      warnProduction: boolean;
      noConfirm: boolean;
    };

/** Overrides for tests. */
export interface MainOverrides {
  print?: (msg: string) => void;
  log?: Logger;
  verify?: typeof defaultVerify;
  deps?: VerifyDeps;
  addTarget?: typeof defaultAddTarget;
  addTargetDeps?: AddTargetDeps;
}

function parseAddTargetArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      region: { type: "string" },
      "require-branch": { type: "string" },
      "require-up-to-date": { type: "boolean", default: false },
      "warn-production": { type: "boolean", default: false },
      "no-confirm": { type: "boolean", default: false },
      config: { type: "string" },
      help: { type: "boolean", short: "h", default: false }
    }
  });
  if (positionals.length > 0) {
    throw new Error(`Unexpected argument "${positionals[0]}"`);
  }
  return {
    command: "add-target",
    config: values.config,
    help: values.help,
    region: values.region,
    requireBranch: values["require-branch"],
    requireUpToDate: values["require-up-to-date"],
    warnProduction: values["warn-production"],
    noConfirm: values["no-confirm"]
  };
}

/**
 * @param argv arguments without the node/script prefix
 */
export function parseCliArgs(argv: string[]): CliArgs {
  if (argv[0] === "add-target") {
    return parseAddTargetArgs(argv.slice(1));
  }

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      yes: { type: "boolean", short: "y", default: false },
      config: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false }
    }
  });
  if (positionals.length > 0) {
    throw new Error(`Unexpected argument "${positionals[0]}"`);
  }
  return { command: "verify", yes: values.yes, config: values.config, help: values.help, version: values.version };
}

/**
 * CLI entry point.
 *
 * @returns process exit code
 */
export async function main(argv: string[] = process.argv.slice(2), overrides: MainOverrides = {}): Promise<ExitCode> {
  const {
    print = (msg: string) => console.log(msg),
    log = createLogger("cf-safe-deploy"),
    verify = defaultVerify,
    deps = { log },
    addTarget = defaultAddTarget,
    addTargetDeps = { log }
  } = overrides;

  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    print(USAGE);
    return 1;
  }

  if (args.help) {
    print(USAGE);
    return 0;
  }

  if (args.command === "add-target") {
    return addTarget(
      {
        configPath: args.config,
        region: args.region,
        requireBranch: args.requireBranch,
        requireUpToDate: args.requireUpToDate,
        warnProduction: args.warnProduction,
        noConfirm: args.noConfirm
      },
      addTargetDeps
    );
  }

  if (args.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    print(pkg.version);
    return 0;
  }

  return verify({ yes: args.yes, configPath: args.config }, deps);
}

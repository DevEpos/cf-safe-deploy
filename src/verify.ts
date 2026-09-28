import readline from "node:readline";
import { exec as defaultExec, type ExecFn } from "./exec.js";
import { loadConfig as defaultLoadConfig, type Config } from "./config.js";
import { getCfTarget } from "./cf-target.js";
import { getCurrentBranch, getBehindCount } from "./git.js";
import { createLogger, createColors, colorsEnabled, type Colors, type Logger } from "./log.js";

export type ExitCode = 0 | 1;

export type AskFn = (question: string) => Promise<string>;

export interface VerifyOptions {
  configPath?: string;
  cwd?: string;
  yes?: boolean;
}

/** Injectable side effects (for tests). */
export interface VerifyDeps {
  exec?: ExecFn;
  ask?: AskFn;
  log?: Logger;
  colors?: Colors;
  isTTY?: boolean;
  loadConfig?: (options: { cwd?: string; configPath?: string }) => Config;
}

const askViaReadline: AskFn = (question) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

/**
 * Runs the full deploy guard: config → cf target → whitelist → git rules → confirmation.
 * Never throws; logs the reason and returns the process exit code instead.
 *
 * @returns 0 = deploy may proceed, 1 = blocked/aborted
 */
export async function verify(
  { configPath, cwd = process.cwd(), yes = false }: VerifyOptions = {},
  {
    exec = defaultExec,
    ask = askViaReadline,
    log = createLogger("cf-safe-deploy"),
    colors = createColors(colorsEnabled()),
    isTTY = Boolean(process.stdin.isTTY),
    loadConfig = defaultLoadConfig
  }: VerifyDeps = {}
): Promise<ExitCode> {
  try {
    const { allowedTargets } = loadConfig({ cwd, configPath });

    const { org, space, apiEndpoint, region } = getCfTarget({ exec });
    log.info("Resolved target >>>");
    log.info(`  ${"API Endpoint:".padEnd(14)}${apiEndpoint ?? "unknown"}`);
    log.info(`  ${"CF Region:".padEnd(14)}${region ?? "unknown"}`);
    log.info(`  ${"CF Org:".padEnd(14)}${org}`);
    log.info(`  ${"CF Space:".padEnd(14)}${space}`);

    const target = allowedTargets.find((candidate) => candidate.org === org && candidate.space === space);
    if (!target) {
      log.error(`Target org "${org}" / space "${space}" is not whitelisted for deployment`);
      log.error(`Allowed targets: ${allowedTargets.map((t) => `${t.org}/${t.space}`).join(", ")}`);
      return 1;
    }

    if (target.region !== undefined) {
      if (region === undefined) {
        log.error(
          `Deployments to ${org}/${space} require region "${target.region}", but no region could be extracted from ` +
            `API endpoint "${apiEndpoint ?? "<missing>"}" — expected an endpoint matching \`api.cf.<region>.<domain>\`.`
        );
        return 1;
      }
      if (region.toLowerCase() !== target.region.toLowerCase()) {
        log.error(
          `Targeted region "${colors.red(region)}" does not match the required region ` +
            `"${colors.green(target.region)}" for ${org}/${space}.`
        );
        return 1;
      }
    }

    if (target.requireBranch !== undefined || target.requireUpToDate) {
      const branch = getCurrentBranch({ exec });
      log.info("Resolved Source >>>");
      log.info(`  ${"Git Branch:".padEnd(14)}${branch}`);

      if (target.requireBranch !== undefined && branch !== target.requireBranch) {
        log.error(
          `Current branch is "${colors.red(branch)}". Deployments to ${org}/${space} are only allowed from the ` +
            `"${colors.green(target.requireBranch)}" branch.`
        );
        return 1;
      }

      if (target.requireUpToDate) {
        const behindCount = getBehindCount({ exec });
        if (behindCount > 0) {
          log.error(
            `Local branch "${branch}" is ${behindCount} commit(s) behind its remote tracking branch. ` +
              `Update it (e.g. \`git pull\`) before deploying to ${org}/${space}.`
          );
          return 1;
        }
      }
    }

    if (target.warnProduction) {
      const bar = "=".repeat(60);
      log.warn(bar);
      log.warn(`⚠️ This is a ${colors.red("PRODUCTION")} deployment target! ⚠️`);
      log.warn(bar);
    }

    if (target.confirm && !yes) {
      if (!isTTY) {
        log.error(
          `Deploy to ${org}/${space} requires confirmation, but stdin is not interactive. ` +
            `Pass --yes to skip the prompt in non-interactive environments (e.g. CI).`
        );
        return 1;
      }
      const answer = await ask(`\nContinue with deploy to ${org}/${space}? (y/N): `);
      if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
        log.error("Deploy aborted by user.");
        return 1;
      }
    }

    return 0;
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

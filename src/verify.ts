import readline from "node:readline";
import { exec as defaultExec, type ExecFn } from "./exec.js";
import { loadConfig as defaultLoadConfig, type Config } from "./config.js";
import { getCfTarget } from "./cf-target.js";
import { getCurrentBranch, getBehindCount } from "./git.js";
import {
  createLogger,
  createColors,
  colorsEnabled,
  icon,
  detailLine,
  banner,
  type Colors,
  type Logger
} from "./log.js";

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
  rich?: boolean;
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
    rich = colorsEnabled(),
    loadConfig = defaultLoadConfig
  }: VerifyDeps = {}
): Promise<ExitCode> {
  try {
    const { allowedTargets } = loadConfig({ cwd, configPath });

    // Ensures exactly one blank line between sections, however the branches below combine.
    let needsSeparator = false;
    const separate = () => {
      if (needsSeparator) log.info("");
      needsSeparator = true;
    };

    const { org, space, apiEndpoint, region } = getCfTarget({ exec });
    separate();
    log.info(`${icon("target", rich)}  Resolved target`);
    log.info(detailLine("endpoint", rich, "API Endpoint:", apiEndpoint ?? "unknown"));
    log.info(detailLine("region", rich, "CF Region:", region ?? "unknown"));
    log.info(detailLine("org", rich, "CF Org:", org));
    log.info(detailLine("space", rich, "CF Space:", space));

    const target = allowedTargets.find((candidate) => candidate.org === org && candidate.space === space);
    if (!target) {
      separate();
      log.error(`${icon("fail", rich)}  Target org "${org}" / space "${space}" is not whitelisted for deployment`);
      log.error(`    Allowed targets: ${allowedTargets.map((t) => `${t.org}/${t.space}`).join(", ")}`);
      return 1;
    }

    if (target.region !== undefined) {
      if (region === undefined) {
        separate();
        log.error(
          `${icon("fail", rich)}  Deployments to ${org}/${space} require region "${target.region}", but no region ` +
            `could be extracted from API endpoint "${apiEndpoint ?? "<missing>"}" — expected an endpoint matching ` +
            `\`api.cf.<region>.<domain>\`.`
        );
        return 1;
      }
      if (region.toLowerCase() !== target.region.toLowerCase()) {
        separate();
        log.error(
          `${icon("fail", rich)}  Targeted region "${colors.red(region)}" does not match the required region ` +
            `"${colors.green(target.region)}" for ${org}/${space}.`
        );
        return 1;
      }
    }

    if (target.requireBranch !== undefined || target.requireUpToDate) {
      const branch = getCurrentBranch({ exec });
      separate();
      log.info(`${icon("source", rich)}  Resolved source`);
      log.info(detailLine("branch", rich, "Branch:", branch));

      if (target.requireBranch !== undefined && branch !== target.requireBranch) {
        separate();
        log.error(`${icon("fail", rich)}  Current branch is "${colors.red(branch)}"`);
        log.error(
          `    Deployments to ${org}/${space} are only allowed from the "${colors.green(target.requireBranch)}" branch.`
        );
        return 1;
      }

      if (target.requireUpToDate) {
        const behindCount = getBehindCount({ exec });
        if (behindCount > 0) {
          separate();
          log.error(
            `${icon("fail", rich)}  Local branch "${branch}" is ${behindCount} commit(s) behind its remote ` +
              `tracking branch. Update it (e.g. \`git pull\`) before deploying to ${org}/${space}.`
          );
          return 1;
        }
      }
    }

    if (target.warnProduction) {
      separate();
      const colorEnabled = colors.red("x") !== "x";
      log.warn(
        banner(
          [
            `${icon("warn", rich)}  ${colors.red("PRODUCTION")} DEPLOYMENT TARGET`,
            "Proceed with caution — this action is not reversible."
          ],
          { rich, colorEnabled }
        ).join("\n")
      );
    }

    if (target.confirm && !yes) {
      if (!isTTY) {
        separate();
        log.error(
          `${icon("fail", rich)}  Deploy to ${org}/${space} requires confirmation, but stdin is not interactive. ` +
            `Pass --yes to skip the prompt in non-interactive environments (e.g. CI).`
        );
        return 1;
      }
      separate();
      const answer = await ask(`${icon("confirm", rich)}  Continue with deployment to ${org}/${space}? (y/N): `);
      needsSeparator = false;
      if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
        log.error(`${icon("fail", rich)}  Deployment aborted by user.`);
        return 1;
      }
    }

    separate();
    log.info(`${icon("ok", rich)}  Deployment allowed for ${org}/${space}`);
    return 0;
  } catch (err) {
    log.error(`${icon("fail", rich)}  ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

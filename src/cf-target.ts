import { exec as defaultExec, type ExecFn } from "./exec.js";

export interface CfTarget {
  org: string;
  space: string;
  apiEndpoint?: string;
  region?: string;
}

/** BTP-style CF API endpoints look like `https://api.cf.<region>.<domain>`, e.g. `https://api.cf.eu10-004.hana.ondemand.com`. */
const REGION_PATTERN = /^https?:\/\/api\.cf\.([^./:]+)\./i;

/**
 * Extracts the CF region (landscape id) from a BTP-style API endpoint.
 *
 * @returns the region, or undefined when the endpoint is missing or does not match the pattern
 */
export function extractRegion(apiEndpoint: string | undefined): string | undefined {
  return apiEndpoint?.trim().match(REGION_PATTERN)?.[1];
}

/**
 * Parses the currently targeted org/space and the API endpoint from `cf target` output.
 * Values may contain colons themselves, so only the first colon splits key and value.
 *
 * @param output stdout of `cf target`
 */
export function parseCfTarget(output: string): {
  org: string | undefined;
  space: string | undefined;
  apiEndpoint: string | undefined;
} {
  const lines = output.split("\n");
  const valueOf = (key: string): string | undefined => {
    const line = lines.find((candidate) => candidate.trim().startsWith(`${key}:`));
    return line?.trim().split(":").slice(1).join(":").trim();
  };
  return { org: valueOf("org"), space: valueOf("space"), apiEndpoint: valueOf("API endpoint") };
}

/**
 * Runs `cf target` and returns the targeted org/space.
 * Throws with the underlying cf message when the CLI is missing, not logged in or errors.
 */
export function getCfTarget({ exec = defaultExec }: { exec?: ExecFn } = {}): CfTarget {
  const result = exec("cf", ["target"]);
  if (result.error) {
    throw new Error(`Failed to run \`cf target\`: ${result.error.message}. Is the cf CLI installed?`);
  }
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n");
    throw new Error(`\`cf target\` failed:\n${details}`);
  }

  const { org, space, apiEndpoint } = parseCfTarget(result.stdout);
  if (!org || !space) {
    throw new Error(
      "Could not determine org and space from `cf target` output. Run `cf target -o <org> -s <space>` first."
    );
  }
  return { org, space, apiEndpoint, region: extractRegion(apiEndpoint) };
}

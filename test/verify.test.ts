import { describe, it, expect, vi } from "vitest";
import { verify } from "../src/verify.js";
import type { VerifyDeps } from "../src/verify.js";
import type { Config } from "../src/config.js";

const cfOutput = (org: string, space: string, endpoint: string) =>
  `API endpoint: ${endpoint}\norg: ${org}\nspace: ${space}\n`;

interface Scenario {
  org?: string;
  space?: string;
  endpoint?: string;
  branch?: string;
  behind?: number;
  answer?: string;
  isTTY?: boolean;
  fetchFails?: boolean;
  noUpstream?: boolean;
  gitFails?: boolean;
}

/**
 * Builds the injectable deps for verify() around a canned scenario.
 */
function makeDeps({
  org = "acme-dev",
  space = "web-apps",
  endpoint = "https://api.cf.eu10-004.hana.ondemand.com",
  branch = "main",
  behind = 0,
  answer = "y",
  isTTY = true,
  fetchFails = false,
  noUpstream = false,
  gitFails = false
}: Scenario = {}) {
  const exec = vi.fn((command: string, args: string[]) => {
    const key = `${command} ${args.join(" ")}`;
    if (key === "cf target") return { status: 0, stdout: cfOutput(org, space, endpoint), stderr: "" };
    if (key === "git rev-parse --abbrev-ref HEAD") {
      if (gitFails) return { status: 128, stdout: "", stderr: "fatal: not a git repository\n" };
      return { status: 0, stdout: `${branch}\n`, stderr: "" };
    }
    if (key === "git fetch --quiet") {
      return fetchFails
        ? { status: 1, stdout: "", stderr: "fatal: remote error\n" }
        : { status: 0, stdout: "", stderr: "" };
    }
    if (key === "git rev-list --count HEAD..@{u}") {
      if (noUpstream) return { status: 128, stdout: "", stderr: "fatal: no upstream configured\n" };
      return { status: 0, stdout: `${behind}\n`, stderr: "" };
    }
    throw new Error(`unexpected command in test: ${key}`);
  });
  const ask = vi.fn(async () => answer);
  const log = { info: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { exec, ask, log, isTTY };
}

const config = (target: Partial<Config["allowedTargets"][number]> = {}): Pick<VerifyDeps, "loadConfig"> => ({
  loadConfig: () => ({
    allowedTargets: [
      { org: "acme-dev", space: "web-apps", requireUpToDate: false, warnProduction: false, confirm: true, ...target }
    ]
  })
});

describe("verify", () => {
  it("allows a whitelisted target after confirmation", async () => {
    const deps = makeDeps({ answer: "y" });
    expect(await verify({}, { ...deps, ...config() })).toBe(0);
    expect(deps.ask).toHaveBeenCalledWith(
      expect.stringContaining("Continue with deployment to acme-dev/web-apps? (y/N)")
    );
  });

  it("prefixes the confirmation prompt with the confirm icon when rich output is enabled", async () => {
    const deps = makeDeps({ answer: "y" });
    expect(await verify({}, { ...deps, rich: true, ...config() })).toBe(0);
    expect(deps.ask).toHaveBeenCalledWith(
      expect.stringContaining("❓  Continue with deployment to acme-dev/web-apps? (y/N)")
    );
  });

  it("falls back to the ASCII confirm tag when rich output is disabled", async () => {
    const deps = makeDeps({ answer: "y" });
    expect(await verify({}, { ...deps, rich: false, ...config() })).toBe(0);
    expect(deps.ask).toHaveBeenCalledWith(
      expect.stringContaining("[?]  Continue with deployment to acme-dev/web-apps? (y/N)")
    );
  });

  it("accepts 'yes' case-insensitively", async () => {
    for (const answer of ["Y", "YES", " yes "]) {
      const deps = makeDeps({ answer });
      expect(await verify({}, { ...deps, ...config() })).toBe(0);
    }
  });

  it("aborts on anything but y/yes", async () => {
    for (const answer of ["n", "", "no", "yep"]) {
      const deps = makeDeps({ answer });
      expect(await verify({}, { ...deps, ...config() })).toBe(1);
      expect(deps.log.error).toHaveBeenCalledWith(expect.stringMatching(/abort/i));
    }
  });

  it("blocks a target that is not whitelisted and lists the allowed ones", async () => {
    const deps = makeDeps({ org: "acme-prod", space: "other-space" });
    expect(await verify({}, { ...deps, ...config() })).toBe(1);
    const messages = deps.log.error.mock.calls.flat().join("\n");
    expect(messages).toContain("acme-prod");
    expect(messages).toContain("acme-dev/web-apps");
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it("skips the prompt with --yes", async () => {
    const deps = makeDeps();
    expect(await verify({ yes: true }, { ...deps, ...config() })).toBe(0);
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it("skips the prompt when confirm is false", async () => {
    const deps = makeDeps();
    expect(await verify({}, { ...deps, ...config({ confirm: false }) })).toBe(0);
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it("does not hang on non-TTY stdin: fails with a --yes hint", async () => {
    const deps = makeDeps({ isTTY: false });
    expect(await verify({}, { ...deps, ...config() })).toBe(1);
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.log.error).toHaveBeenCalledWith(expect.stringContaining("--yes"));
  });

  it("enforces requireBranch", async () => {
    const deps = makeDeps({ branch: "main" });
    expect(await verify({}, { ...deps, ...config({ requireBranch: "release" }) })).toBe(1);
    const messages = deps.log.error.mock.calls.flat().join("\n");
    expect(messages).toContain("release");
    expect(messages).toContain("main");
  });

  it("passes requireBranch when the branch matches", async () => {
    const deps = makeDeps({ branch: "release", answer: "y" });
    expect(await verify({}, { ...deps, ...config({ requireBranch: "release" }) })).toBe(0);
  });

  it("fails closed when requireBranch is set but cwd is not a git repository", async () => {
    const deps = makeDeps({ gitFails: true });
    expect(await verify({}, { ...deps, ...config({ requireBranch: "release" }) })).toBe(1);
  });

  it("blocks when the branch is behind its upstream", async () => {
    const deps = makeDeps({ branch: "release", behind: 2 });
    expect(await verify({}, { ...deps, ...config({ requireUpToDate: true }) })).toBe(1);
    const messages = deps.log.error.mock.calls.flat().join("\n");
    expect(messages).toMatch(/2 commit/);
    expect(messages).toMatch(/pull/i);
  });

  it("proceeds when the branch is up to date", async () => {
    const deps = makeDeps({ behind: 0, answer: "y" });
    expect(await verify({}, { ...deps, ...config({ requireUpToDate: true }) })).toBe(0);
  });

  it("fails closed when git fetch fails", async () => {
    const deps = makeDeps({ fetchFails: true });
    expect(await verify({}, { ...deps, ...config({ requireUpToDate: true }) })).toBe(1);
  });

  it("fails closed when the branch has no upstream", async () => {
    const deps = makeDeps({ noUpstream: true });
    expect(await verify({}, { ...deps, ...config({ requireUpToDate: true }) })).toBe(1);
  });

  it("prints a production banner for warnProduction targets", async () => {
    const deps = makeDeps({ answer: "y" });
    expect(await verify({}, { ...deps, rich: true, ...config({ warnProduction: true }) })).toBe(0);
    const warnings = deps.log.warn.mock.calls.flat().join("\n");
    expect(warnings).toContain("⚠️");
    expect(warnings).toContain("PRODUCTION");
    expect(warnings).toContain("┌");
    expect(warnings).toContain("┐");
    expect(warnings).toContain("└");
    expect(warnings).toContain("┘");
    expect(warnings).toContain("│");
    expect(deps.log.warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to ASCII borders for the production banner when rich output is disabled", async () => {
    const deps = makeDeps({ answer: "y" });
    expect(await verify({}, { ...deps, rich: false, ...config({ warnProduction: true }) })).toBe(0);
    const warnings = deps.log.warn.mock.calls.flat().join("\n");
    expect(warnings).toContain("PRODUCTION");
    expect(warnings).toContain("+");
    expect(warnings).toContain("|");
    expect(warnings).not.toMatch(/[┌┐└┘│]/);
  });

  it("does not run git commands when no git rule is configured", async () => {
    const deps = makeDeps({ answer: "y" });
    await verify({}, { ...deps, ...config() });
    const gitCalls = deps.exec.mock.calls.filter(([command]) => command === "git");
    expect(gitCalls).toEqual([]);
  });

  it("fails with exit code 1 when the config cannot be loaded", async () => {
    const deps = makeDeps();
    const loadConfig = () => {
      throw new Error("no .cf-safe-deploy.json found");
    };
    expect(await verify({}, { ...deps, loadConfig })).toBe(1);
    expect(deps.log.error).toHaveBeenCalledWith(expect.stringContaining(".cf-safe-deploy.json"));
    expect(deps.exec).not.toHaveBeenCalled();
  });

  it("allows a target whose configured region matches the endpoint region", async () => {
    const deps = makeDeps({ endpoint: "https://api.cf.eu10-004.hana.ondemand.com", answer: "y" });
    expect(await verify({}, { ...deps, ...config({ region: "eu10-004" }) })).toBe(0);
  });

  it("compares regions case-insensitively", async () => {
    const deps = makeDeps({ endpoint: "https://api.cf.EU10-004.hana.ondemand.com", answer: "y" });
    expect(await verify({}, { ...deps, ...config({ region: "eu10-004" }) })).toBe(0);
  });

  it("blocks a region mismatch, naming expected and actual region", async () => {
    const deps = makeDeps({ endpoint: "https://api.cf.us10.hana.ondemand.com" });
    expect(await verify({}, { ...deps, ...config({ region: "eu10-004" }) })).toBe(1);
    const messages = deps.log.error.mock.calls.flat().join("\n");
    expect(messages).toContain("eu10-004");
    expect(messages).toContain("us10");
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it("fails closed when a region is required but not extractable from the endpoint", async () => {
    const deps = makeDeps({ endpoint: "https://api.example.com" });
    expect(await verify({}, { ...deps, ...config({ region: "eu10-004" }) })).toBe(1);
    const messages = deps.log.error.mock.calls.flat().join("\n");
    expect(messages).toContain("api.cf.<region>");
    expect(deps.ask).not.toHaveBeenCalled();
  });

  it("ignores the endpoint region for targets without a configured region", async () => {
    const deps = makeDeps({ endpoint: "https://api.example.com", answer: "y" });
    expect(await verify({}, { ...deps, ...config() })).toBe(0);
  });

  it("logs the resolved API endpoint and extracted region", async () => {
    const deps = makeDeps({ endpoint: "https://api.cf.eu10-004.hana.ondemand.com", answer: "y" });
    await verify({}, { ...deps, ...config() });
    const infos = deps.log.info.mock.calls.flat().join("\n");
    expect(infos).toContain("https://api.cf.eu10-004.hana.ondemand.com");
    expect(infos).toContain("eu10-004");
  });

  it("logs the region as unknown when it cannot be extracted", async () => {
    const deps = makeDeps({ endpoint: "https://api.example.com", answer: "y" });
    await verify({}, { ...deps, ...config() });
    const infos = deps.log.info.mock.calls.flat().join("\n");
    expect(infos).toContain("unknown");
  });

  it("prints icon-led section/success lines when rich output is enabled", async () => {
    const deps = makeDeps({ answer: "y" });
    expect(await verify({}, { ...deps, rich: true, ...config() })).toBe(0);
    const infos = deps.log.info.mock.calls.flat().join("\n");
    expect(infos).toContain("🔎  Resolved target");
    expect(infos).toContain("✅  Deployment allowed for acme-dev/web-apps");
  });

  it("falls back to ASCII tags when rich output is disabled", async () => {
    const deps = makeDeps({ answer: "y" });
    expect(await verify({}, { ...deps, rich: false, ...config() })).toBe(0);
    const infos = deps.log.info.mock.calls.flat().join("\n");
    expect(infos).toContain("[..]  Resolved target");
    expect(infos).toContain("[OK]  Deployment allowed for acme-dev/web-apps");
    expect(infos).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
  });

  it("prefixes error lines with the fail icon", async () => {
    const deps = makeDeps({ org: "acme-prod", space: "other-space" });
    await verify({}, { ...deps, rich: true, ...config() });
    expect(deps.log.error).toHaveBeenCalledWith(expect.stringContaining("❌  Target org"));
  });

  it("fails with exit code 1 when cf target errors", async () => {
    const deps = makeDeps();
    const exec = vi.fn(() => ({ status: 1, stdout: "FAILED\n", stderr: "Not logged in.\n" }));
    expect(await verify({}, { ...deps, exec, ...config() })).toBe(1);
    expect(deps.log.error).toHaveBeenCalledWith(expect.stringContaining("Not logged in"));
  });
});

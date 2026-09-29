import { describe, it, expect, vi } from "vitest";
import { addTarget } from "../src/add-target.js";
import type { AddTargetDeps } from "../src/add-target.js";
import type { ExecFn } from "../src/exec.js";

const CF_TARGET_OUTPUT = [
  "API endpoint:   https://api.cf.eu10-004.hana.ondemand.com",
  "org:            acme-dev",
  "space:          web-apps",
  ""
].join("\n");

const cfExec = (output: string = CF_TARGET_OUTPUT): ExecFn => vi.fn(() => ({ status: 0, stdout: output, stderr: "" }));

/** Builds injectable deps around an in-memory file map. */
function makeDeps({
  exec = cfExec(),
  files = {} as Record<string, string>
}: { exec?: ExecFn; files?: Record<string, string> } = {}) {
  const log = { info: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const exists = vi.fn((file: string) => file in files);
  const readFile = vi.fn((file: string) => files[file]);
  const writeFile = vi.fn((file: string, content: string) => {
    files[file] = content;
  });
  return { exec, log, exists, readFile, writeFile, files } satisfies AddTargetDeps & { files: Record<string, string> };
}

describe("addTarget", () => {
  it("creates a new config file with a minimal entry when none exists", () => {
    const deps = makeDeps({ files: {} });
    const exitCode = addTarget({ cwd: "/repo" }, deps);

    expect(exitCode).toBe(0);
    expect(deps.writeFile).toHaveBeenCalledWith(
      "/repo/.cf-safe-deploy.json",
      `${JSON.stringify({ allowedTargets: [{ org: "acme-dev", space: "web-apps", region: "eu10-004" }] }, null, 2)}\n`
    );
    expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining("acme-dev/web-apps"));
  });

  it("prefixes the success line with the save icon when rich output is enabled", () => {
    const deps = makeDeps({ files: {} });
    addTarget({ cwd: "/repo" }, { ...deps, rich: true });
    expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining("💾  Added acme-dev/web-apps"));
  });

  it("falls back to the ASCII tag for the success line when rich output is disabled", () => {
    const deps = makeDeps({ files: {} });
    addTarget({ cwd: "/repo" }, { ...deps, rich: false });
    expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining("[OK]  Added acme-dev/web-apps"));
  });

  it("appends to an existing config, preserving existing entries verbatim", () => {
    const existing = { allowedTargets: [{ org: "acme-test", space: "web-apps" }] };
    const deps = makeDeps({ files: { "/repo/.cf-safe-deploy.json": JSON.stringify(existing) } });

    const exitCode = addTarget({ cwd: "/repo" }, deps);

    expect(exitCode).toBe(0);
    const written = JSON.parse(deps.files["/repo/.cf-safe-deploy.json"]);
    expect(written.allowedTargets).toEqual([
      { org: "acme-test", space: "web-apps" },
      { org: "acme-dev", space: "web-apps", region: "eu10-004" }
    ]);
  });

  it("auto-detects the region from the API endpoint", () => {
    const deps = makeDeps({ files: {} });
    addTarget({ cwd: "/repo" }, deps);
    const written = JSON.parse(deps.files["/repo/.cf-safe-deploy.json"]);
    expect(written.allowedTargets[0].region).toBe("eu10-004");
  });

  it("lets an explicit --region override the detected one", () => {
    const deps = makeDeps({ files: {} });
    addTarget({ cwd: "/repo", region: "us10" }, deps);
    const written = JSON.parse(deps.files["/repo/.cf-safe-deploy.json"]);
    expect(written.allowedTargets[0].region).toBe("us10");
  });

  it("writes only the flags that were actually passed", () => {
    const deps = makeDeps({ files: {} });
    addTarget(
      { cwd: "/repo", requireBranch: "release", requireUpToDate: true, warnProduction: true, noConfirm: true },
      deps
    );
    const written = JSON.parse(deps.files["/repo/.cf-safe-deploy.json"]);
    expect(written.allowedTargets[0]).toEqual({
      org: "acme-dev",
      space: "web-apps",
      region: "eu10-004",
      requireBranch: "release",
      requireUpToDate: true,
      warnProduction: true,
      confirm: false
    });
  });

  it("does not write default-valued flags that were not passed", () => {
    const deps = makeDeps({ files: {} });
    addTarget({ cwd: "/repo" }, deps);
    const written = JSON.parse(deps.files["/repo/.cf-safe-deploy.json"]);
    expect(written.allowedTargets[0]).toEqual({ org: "acme-dev", space: "web-apps", region: "eu10-004" });
  });

  it("blocks and does not modify the file on a duplicate org/space/region", () => {
    const existing = { allowedTargets: [{ org: "acme-dev", space: "web-apps", region: "eu10-004" }] };
    const original = JSON.stringify(existing);
    const deps = makeDeps({ files: { "/repo/.cf-safe-deploy.json": original } });

    const exitCode = addTarget({ cwd: "/repo" }, { ...deps, rich: true });

    expect(exitCode).toBe(1);
    expect(deps.log.error).toHaveBeenCalledWith(expect.stringContaining("❌  Target acme-dev/web-apps"));
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.files["/repo/.cf-safe-deploy.json"]).toBe(original);
  });

  it("blocks a duplicate org/space when the new entry has no region to compare", () => {
    const existing = { allowedTargets: [{ org: "acme-dev", space: "web-apps", region: "us10" }] };
    const original = JSON.stringify(existing);
    const nonBtpExec: ExecFn = () => ({
      status: 0,
      stdout: "API endpoint: https://api.example.com\norg: acme-dev\nspace: web-apps\n",
      stderr: ""
    });
    const deps = makeDeps({ exec: nonBtpExec, files: { "/repo/.cf-safe-deploy.json": original } });

    const exitCode = addTarget({ cwd: "/repo" }, deps);

    expect(exitCode).toBe(1);
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.files["/repo/.cf-safe-deploy.json"]).toBe(original);
  });

  it("does not treat an existing entry with a different region as a duplicate", () => {
    const existing = { allowedTargets: [{ org: "acme-dev", space: "web-apps", region: "us10" }] };
    const deps = makeDeps({ files: { "/repo/.cf-safe-deploy.json": JSON.stringify(existing) } });

    const exitCode = addTarget({ cwd: "/repo" }, deps);

    expect(exitCode).toBe(0);
    expect(deps.writeFile).toHaveBeenCalled();
  });

  it("does not treat an existing unregioned entry as a duplicate when the new entry pins a region", () => {
    const existing = { allowedTargets: [{ org: "acme-dev", space: "web-apps" }] };
    const deps = makeDeps({ files: { "/repo/.cf-safe-deploy.json": JSON.stringify(existing) } });

    const exitCode = addTarget({ cwd: "/repo", region: "eu10-004" }, deps);

    expect(exitCode).toBe(0);
    expect(deps.writeFile).toHaveBeenCalled();
  });

  it("exits 1 and does not write when cf target fails", () => {
    const exec: ExecFn = () => ({ status: 1, stdout: "FAILED\n", stderr: "Not logged in.\n" });
    const deps = makeDeps({ exec, files: {} });

    const exitCode = addTarget({ cwd: "/repo" }, deps);

    expect(exitCode).toBe(1);
    expect(deps.log.error).toHaveBeenCalledWith(expect.stringContaining("Not logged in"));
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("exits 1 on unparseable cf target output (missing org/space)", () => {
    const exec: ExecFn = () => ({ status: 0, stdout: "API endpoint: https://api.example.com\n", stderr: "" });
    const deps = makeDeps({ exec, files: {} });

    const exitCode = addTarget({ cwd: "/repo" }, deps);

    expect(exitCode).toBe(1);
    expect(deps.log.error).toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("respects an explicit --config path for both read and write", () => {
    const existing = { allowedTargets: [{ org: "acme-test", space: "web-apps" }] };
    const deps = makeDeps({ files: { "/repo/custom.json": JSON.stringify(existing) } });

    const exitCode = addTarget({ cwd: "/repo", configPath: "custom.json" }, deps);

    expect(exitCode).toBe(0);
    expect(deps.writeFile).toHaveBeenCalledWith("/repo/custom.json", expect.any(String));
    expect(deps.files["/repo/.cf-safe-deploy.json"]).toBeUndefined();
  });

  it("creates a new file at an explicit --config path even if it does not exist yet", () => {
    const deps = makeDeps({ files: {} });

    const exitCode = addTarget({ cwd: "/repo", configPath: "nested/custom.json" }, deps);

    expect(exitCode).toBe(0);
    expect(deps.writeFile).toHaveBeenCalledWith("/repo/nested/custom.json", expect.any(String));
  });

  it("exits 1 on an invalid existing config without modifying it", () => {
    const original = JSON.stringify({ allowedTargets: [], notAllowed: true });
    const deps = makeDeps({ files: { "/repo/.cf-safe-deploy.json": original } });

    const exitCode = addTarget({ cwd: "/repo" }, deps);

    expect(exitCode).toBe(1);
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.files["/repo/.cf-safe-deploy.json"]).toBe(original);
  });
});

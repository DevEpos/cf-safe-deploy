import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseCliArgs, main, USAGE } from "../src/cli.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

describe("parseCliArgs", () => {
  it("parses --yes and -y", () => {
    expect(parseCliArgs(["--yes"]).yes).toBe(true);
    expect(parseCliArgs(["-y"]).yes).toBe(true);
    expect(parseCliArgs([]).yes).toBe(false);
  });

  it("parses --config <path>", () => {
    expect(parseCliArgs(["--config", "./conf.json"]).config).toBe("./conf.json");
  });

  it("parses --help/-h and --version/-v", () => {
    expect(parseCliArgs(["--help"]).help).toBe(true);
    expect(parseCliArgs(["-h"]).help).toBe(true);
    expect(parseCliArgs(["--version"]).version).toBe(true);
    expect(parseCliArgs(["-v"]).version).toBe(true);
  });

  it("throws on unknown flags", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow(/--nope/);
  });

  it("throws on unknown positional arguments", () => {
    expect(() => parseCliArgs(["deploy"])).toThrow(/deploy/);
  });

  it("parses add-target as a subcommand", () => {
    expect(parseCliArgs(["add-target"])).toEqual({
      command: "add-target",
      config: undefined,
      help: false,
      region: undefined,
      requireBranch: undefined,
      requireUpToDate: false,
      warnProduction: false,
      noConfirm: false
    });
  });

  it("parses all add-target options", () => {
    expect(
      parseCliArgs([
        "add-target",
        "--region",
        "eu10-004",
        "--require-branch",
        "release",
        "--require-up-to-date",
        "--warn-production",
        "--no-confirm",
        "--config",
        "custom.json"
      ])
    ).toEqual({
      command: "add-target",
      config: "custom.json",
      help: false,
      region: "eu10-004",
      requireBranch: "release",
      requireUpToDate: true,
      warnProduction: true,
      noConfirm: true
    });
  });

  it("throws on unknown add-target flags", () => {
    expect(() => parseCliArgs(["add-target", "--nope"])).toThrow(/--nope/);
  });

  it("throws on extra positionals after add-target", () => {
    expect(() => parseCliArgs(["add-target", "extra"])).toThrow(/extra/);
  });
});

describe("main", () => {
  const makeOverrides = () => ({
    print: vi.fn(),
    log: { info: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    verify: vi.fn(async (): Promise<0 | 1> => 0)
  });

  it("prints usage for --help and exits 0", async () => {
    const overrides = makeOverrides();
    expect(await main(["--help"], overrides)).toBe(0);
    expect(overrides.print).toHaveBeenCalledWith(USAGE);
    expect(overrides.verify).not.toHaveBeenCalled();
  });

  it("prints the package version for --version and exits 0", async () => {
    const overrides = makeOverrides();
    expect(await main(["--version"], overrides)).toBe(0);
    expect(overrides.print).toHaveBeenCalledWith(pkg.version);
  });

  it("rejects unknown flags with usage and exit code 1", async () => {
    const overrides = makeOverrides();
    expect(await main(["--frobnicate"], overrides)).toBe(1);
    expect(overrides.log.error).toHaveBeenCalled();
    expect(overrides.print).toHaveBeenCalledWith(USAGE);
    expect(overrides.verify).not.toHaveBeenCalled();
  });

  it("forwards parsed options to verify", async () => {
    const overrides = makeOverrides();
    expect(await main(["--yes", "--config", "c.json"], overrides)).toBe(0);
    expect(overrides.verify).toHaveBeenCalledWith(
      expect.objectContaining({ yes: true, configPath: "c.json" }),
      expect.anything()
    );
  });

  it("propagates verify's exit code", async () => {
    const overrides = makeOverrides();
    overrides.verify = vi.fn(async (): Promise<0 | 1> => 1);
    expect(await main([], overrides)).toBe(1);
  });

  it("routes add-target to addTarget with parsed options", async () => {
    const overrides = { ...makeOverrides(), addTarget: vi.fn((): 0 | 1 => 0) };
    expect(await main(["add-target", "--region", "eu10-004", "--config", "c.json", "--no-confirm"], overrides)).toBe(0);
    expect(overrides.addTarget).toHaveBeenCalledWith(
      expect.objectContaining({ region: "eu10-004", configPath: "c.json", noConfirm: true }),
      expect.anything()
    );
    expect(overrides.verify).not.toHaveBeenCalled();
  });

  it("propagates addTarget's exit code", async () => {
    const overrides = { ...makeOverrides(), addTarget: vi.fn((): 0 | 1 => 1) };
    expect(await main(["add-target"], overrides)).toBe(1);
  });
});

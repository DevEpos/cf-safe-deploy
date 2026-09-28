import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONFIG_FILE_NAME, findConfigPath, loadConfig, validateConfig } from "../src/config.js";

const VALID = { allowedTargets: [{ org: "acme-dev", space: "web-apps" }] };

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "cf-safe-deploy-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const writeConfig = (dir: string, config: unknown): string => {
  const file = path.join(dir, CONFIG_FILE_NAME);
  writeFileSync(file, typeof config === "string" ? config : JSON.stringify(config));
  return file;
};

describe("findConfigPath", () => {
  it("finds the config in the start directory", () => {
    const file = writeConfig(root, VALID);
    expect(findConfigPath(root)).toBe(file);
  });

  it("searches upward to parent directories", () => {
    const file = writeConfig(root, VALID);
    const nested = path.join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findConfigPath(nested)).toBe(file);
  });

  it("stops at the first match", () => {
    writeConfig(root, VALID);
    const nested = path.join(root, "a");
    mkdirSync(nested);
    const nestedFile = writeConfig(nested, VALID);
    expect(findConfigPath(nested)).toBe(nestedFile);
  });

  it("returns undefined when no config exists up to the filesystem root", () => {
    // use an `exists` stub so the walk never accidentally hits a real config above the temp dir
    expect(findConfigPath(path.join(root, "a", "b"), { exists: () => false })).toBeUndefined();
  });
});

describe("loadConfig", () => {
  it("loads and normalizes a valid config discovered from cwd", () => {
    writeConfig(root, { allowedTargets: [{ org: "acme-dev", space: "web-apps", requireBranch: "release" }] });
    const config = loadConfig({ cwd: root });
    expect(config.allowedTargets).toEqual([
      {
        org: "acme-dev",
        space: "web-apps",
        requireBranch: "release",
        requireUpToDate: false,
        warnProduction: false,
        confirm: true
      }
    ]);
  });

  it("prefers an explicit configPath over discovery", () => {
    writeConfig(root, { allowedTargets: [{ org: "from-discovery", space: "x" }] });
    const explicit = path.join(root, "custom.json");
    writeFileSync(explicit, JSON.stringify({ allowedTargets: [{ org: "explicit", space: "y" }] }));
    const config = loadConfig({ cwd: root, configPath: explicit });
    expect(config.allowedTargets[0].org).toBe("explicit");
  });

  it("fails when no config can be found", () => {
    expect(() => loadConfig({ cwd: root, exists: () => false })).toThrow(CONFIG_FILE_NAME);
  });

  it("fails when the explicit configPath does not exist", () => {
    expect(() => loadConfig({ cwd: root, configPath: path.join(root, "nope.json") })).toThrow(/nope\.json/);
  });

  it("fails on invalid JSON", () => {
    writeConfig(root, "{ not json");
    expect(() => loadConfig({ cwd: root })).toThrow(/JSON/i);
  });
});

describe("validateConfig", () => {
  it("rejects a non-object root", () => {
    expect(() => validateConfig([])).toThrow(/object/i);
    expect(() => validateConfig(null)).toThrow(/object/i);
    expect(() => validateConfig("hi")).toThrow(/object/i);
  });

  it("rejects unknown top-level keys by name", () => {
    expect(() => validateConfig({ ...VALID, allowedTarget: [] })).toThrow(/allowedTarget/);
  });

  it("requires allowedTargets", () => {
    expect(() => validateConfig({})).toThrow(/allowedTargets/);
  });

  it("rejects a non-array allowedTargets", () => {
    expect(() => validateConfig({ allowedTargets: "acme-dev" })).toThrow(/allowedTargets/);
  });

  it("rejects an empty allowedTargets array", () => {
    expect(() => validateConfig({ allowedTargets: [] })).toThrow(/non-empty/i);
  });

  it("rejects a target that is not an object, naming the index", () => {
    expect(() => validateConfig({ allowedTargets: ["acme-dev/web-apps"] })).toThrow(/allowedTargets\[0\]/);
  });

  it("requires org and space per target, naming key and index", () => {
    expect(() => validateConfig({ allowedTargets: [{ space: "x" }] })).toThrow(/allowedTargets\[0\]\.org/);
    expect(() => validateConfig({ allowedTargets: [{ org: "x" }] })).toThrow(/allowedTargets\[0\]\.space/);
  });

  it("rejects non-string org/space", () => {
    expect(() => validateConfig({ allowedTargets: [{ org: 1, space: "x" }] })).toThrow(/allowedTargets\[0\]\.org/);
    expect(() => validateConfig({ allowedTargets: [{ org: "x", space: true }] })).toThrow(/allowedTargets\[0\]\.space/);
  });

  it("rejects empty org/space strings", () => {
    expect(() => validateConfig({ allowedTargets: [{ org: "", space: "x" }] })).toThrow(/allowedTargets\[0\]\.org/);
  });

  it("rejects a non-string requireBranch", () => {
    expect(() => validateConfig({ allowedTargets: [{ org: "a", space: "b", requireBranch: true }] })).toThrow(
      /allowedTargets\[0\]\.requireBranch/
    );
  });

  it("rejects non-boolean flags", () => {
    for (const key of ["requireUpToDate", "warnProduction", "confirm"]) {
      expect(() => validateConfig({ allowedTargets: [{ org: "a", space: "b", [key]: "yes" }] })).toThrow(
        new RegExp(`allowedTargets\\[0\\]\\.${key}`)
      );
    }
  });

  it("rejects unknown per-target keys by name and index", () => {
    expect(() =>
      validateConfig({ allowedTargets: [VALID.allowedTargets[0], { org: "a", space: "b", requireBrunch: "x" }] })
    ).toThrow(/allowedTargets\[1\].*requireBrunch/);
  });

  it("applies defaults (confirm true, booleans false)", () => {
    const config = validateConfig(VALID);
    expect(config.allowedTargets[0]).toEqual({
      org: "acme-dev",
      space: "web-apps",
      requireBranch: undefined,
      requireUpToDate: false,
      warnProduction: false,
      confirm: true
    });
  });

  it("keeps an explicit confirm: false", () => {
    const config = validateConfig({ allowedTargets: [{ org: "a", space: "b", confirm: false }] });
    expect(config.allowedTargets[0].confirm).toBe(false);
  });

  it("accepts an optional region string", () => {
    const config = validateConfig({ allowedTargets: [{ org: "a", space: "b", region: "eu10-004" }] });
    expect(config.allowedTargets[0].region).toBe("eu10-004");
  });

  it("leaves region undefined when not configured", () => {
    const config = validateConfig(VALID);
    expect(config.allowedTargets[0].region).toBeUndefined();
  });

  it("rejects a non-string region, naming key and index", () => {
    expect(() => validateConfig({ allowedTargets: [{ org: "a", space: "b", region: 10 }] })).toThrow(
      /allowedTargets\[0\]\.region/
    );
  });

  it("rejects an empty region string", () => {
    expect(() => validateConfig({ allowedTargets: [{ org: "a", space: "b", region: "  " }] })).toThrow(
      /allowedTargets\[0\]\.region/
    );
  });
});

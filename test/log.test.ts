import { describe, it, expect, vi } from "vitest";
import { colorsEnabled, createColors, createLogger } from "../src/log.js";

describe("colorsEnabled", () => {
  it("is true for a TTY stream without NO_COLOR", () => {
    expect(colorsEnabled({ env: {}, stream: { isTTY: true } })).toBe(true);
  });

  it("is false when NO_COLOR is set", () => {
    expect(colorsEnabled({ env: { NO_COLOR: "1" }, stream: { isTTY: true } })).toBe(false);
  });

  it("is false when NO_COLOR is set to an empty string", () => {
    expect(colorsEnabled({ env: { NO_COLOR: "" }, stream: { isTTY: true } })).toBe(false);
  });

  it("is false for a non-TTY stream", () => {
    expect(colorsEnabled({ env: {}, stream: { isTTY: false } })).toBe(false);
    expect(colorsEnabled({ env: {}, stream: {} })).toBe(false);
  });
});

describe("createColors", () => {
  it("wraps messages in ANSI codes when enabled", () => {
    const colors = createColors(true);
    expect(colors.red("boom")).toBe("\x1b[31mboom\x1b[0m");
    expect(colors.green("ok")).toBe("\x1b[32mok\x1b[0m");
  });

  it("returns plain text when disabled", () => {
    const colors = createColors(false);
    expect(colors.red("boom")).toBe("boom");
    expect(colors.yellow("hm")).toBe("hm");
  });
});

describe("createLogger", () => {
  it("prefixes every line with the logger id and level", () => {
    const out = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger("cf-safe-deploy", { colorEnabled: false, out });

    log.info("hello");
    log.warn("careful");
    log.error("boom");

    expect(out.info).toHaveBeenCalledWith("[cf-safe-deploy] [info]", "hello");
    expect(out.warn).toHaveBeenCalledWith("[cf-safe-deploy] [warn]", "careful");
    expect(out.error).toHaveBeenCalledWith("[cf-safe-deploy] [error]", "boom");
  });

  it("colors the prefix when colors are enabled", () => {
    const out = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger("cf-safe-deploy", { colorEnabled: true, out });

    log.info("hello");

    const [prefix] = out.info.mock.calls[0];
    expect(prefix).toContain("\x1b[36m[cf-safe-deploy]\x1b[0m");
    expect(prefix).toContain("\x1b[32m[info]\x1b[0m");
  });
});

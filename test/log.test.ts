import { describe, it, expect, vi } from "vitest";
import { colorsEnabled, createColors, createLogger, icon, detailLine, banner, ICONS } from "../src/log.js";

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
  it("passes messages through without any id/level prefix", () => {
    const out = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger("cf-safe-deploy", { colorEnabled: false, out });

    log.info("hello");
    log.warn("careful");
    log.error("boom");

    expect(out.info).toHaveBeenCalledWith("hello");
    expect(out.warn).toHaveBeenCalledWith("careful");
    expect(out.error).toHaveBeenCalledWith("boom");
  });
});

describe("icon", () => {
  it("returns the emoji when rich output is enabled", () => {
    expect(icon("ok", true)).toBe(ICONS.ok.emoji);
    expect(icon("fail", true)).toBe(ICONS.fail.emoji);
  });

  it("returns the ASCII fallback when rich output is disabled", () => {
    expect(icon("ok", false)).toBe("[OK]");
    expect(icon("fail", false)).toBe("[FAIL]");
    expect(icon("org", false)).toBe("-");
  });
});

describe("detailLine", () => {
  it("builds an indented, icon-prefixed, padded field line (rich)", () => {
    expect(detailLine("org", true, "CF Org:", "acme-dev")).toBe(`    ${ICONS.org.emoji}  CF Org:       acme-dev`);
  });

  it("falls back to the ASCII tag when rich output is disabled", () => {
    expect(detailLine("org", false, "CF Org:", "acme-dev")).toBe("    -  CF Org:       acme-dev");
  });
});

describe("banner", () => {
  it("draws a Unicode box in rich mode, sized to the longest visible line", () => {
    const lines = banner(["short", "a longer line"], { rich: true, colorEnabled: false });

    expect(lines).toHaveLength(4);
    const [top, row1, row2, bottom] = lines;
    expect(top).toBe(`┌${"─".repeat(15)}┐`);
    expect(bottom).toBe(`└${"─".repeat(15)}┘`);
    expect(row1).toBe(`│ short         │`);
    expect(row2).toBe(`│ a longer line │`);
    // All rows share the same visible width.
    const widths = new Set(lines.map((line) => line.length));
    expect(widths.size).toBe(1);
  });

  it("strips ANSI codes when measuring width, so colored content doesn't skew the box", () => {
    const colors = createColors(true);
    const lines = banner([`This is ${colors.red("PRODUCTION")}`, "short"], { rich: true, colorEnabled: false });

    const widths = new Set(lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").length));
    expect(widths.size).toBe(1);
  });

  it("falls back to ASCII borders with no ANSI escapes when rich/color are disabled", () => {
    const lines = banner(["hello"], { rich: false, colorEnabled: false });

    expect(lines).toEqual([`+${"-".repeat(7)}+`, "| hello |", `+${"-".repeat(7)}+`]);
    for (const line of lines) {
      expect(line).not.toMatch(/\x1b\[/);
    }
    expect(lines.join("\n")).not.toMatch(/[┌┐└┘│─]/);
  });

  it("paints the border red when colorEnabled is true, independent of content coloring", () => {
    const lines = banner(["hello"], { rich: true, colorEnabled: true });
    const [top, row, bottom] = lines;

    expect(top).toBe(`\x1b[31m┌${"─".repeat(7)}┐\x1b[0m`);
    expect(bottom).toBe(`\x1b[31m└${"─".repeat(7)}┘\x1b[0m`);
    expect(row).toBe(`\x1b[31m│\x1b[0m hello \x1b[31m│\x1b[0m`);
  });

  it("renders one padded content row per input line, all the same width", () => {
    const lines = banner(["a", "bb", "ccc"], { rich: false, colorEnabled: false });

    expect(lines).toHaveLength(5);
    const [top, r1, r2, r3, bottom] = lines;
    expect(top).toBe(bottom);
    expect(r1).toBe("| a   |");
    expect(r2).toBe("| bb  |");
    expect(r3).toBe("| ccc |");
    expect(new Set([r1, r2, r3].map((line) => line.length)).size).toBe(1);
  });

  // https://github.com/DevEpos/cf-safe-deploy — regression: variation selectors
  // (e.g. the U+FE0F in the "⚠️" icon) are zero-width on a real terminal but
  // were previously counted as a full column via String#length, shifting the
  // right border of any row containing one column to the left of the others.
  it("aligns borders for lines containing an emoji+variation-selector icon", () => {
    const displayWidth = (line: string): number =>
      line.replace(/\x1b\[[0-9;]*m/g, "").replace(/[\uFE0E\uFE0F]/g, "").length;

    const lines = banner(["⚠️ PRODUCTION DEPLOYMENT TARGET", "Proceed with caution — this action is not reversible."], {
      rich: true,
      colorEnabled: false
    });

    const widths = new Set(lines.map(displayWidth));
    expect(widths.size).toBe(1);
  });

  it("does not let the em dash (a normal-width character) skew the box", () => {
    const lines = banner(["short", "a — dash"], { rich: true, colorEnabled: false });

    const widths = new Set(lines.map((line) => line.length));
    expect(widths.size).toBe(1);
  });
});

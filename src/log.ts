const ANSI = {
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  reset: "\x1b[0m"
} as const;

export interface ColorStream {
  isTTY?: boolean;
}

export type ColorFn = (msg: string) => string;

export interface Colors {
  cyan: ColorFn;
  blue: ColorFn;
  green: ColorFn;
  yellow: ColorFn;
  red: ColorFn;
}

export type LogFn = (...args: unknown[]) => void;

export interface Logger {
  info: LogFn;
  log: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
}

export type LogSink = Pick<Console, "info" | "warn" | "error" | "debug">;

type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Colors are used only if stdout is a TTY and NO_COLOR is not set (https://no-color.org).
 */
export function colorsEnabled({
  env = process.env,
  stream = process.stdout
}: { env?: Record<string, string | undefined>; stream?: ColorStream } = {}): boolean {
  return !("NO_COLOR" in env) && Boolean(stream.isTTY);
}

export function createColors(enabled: boolean): Colors {
  const paint =
    (color: string): ColorFn =>
    (msg) =>
      enabled ? `${color}${msg}${ANSI.reset}` : String(msg);
  return {
    cyan: paint(ANSI.cyan),
    blue: paint(ANSI.blue),
    green: paint(ANSI.green),
    yellow: paint(ANSI.yellow),
    red: paint(ANSI.red)
  };
}

/**
 * Creates a simple logger. `id` is kept for call-site compatibility but no longer printed.
 */
export function createLogger(
  id: string,
  { colorEnabled = colorsEnabled(), out = console }: { colorEnabled?: boolean; out?: LogSink } = {}
): Logger {
  const log = (level: LogLevel, ...args: unknown[]): void => {
    out[level](...args);
  };

  return {
    info: (...args) => log("info", ...args),
    log: (...args) => log("info", ...args),
    warn: (...args) => log("warn", ...args),
    error: (...args) => log("error", ...args),
    debug: (...args) => log("debug", ...args)
  };
}

export const ICONS = {
  target: { emoji: "🔎", ascii: "[..]" },
  source: { emoji: "🌿", ascii: "[..]" },
  org: { emoji: "🏢", ascii: "-" },
  space: { emoji: "📦", ascii: "-" },
  region: { emoji: "🌍", ascii: "-" },
  endpoint: { emoji: "🔗", ascii: "-" },
  branch: { emoji: "🔀", ascii: "-" },
  save: { emoji: "💾", ascii: "[OK]" },
  ok: { emoji: "✅", ascii: "[OK]" },
  warn: { emoji: "⚠️", ascii: "[WARN]" },
  fail: { emoji: "❌", ascii: "[FAIL]" },
  confirm: { emoji: "❓", ascii: "[?]" }
} as const;

export type IconKey = keyof typeof ICONS;

export function icon(key: IconKey, richEnabled: boolean): string {
  return richEnabled ? ICONS[key].emoji : ICONS[key].ascii;
}

export function detailLine(key: IconKey, richEnabled: boolean, label: string, value: string): string {
  return `    ${icon(key, richEnabled)}  ${label.padEnd(14)}${value}`;
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_ESCAPE_PATTERN, "");
}

// Variation selectors (U+FE0E "text style", U+FE0F "emoji style") only pick
// a presentation for the preceding character — they occupy zero terminal
// columns. `String#length` still counts each as its own UTF-16 code unit
// (e.g. "⚠️" = U+26A0 + U+FE0F -> length 2), which overcounts the rendered
// width of any icon that uses one and shifts box borders left of where they
// should be. Every other emoji used by this module is a single astral-plane
// codepoint, whose UTF-16 surrogate pair already happens to match its
// 2-column render width, so stripping the selector is the only correction
// needed here.
const VARIATION_SELECTOR_PATTERN = /[\uFE0E\uFE0F]/g;

/** Approximates the number of terminal columns a (possibly ANSI-colored) string renders as. */
function displayWidth(str: string): number {
  return stripAnsi(str).replace(VARIATION_SELECTOR_PATTERN, "").length;
}

const BOX_CHARS = {
  rich: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: "│" },
  ascii: { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|" }
} as const;

/**
 * Renders `lines` inside a bordered box, one rendered string per output row
 * (top border, one row per content line, bottom border). Box width is
 * derived from the longest *visible* line (ANSI escape codes are stripped
 * before measuring). Uses Unicode box-drawing characters when `rich` is
 * true, plain ASCII (`+`/`-`/`|`) otherwise. When `colorEnabled` is true,
 * the border itself is painted red, independent of any coloring already
 * applied inside `lines`.
 */
export function banner(lines: string[], { rich, colorEnabled }: { rich: boolean; colorEnabled: boolean }): string[] {
  const border = createColors(colorEnabled).red;
  const chars = rich ? BOX_CHARS.rich : BOX_CHARS.ascii;
  const width = Math.max(...lines.map((line) => displayWidth(line)));

  const top = border(`${chars.topLeft}${chars.horizontal.repeat(width + 2)}${chars.topRight}`);
  const bottom = border(`${chars.bottomLeft}${chars.horizontal.repeat(width + 2)}${chars.bottomRight}`);
  const content = lines.map((line) => {
    const pad = " ".repeat(width - displayWidth(line));
    return `${border(chars.vertical)} ${line}${pad} ${border(chars.vertical)}`;
  });

  return [top, ...content, bottom];
}

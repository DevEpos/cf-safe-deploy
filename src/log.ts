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
 * Creates a simple logger with a colored `[id] [level]` prefix.
 */
export function createLogger(
  id: string,
  { colorEnabled = colorsEnabled(), out = console }: { colorEnabled?: boolean; out?: LogSink } = {}
): Logger {
  const colors = createColors(colorEnabled);
  const levelColors: Record<LogLevel, ColorFn> = {
    debug: colors.blue,
    info: colors.green,
    warn: colors.yellow,
    error: colors.red
  };
  const log = (level: LogLevel, ...args: unknown[]): void => {
    out[level](`${colors.cyan(`[${id}]`)} ${levelColors[level](`[${level}]`)}`, ...args);
  };

  return {
    info: (...args) => log("info", ...args),
    log: (...args) => log("info", ...args),
    warn: (...args) => log("warn", ...args),
    error: (...args) => log("error", ...args),
    debug: (...args) => log("debug", ...args)
  };
}

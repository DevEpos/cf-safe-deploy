import { describe, it, expect } from "vitest";
import { getCurrentBranch, getBehindCount } from "../src/git.js";
import type { ExecFn, ExecResult } from "../src/exec.js";

const execFor =
  (results: Record<string, Partial<ExecResult>>): ExecFn =>
  (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    const result = results[key];
    if (!result) throw new Error(`unexpected command in test: ${key}`);
    return { status: 0, stdout: "", stderr: "", ...result };
  };

describe("getCurrentBranch", () => {
  it("returns the trimmed branch name", () => {
    const exec = execFor({ "git rev-parse --abbrev-ref HEAD": { stdout: "release\n" } });
    expect(getCurrentBranch({ exec })).toBe("release");
  });

  it("fails when not inside a git repository", () => {
    const exec = execFor({
      "git rev-parse --abbrev-ref HEAD": { status: 128, stderr: "fatal: not a git repository\n" }
    });
    expect(() => getCurrentBranch({ exec })).toThrow(/not a git repository/);
  });

  it("fails when git itself is missing", () => {
    const exec: ExecFn = () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn git ENOENT") });
    expect(() => getCurrentBranch({ exec })).toThrow(/ENOENT/);
  });
});

describe("getBehindCount", () => {
  it("fetches first and returns the number of commits behind upstream", () => {
    const calls: string[] = [];
    const exec: ExecFn = (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      if (args[0] === "fetch") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "3\n", stderr: "" };
    };
    expect(getBehindCount({ exec })).toBe(3);
    expect(calls[0]).toBe("git fetch --quiet");
    expect(calls[1]).toBe("git rev-list --count HEAD..@{u}");
  });

  it("fails closed when git fetch fails", () => {
    const exec = execFor({
      "git fetch --quiet": { status: 1, stderr: "fatal: could not read from remote\n" }
    });
    expect(() => getBehindCount({ exec })).toThrow(/git fetch/);
  });

  it("fails when the branch has no upstream tracking branch", () => {
    const exec = execFor({
      "git fetch --quiet": { status: 0 },
      "git rev-list --count HEAD..@{u}": { status: 128, stderr: "fatal: no upstream configured for branch 'x'\n" }
    });
    expect(() => getBehindCount({ exec })).toThrow(/upstream/);
  });
});

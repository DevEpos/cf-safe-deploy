import { describe, it, expect } from "vitest";
import { parseCfTarget, getCfTarget, extractRegion } from "../src/cf-target.js";
import type { ExecFn } from "../src/exec.js";

const CF_TARGET_OUTPUT = [
  "API endpoint:   https://api.cf.eu10-004.hana.ondemand.com",
  "API version:    3.166.0",
  "user:           deploy.user@example.com",
  "org:            acme-dev",
  "space:          web-apps",
  ""
].join("\n");

describe("extractRegion", () => {
  it("extracts a multi-segment region from a BTP-style endpoint", () => {
    expect(extractRegion("https://api.cf.eu10-004.hana.ondemand.com")).toBe("eu10-004");
  });

  it("extracts a simple region", () => {
    expect(extractRegion("https://api.cf.us10.hana.ondemand.com")).toBe("us10");
  });

  it("supports http as well as https", () => {
    expect(extractRegion("http://api.cf.eu10.hana.ondemand.com")).toBe("eu10");
  });

  it("matches case-insensitively", () => {
    expect(extractRegion("HTTPS://API.CF.EU10.hana.ondemand.com")).toBe("EU10");
  });

  it("tolerates surrounding whitespace", () => {
    expect(extractRegion("  https://api.cf.eu10-004.hana.ondemand.com  ")).toBe("eu10-004");
  });

  it("tolerates a trailing path and port", () => {
    expect(extractRegion("https://api.cf.eu10-004.hana.ondemand.com:443/v3")).toBe("eu10-004");
  });

  it("returns undefined for non-BTP-style endpoints", () => {
    expect(extractRegion("https://api.example.com")).toBeUndefined();
    expect(extractRegion("https://cf.eu10.example.com")).toBeUndefined();
    expect(extractRegion("not a url")).toBeUndefined();
  });

  it("returns undefined for a missing endpoint", () => {
    expect(extractRegion(undefined)).toBeUndefined();
  });
});

describe("parseCfTarget", () => {
  it("parses org, space and API endpoint from realistic cf target output", () => {
    expect(parseCfTarget(CF_TARGET_OUTPUT)).toEqual({
      org: "acme-dev",
      space: "web-apps",
      apiEndpoint: "https://api.cf.eu10-004.hana.ondemand.com"
    });
  });

  it("keeps extra colons inside the value", () => {
    const output = "org:  my:org\nspace:  my:space  ";
    expect(parseCfTarget(output)).toEqual({ org: "my:org", space: "my:space", apiEndpoint: undefined });
  });

  it("handles indented lines and surrounding whitespace", () => {
    const output = "  org: acme-dev  \n\t space: web-apps \n";
    expect(parseCfTarget(output)).toEqual({ org: "acme-dev", space: "web-apps", apiEndpoint: undefined });
  });

  it("returns undefined fields when org/space lines are missing", () => {
    expect(parseCfTarget("API endpoint: https://api.example.com\nuser: foo")).toEqual({
      org: undefined,
      space: undefined,
      apiEndpoint: "https://api.example.com"
    });
    expect(parseCfTarget("")).toEqual({ org: undefined, space: undefined, apiEndpoint: undefined });
  });
});

describe("getCfTarget", () => {
  it("returns the parsed target with endpoint and extracted region on success", () => {
    const exec: ExecFn = () => ({ status: 0, stdout: CF_TARGET_OUTPUT, stderr: "" });
    expect(getCfTarget({ exec })).toEqual({
      org: "acme-dev",
      space: "web-apps",
      apiEndpoint: "https://api.cf.eu10-004.hana.ondemand.com",
      region: "eu10-004"
    });
  });

  it("returns an undefined region for non-BTP-style endpoints", () => {
    const exec: ExecFn = () => ({
      status: 0,
      stdout: "API endpoint: https://api.example.com\norg: acme-dev\nspace: web-apps\n",
      stderr: ""
    });
    expect(getCfTarget({ exec })).toEqual({
      org: "acme-dev",
      space: "web-apps",
      apiEndpoint: "https://api.example.com",
      region: undefined
    });
  });

  it("fails with the spawn error when the cf CLI is missing", () => {
    const exec: ExecFn = () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn cf ENOENT") });
    expect(() => getCfTarget({ exec })).toThrow(/ENOENT/);
  });

  it("fails with the cf output when cf target exits non-zero (e.g. not logged in)", () => {
    const exec: ExecFn = () => ({ status: 1, stdout: "FAILED\n", stderr: "Not logged in. Use 'cf login'.\n" });
    expect(() => getCfTarget({ exec })).toThrow(/Not logged in/);
  });

  it("fails when no org/space is set (no error but missing lines)", () => {
    const exec: ExecFn = () => ({ status: 0, stdout: "API endpoint: https://api.example.com\n", stderr: "" });
    expect(() => getCfTarget({ exec })).toThrow(/org.*space/i);
  });
});

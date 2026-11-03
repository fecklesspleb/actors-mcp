// Runs scripts/e2e.mjs with a dummy APIFY_TOKEN against a local mock Apify API (and an unreachable one),
// then checks that the token never appears in stdout, stderr or e2e-result.json.
// Needs dist/ (npm test builds it first).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { redactToken } from "../src/apify.js";

const ROOT = join(__dirname, "..");
const RESULT = join(ROOT, "e2e-result.json");
const DUMMY = "dummy-e2e-token-7f3c9a1e5b";

type Mode = "ok" | "reject" | "noCharges" | "lateCharges";
let mode: Mode = "ok";
let runLookups = 0;
let server: Server;
let base = "";

beforeAll(async () => {
  if (!existsSync(join(ROOT, "dist", "index.js"))) throw new Error("dist/index.js missing; run npm run build");
  server = createServer((req, res) => {
    // Deliberately hostile: every response reflects the Authorization header back.
    const auth = String(req.headers.authorization ?? "");
    const reflected = `${auth} ${auth.replace(/^Bearer\s+/i, "")}`;
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.includes("/run-sync-get-dataset-items")) {
        if (mode === "reject") {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: { type: "token-not-valid", message: `Bad token: ${reflected}` } }));
          return;
        }
        const items = Array.from({ length: 5 }, (_, i) => ({ title: `Story ${i} ${reflected}`, url: `https://example.com/${i}` }));
        res.end(JSON.stringify(items));
        return;
      }
      if (req.url?.endsWith("/runs/last")) {
        runLookups++;
        const charged = mode === "noCharges" || (mode === "lateCharges" && runLookups < 2) ? {} : { item: 5 };
        res.end(
          JSON.stringify({
            data: {
              id: "MockRunId123",
              status: "SUCCEEDED",
              startedAt: new Date().toISOString(),
              chargedEventCounts: charged,
              pricingInfo: { pricingModel: "PAY_PER_EVENT", pricingPerEvent: { actorChargeEvents: { item: { eventPriceUsd: 0.00015 } } } },
              options: { reflected }
            }
          })
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: `not found ${reflected}` } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/v2`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(RESULT, { force: true });
});

function runE2e(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, "scripts", "e2e.mjs")], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "", FECKLESSPLEB_LIVE_SCHEMAS: "0", ...env }
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

function expectNoToken(out: string) {
  expect(out).not.toContain(DUMMY);
  if (existsSync(RESULT)) expect(readFileSync(RESULT, "utf8")).not.toContain(DUMMY);
}

describe("e2e script never leaks the token", () => {
  it("fails cleanly with no token and writes nothing", async () => {
    const { code, out } = await runE2e({});
    expect(code).toBe(2);
    expect(out).toContain("APIFY_TOKEN is not set");
    expect(existsSync(RESULT)).toBe(false);
  }, 30_000);

  it("redacts a token that a failing API reflects back", async () => {
    mode = "reject";
    const { code, out } = await runE2e({ APIFY_TOKEN: DUMMY, APIFY_API_BASE_URL: base });
    expect(code).toBe(1);
    expect(out).toContain("e2e FAILED");
    expect(out).toContain("[redacted]");
    expectNoToken(out);
    expect(existsSync(RESULT)).toBe(false);
  }, 30_000);

  it("fails cleanly against an unreachable endpoint", async () => {
    const { code, out } = await runE2e({ APIFY_TOKEN: DUMMY, APIFY_API_BASE_URL: "http://127.0.0.1:9/v2" });
    expect(code).toBe(1);
    expect(out).toContain("Could not reach the Apify API");
    expectNoToken(out);
  }, 30_000);

  it("refuses a plain-http API base URL on a remote host before sending the token", async () => {
    const { code, out } = await runE2e({ APIFY_TOKEN: DUMMY, APIFY_API_BASE_URL: "http://api.apify.com/v2" });
    expect(code).toBe(2);
    expect(out).toContain("APIFY_API_BASE_URL must use https");
    expectNoToken(out);
    expect(existsSync(RESULT)).toBe(false);
  }, 30_000);

  it("reports the cost as unknown, never $0, when Apify reports no charges", async () => {
    mode = "noCharges";
    runLookups = 0;
    const { code, out } = await runE2e({ APIFY_TOKEN: DUMMY, APIFY_API_BASE_URL: base });
    expect(code, out).toBe(0);
    expect(runLookups).toBe(3);
    expect(out).toContain("charged: unknown");
    expect(out).not.toContain("charged: $0");
    expectNoToken(out);
    const file = JSON.parse(readFileSync(RESULT, "utf8"));
    expect(file).toMatchObject({ runId: "MockRunId123", itemCount: 5, usageCostUsd: null });
  }, 30_000);

  it("looks the run up again when the charges arrive late", async () => {
    mode = "lateCharges";
    runLookups = 0;
    const { code, out } = await runE2e({ APIFY_TOKEN: DUMMY, APIFY_API_BASE_URL: base });
    expect(code, out).toBe(0);
    expect(runLookups).toBe(2);
    expect(out).toContain("charged: $0.00075");
    expectNoToken(out);
    expect(JSON.parse(readFileSync(RESULT, "utf8")).usageCostUsd).toBe(0.00075);
  }, 30_000);

  it("on success writes only the allowed fields, with no items and no token", async () => {
    mode = "ok";
    const { code, out } = await runE2e({ APIFY_TOKEN: DUMMY, APIFY_API_BASE_URL: base });
    expect(code, out).toBe(0);
    expectNoToken(out);
    expect(out).not.toContain("Story 0");
    const file = JSON.parse(readFileSync(RESULT, "utf8"));
    expect(Object.keys(file).sort()).toEqual(["itemCount", "runId", "runStatus", "tools", "usageCostUsd"]);
    expect(file.tools).toContain("search_hacker_news");
    expect(file).toMatchObject({ runId: "MockRunId123", runStatus: "SUCCEEDED", itemCount: 5, usageCostUsd: 0.00075 });
  }, 30_000);
});

describe("redactToken", () => {
  it("removes the token, bearer values and token query params", () => {
    const t = "abc/def+123";
    const s = redactToken(`x ${t} ${encodeURIComponent(t)} Bearer zzz ?token=qqq&a=1`, t);
    expect(s).not.toContain(t);
    expect(s).not.toContain(encodeURIComponent(t));
    expect(s).not.toContain("zzz");
    expect(s).not.toContain("qqq");
  });
});

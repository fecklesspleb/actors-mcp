#!/usr/bin/env node
// End-to-end check: start the built server (dist/index.js) over stdio as a real MCP client,
// list the tools, and make ONE paid call: search_hacker_news (fecklesspleb/hacker-news-scraper)
// with maxItems 5 and a $0.25 cost cap. At $0.00015 per item, that call costs about $0.00075.
//
// Writes e2e-result.json with only: tools, runId, runStatus, itemCount, usageCostUsd.
// The token comes only from the APIFY_TOKEN environment variable. It is sent only in the
// Authorization header to the Apify API, and is never printed or written: every line this
// script prints, and the result file, is passed through redact() first and checked again.
//
// Exit codes: 0 pass, 1 the call or a check failed, 2 APIFY_TOKEN missing, dist not built or
// APIFY_API_BASE_URL not allowed (https only; plain http only for localhost, 127.0.0.1 and ::1).

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "dist", "index.js");
const RESULT_FILE = join(ROOT, "e2e-result.json");
const TOOL = "search_hacker_news";
const ACTOR = "fecklesspleb~hacker-news-scraper";
const ARGS = { mode: "search", query: "MCP", maxItems: 5, maxCostUsd: 0.25 };

const TOKEN = process.env.APIFY_TOKEN ?? "";
let API = "https://api.apify.com/v2";

function apiBase(value) {
  if (!value) return "https://api.apify.com/v2";
  const u = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname.toLowerCase());
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) {
    throw new Error("APIFY_API_BASE_URL must use https (plain http is allowed only for localhost, 127.0.0.1 and ::1)");
  }
  return value.replace(/\/+$/, "");
}

/** Strip the token, and anything that looks like a credential, from text before it leaves this process. */
function redact(value) {
  let text = String(value);
  if (TOKEN) {
    for (const form of new Set([TOKEN, encodeURIComponent(TOKEN)])) text = text.split(form).join("[redacted]");
  }
  return text
    .replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [redacted]")
    .replace(/([?&]token=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/apify_api_[A-Za-z0-9]+/g, "[redacted]");
}

// Error objects are reduced to their message; stacks, causes and request details are never printed.
const say = (msg) => process.stdout.write(redact(msg) + "\n");
const fail = (msg, code = 1) => {
  process.stderr.write("e2e FAILED: " + redact(msg) + "\n");
  process.exit(code);
};
const errMessage = (err) => (err && typeof err.message === "string" ? err.message : "unknown error");

// Apify can fill in a run's charged event counts a few seconds after the run finishes,
// so the lookup is retried while the cost is still unknown.
const RUN_LOOKUP_ATTEMPTS = 3;
const RUN_LOOKUP_DELAY_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The run-sync endpoint returns only dataset items, so look up the run it started. */
async function lookUpRun(startedAfterMs) {
  let run = await lookUpRunOnce(startedAfterMs);
  for (let attempt = 2; attempt <= RUN_LOOKUP_ATTEMPTS && run.runId && run.usageCostUsd === null; attempt++) {
    await sleep(RUN_LOOKUP_DELAY_MS);
    const next = await lookUpRunOnce(startedAfterMs);
    if (next.runId === run.runId) run = next;
  }
  if (run.runId && run.usageCostUsd === null) {
    run.note = `Apify did not report the run's charges after ${RUN_LOOKUP_ATTEMPTS} lookups; check the run in Apify Console`;
  }
  return run;
}

async function lookUpRunOnce(startedAfterMs) {
  try {
    const res = await fetch(`${API}/acts/${ACTOR}/runs/last`, {
      headers: { authorization: `Bearer ${TOKEN}`, accept: "application/json" }
    });
    if (!res.ok) return { note: `run lookup returned HTTP ${res.status}` };
    const run = (await res.json())?.data;
    if (!run?.id) return { note: "run lookup returned no run" };
    if (Date.parse(run.startedAt) < startedAfterMs - 5000) return { note: "latest run is older than this call" };
    return { runId: run.id, runStatus: run.status ?? null, usageCostUsd: chargedUsd(run) };
  } catch (err) {
    return { note: `run lookup failed: ${errMessage(err)}` };
  }
}

/**
 * Pay-per-event charge: charged event counts times the event prices in the run's pricing info.
 * Returns null (unknown) when Apify has not reported any charges yet, so a missing or empty
 * chargedEventCounts is never shown as $0.
 */
function chargedUsd(run) {
  const counts = run.chargedEventCounts;
  const prices = run.pricingInfo?.pricingPerEvent?.actorChargeEvents;
  const hasCounts = counts && typeof counts === "object" && Object.keys(counts).length > 0;
  if (!hasCounts || !prices) {
    return typeof run.usageTotalUsd === "number" && run.usageTotalUsd > 0 ? run.usageTotalUsd : null;
  }
  let total = 0;
  for (const [event, count] of Object.entries(counts)) {
    const price = prices[event]?.eventPriceUsd;
    if (typeof price !== "number" || typeof count !== "number") return null;
    total += price * count;
  }
  return total > 0 ? Math.round(total * 1e8) / 1e8 : null;
}

async function main() {
  rmSync(RESULT_FILE, { force: true });
  if (!TOKEN.trim()) {
    fail("APIFY_TOKEN is not set. Run: APIFY_TOKEN=<your Apify API token> npm run e2e (the run is billed to that account, about $0.00075).", 2);
  }
  if (!existsSync(SERVER)) fail("dist/index.js not found. Run npm run build first.", 2);
  try {
    API = apiBase(process.env.APIFY_API_BASE_URL);
  } catch (err) {
    fail(errMessage(err), 2);
  }

  const env = { ...getDefaultEnvironment(), APIFY_TOKEN: TOKEN };
  for (const key of ["APIFY_API_BASE_URL", "FECKLESSPLEB_LIVE_SCHEMAS"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env, stderr: "pipe" });
  transport.stderr?.on("data", (chunk) => process.stderr.write(redact(chunk.toString())));
  const client = new Client({ name: "fecklesspleb-actors-mcp-e2e", version: "0.1.0" });

  let tools;
  let result;
  const callStartedMs = Date.now();
  try {
    await client.connect(transport);
    tools = (await client.listTools()).tools.map((t) => t.name);
    say(`tools/list: ${tools.length} tools`);
    if (!tools.includes(TOOL)) throw new Error(`${TOOL} is not in tools/list`);
    say(`calling ${TOOL} with maxItems=${ARGS.maxItems}, maxCostUsd=${ARGS.maxCostUsd}`);
    result = await client.callTool({ name: TOOL, arguments: ARGS }, undefined, { timeout: 300_000 });
  } catch (err) {
    await client.close().catch(() => {});
    fail(errMessage(err));
  }
  await client.close().catch(() => {});

  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  if (result.isError) fail(`tool returned an error: ${text.slice(0, 500)}`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail("tool result is not JSON");
  }
  const itemCount = Array.isArray(payload.items) ? payload.items.length : 0;

  const run = await lookUpRun(callStartedMs);
  const out = {
    tools,
    runId: run.runId ?? null,
    runStatus: run.runStatus ?? null,
    itemCount,
    usageCostUsd: run.usageCostUsd ?? null
  };
  const fileText = JSON.stringify(out, null, 2) + "\n";
  if (TOKEN && fileText.includes(TOKEN)) fail("refusing to write a result that contains the token");
  writeFileSync(RESULT_FILE, fileText);

  say(`items: ${itemCount}; run: ${out.runId ?? "not found"} ${out.runStatus ?? ""}; charged: ${out.usageCostUsd === null ? "unknown" : "$" + out.usageCostUsd}`);
  if (run.note) say(`note: ${run.note}`);
  say(`wrote ${RESULT_FILE}`);

  if (itemCount < 1) fail("the call returned no items");
  if (out.runStatus && out.runStatus !== "SUCCEEDED") fail(`run status is ${out.runStatus}`);
  say("e2e PASSED");
}

main().catch((err) => fail(errMessage(err)));

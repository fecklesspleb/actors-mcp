import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import { fetchLiveInputSchema, runActorSync, type FetchLike } from "./apify.js";
import { formatPricing, parseToolsets, selectTools, type ToolDef } from "./catalog.js";
import { COST_CAP_PROPERTY, toToolInputSchema, type ApifyInputSchema, type JsonSchema } from "./schema.js";
import { SNAPSHOTS } from "./snapshots.js";

export const SERVER_NAME = "fecklesspleb-actors-mcp";
export const SERVER_VERSION = "0.1.0";

export interface ServerConfig {
  token?: string;
  toolsets?: string;
  /** Default per-call spending cap in USD. */
  defaultMaxCostUsd: number;
  /** Highest cap a caller may request in USD. */
  maxCostCeilingUsd: number;
  /** Fetch live input schemas from Apify at startup. */
  liveSchemas: boolean;
  /** Run timeout in seconds passed to Apify (0 = Actor default). */
  runTimeoutSecs: number;
  /** Longest tool result text, in characters. */
  maxOutputChars: number;
  fetchFn: FetchLike;
  baseUrl?: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const num = (v: string | undefined, d: number) => {
    const n = v === undefined || v === "" ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const caps = normalizeCostCaps(
    envNumber(env.APIFY_MAX_COST_USD, 0.25, "APIFY_MAX_COST_USD"),
    envNumber(env.APIFY_MAX_COST_CEILING_USD, 5, "APIFY_MAX_COST_CEILING_USD")
  );
  return {
    token: env.APIFY_TOKEN || undefined,
    toolsets: env.FECKLESSPLEB_TOOLSETS,
    defaultMaxCostUsd: caps.defaultMaxCostUsd,
    maxCostCeilingUsd: caps.maxCostCeilingUsd,
    liveSchemas: env.FECKLESSPLEB_LIVE_SCHEMAS !== "0",
    runTimeoutSecs: num(env.APIFY_RUN_TIMEOUT_SECS, 280),
    maxOutputChars: num(env.MAX_OUTPUT_CHARS, 60000),
    fetchFn: globalThis.fetch.bind(globalThis),
    baseUrl: apiBaseUrl(env.APIFY_API_BASE_URL)
  };
}

/** Read a numeric environment variable. Unset or empty gives the default; anything that is not a number is an error. */
function envNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`${name} must be a number of US dollars.`);
  return n;
}

/**
 * Validate the spending caps. Both must be positive finite numbers of US dollars.
 * A default above the ceiling is lowered to the ceiling.
 */
export function normalizeCostCaps(
  defaultMaxCostUsd: number,
  maxCostCeilingUsd: number
): { defaultMaxCostUsd: number; maxCostCeilingUsd: number } {
  if (!Number.isFinite(maxCostCeilingUsd) || maxCostCeilingUsd <= 0) {
    throw new Error("APIFY_MAX_COST_CEILING_USD must be a positive number of US dollars.");
  }
  if (!Number.isFinite(defaultMaxCostUsd) || defaultMaxCostUsd <= 0) {
    throw new Error("APIFY_MAX_COST_USD must be a positive number of US dollars.");
  }
  return { defaultMaxCostUsd: Math.min(defaultMaxCostUsd, maxCostCeilingUsd), maxCostCeilingUsd };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Optional API base URL override, used by tests against a mock Apify API.
 * https is required, except that plain http is allowed for localhost, 127.0.0.1 and ::1.
 * Any other value is an error, so the API token is never sent over plain http to a remote host.
 */
export function apiBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error("APIFY_API_BASE_URL is not a valid URL.");
  }
  const loopback = LOOPBACK_HOSTS.has(u.hostname.toLowerCase());
  if (u.protocol === "https:" || (u.protocol === "http:" && loopback)) return value.replace(/\/+$/, "");
  throw new Error("APIFY_API_BASE_URL must use https (plain http is allowed only for localhost, 127.0.0.1 and ::1).");
}

interface LoadedTool {
  def: ToolDef;
  schema: ApifyInputSchema;
  source: "live" | "snapshot";
}

export async function loadTools(config: ServerConfig): Promise<LoadedTool[]> {
  const defs = selectTools(parseToolsets(config.toolsets));
  return Promise.all(
    defs.map(async (def): Promise<LoadedTool> => {
      if (config.liveSchemas) {
        const live = await fetchLiveInputSchema(def.actor, config.fetchFn, 5000, config.baseUrl);
        if (live) return { def, schema: live, source: "live" };
      }
      const snap = SNAPSHOTS[def.actor];
      return { def, schema: snap ?? { type: "object", properties: {} }, source: "snapshot" };
    })
  );
}

function describe(def: ToolDef, config: ServerConfig): string {
  const defaults = def.safeDefaults
    ? " Defaults applied by this server when omitted: " +
      Object.entries(def.safeDefaults).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ") + "."
    : "";
  return (
    `${def.description} Cost, charged to your own Apify account: ${formatPricing(def)}. ` +
    `Each call is capped at ${COST_CAP_PROPERTY} (default $${config.defaultMaxCostUsd}).` +
    defaults +
    ` Runs Apify Actor ${def.actor} (https://apify.com/${def.actor}).`
  );
}

export function buildToolList(loaded: LoadedTool[], config: ServerConfig): Tool[] {
  const capText =
    `Most this call may charge your Apify account, in US dollars. Default ${config.defaultMaxCostUsd}, ` +
    `maximum ${config.maxCostCeilingUsd}. Passed to Apify as maxTotalChargeUsd, the most Apify will charge for this run.`;
  return loaded.map(({ def, schema }) => ({
    name: def.name,
    title: def.title,
    description: describe(def, config),
    inputSchema: advertiseSafeDefaults(toToolInputSchema(schema, capText), def) as Tool["inputSchema"],
    annotations: {
      title: def.title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  }));
}

/**
 * Show the server's safe defaults as the schema defaults, so the default a client sees is the
 * value this server sends when the field is omitted. Fields the schema does not have, and
 * required fields, are left alone (safe defaults are only applied to known fields).
 */
function advertiseSafeDefaults(inputSchema: JsonSchema, def: ToolDef): JsonSchema {
  const props = inputSchema.properties as Record<string, JsonSchema> | undefined;
  const required = (inputSchema.required as string[] | undefined) ?? [];
  for (const [key, value] of Object.entries(def.safeDefaults ?? {})) {
    if (props?.[key] && !required.includes(key)) props[key] = { ...props[key], default: value };
  }
  return inputSchema;
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

export async function handleCall(
  loaded: LoadedTool[],
  config: ServerConfig,
  name: string,
  args: Record<string, unknown> | undefined
): Promise<CallToolResult> {
  const tool = loaded.find((t) => t.def.name === name);
  if (!tool) return errorResult(`Unknown tool: ${name}`);
  if (!config.token) {
    return errorResult(
      "APIFY_TOKEN is not set. Add your Apify API token (Apify Console > Settings > API & Integrations) " +
        "to this server's environment. Runs are billed to that Apify account."
    );
  }

  const input: Record<string, unknown> = { ...(args ?? {}) };
  let maxCostUsd = Math.min(config.defaultMaxCostUsd, config.maxCostCeilingUsd);
  if (COST_CAP_PROPERTY in input) {
    const requested = Number(input[COST_CAP_PROPERTY]);
    delete input[COST_CAP_PROPERTY];
    if (!Number.isFinite(requested) || requested <= 0) {
      return errorResult(`${COST_CAP_PROPERTY} must be a positive number of US dollars.`);
    }
    maxCostUsd = Math.min(requested, config.maxCostCeilingUsd);
  }

  const known = tool.schema.properties ?? {};
  for (const [key, value] of Object.entries(tool.def.safeDefaults ?? {})) {
    if (key in known && input[key] === undefined) input[key] = value;
  }

  const result = await runActorSync(tool.def.actor, input, {
    token: config.token,
    maxCostUsd,
    timeoutSecs: config.runTimeoutSecs,
    fetchFn: config.fetchFn,
    baseUrl: config.baseUrl
  });
  if (!result.ok) return errorResult(result.message);

  const payload = {
    actor: tool.def.actor,
    itemCount: result.items.length,
    maxCostUsd,
    items: result.items
  };
  let text = JSON.stringify(payload, null, 2);
  if (text.length > config.maxOutputChars) {
    // Drop items from the end until the result fits, and say so.
    let kept = result.items.length;
    while (kept > 0) {
      kept = Math.floor(kept * 0.8);
      text = JSON.stringify(
        {
          ...payload,
          items: result.items.slice(0, kept),
          truncated: `Showing ${kept} of ${result.items.length} items to stay under ${config.maxOutputChars} characters. ` +
            "All items are in the run's dataset in your Apify Console. Narrow the request to see the rest here."
        },
        null,
        2
      );
      if (text.length <= config.maxOutputChars) break;
    }
    if (text.length > config.maxOutputChars) text = capText(text, config.maxOutputChars, result.items.length);
  }
  return { content: [{ type: "text", text }] };
}

/**
 * Last resort when even a result with no items is longer than the limit: cut the text and end it
 * with a marker. The result is then no longer valid JSON, which the marker says.
 */
function capText(text: string, maxChars: number, itemCount: number): string {
  const marker =
    `\n[truncated: result cut to ${maxChars} characters (MAX_OUTPUT_CHARS); not valid JSON. ` +
    `${itemCount} items are in the run's dataset in your Apify Console.]`;
  if (maxChars <= marker.length) return marker.slice(0, Math.max(0, maxChars));
  return text.slice(0, maxChars - marker.length) + marker;
}

export async function createServer(input: ServerConfig): Promise<Server> {
  const config: ServerConfig = { ...input, ...normalizeCostCaps(input.defaultMaxCostUsd, input.maxCostCeilingUsd) };
  const loaded = await loadTools(config);
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "Tools run Apify Actors maintained by fecklesspleb and bill the user's own Apify account per result. " +
        "Prefer narrow requests (few URLs or companies, small limits); every call has a dollar cap (maxCostUsd)."
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: buildToolList(loaded, config) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    handleCall(loaded, config, req.params.name, req.params.arguments as Record<string, unknown> | undefined)
  );
  return server;
}

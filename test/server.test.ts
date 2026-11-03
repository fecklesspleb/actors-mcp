import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { apiBaseUrl, configFromEnv, createServer, normalizeCostCaps, type ServerConfig } from "../src/server.js";
import { TOOLS, parseToolsets } from "../src/catalog.js";
import { SNAPSHOTS } from "../src/snapshots.js";
import { toToolInputSchema, parseBuildInputSchema, stripHtml } from "../src/schema.js";

interface Call {
  url: string;
  init?: RequestInit;
}

/** A fake Apify API. `routes` maps a URL substring to a handler. */
function mockApify(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) return handler(call);
    }
    return new Response(JSON.stringify({ error: { type: "record-not-found", message: "not mocked" } }), { status: 404 });
  };
  return { fetchFn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function baseConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    token: "test-token",
    toolsets: undefined,
    defaultMaxCostUsd: 0.25,
    maxCostCeilingUsd: 5,
    liveSchemas: false,
    runTimeoutSecs: 280,
    maxOutputChars: 60000,
    fetchFn: mockApify({}).fetchFn,
    ...overrides
  };
}

async function connect(config: ServerConfig) {
  const server = await createServer(config);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

describe("catalog", () => {
  it("only lists fecklesspleb Actors and never the excluded ones", () => {
    const excluded = /yc-companies-scraper|yc-companies|shopify-products-scraper|shopify-products|sunbiz/i;
    for (const t of TOOLS) {
      expect(t.actor.startsWith("fecklesspleb/")).toBe(true);
      expect(t.actor).not.toMatch(excluded);
      expect(t.name).not.toMatch(excluded);
    }
    for (const actor of Object.keys(SNAPSHOTS)) expect(actor).not.toMatch(excluded);
  });

  it("has no Sunbiz tool or Actor", () => {
    for (const t of TOOLS) {
      expect(t.name.toLowerCase()).not.toContain("sunbiz");
      expect(t.actor.toLowerCase()).not.toContain("sunbiz");
    }
    for (const actor of Object.keys(SNAPSHOTS)) expect(actor.toLowerCase()).not.toContain("sunbiz");
  });

  it("has a bundled schema snapshot for every Actor", () => {
    for (const t of TOOLS) expect(SNAPSHOTS[t.actor]?.properties).toBeTruthy();
  });

  it("only uses safe defaults that exist in the snapshot schema", () => {
    for (const t of TOOLS) {
      for (const key of Object.keys(t.safeDefaults ?? {})) {
        expect(SNAPSHOTS[t.actor].properties, `${t.actor}.${key}`).toHaveProperty(key);
      }
    }
  });

  it("parses toolsets", () => {
    expect(parseToolsets(undefined)).toEqual(["core", "jobs"]);
    expect(parseToolsets("core")).toEqual(["core"]);
    expect(parseToolsets("all")).toEqual(["core", "jobs", "web"]);
    expect(parseToolsets("nonsense")).toEqual(["core", "jobs"]);
  });
});

describe("configuration", () => {
  it("allows plain http for the API base URL only on loopback hosts", () => {
    expect(apiBaseUrl(undefined)).toBeUndefined();
    expect(apiBaseUrl("")).toBeUndefined();
    expect(apiBaseUrl("https://api.apify.com/v2/")).toBe("https://api.apify.com/v2");
    expect(apiBaseUrl("https://mock.example.com/v2")).toBe("https://mock.example.com/v2");
    expect(apiBaseUrl("http://localhost:8080/v2")).toBe("http://localhost:8080/v2");
    expect(apiBaseUrl("http://127.0.0.1:9/v2")).toBe("http://127.0.0.1:9/v2");
    expect(apiBaseUrl("http://[::1]:9/v2")).toBe("http://[::1]:9/v2");
  });

  it.each([
    "http://api.apify.com/v2",
    "http://mock.example.com/v2",
    "http://127.0.0.2/v2",
    "http://localhost.example.com/v2",
    "ftp://localhost/v2",
    "not a url"
  ])("rejects the API base URL %s", (value) => {
    expect(() => apiBaseUrl(value)).toThrow(/APIFY_API_BASE_URL/);
    expect(() => configFromEnv({ APIFY_API_BASE_URL: value })).toThrow(/APIFY_API_BASE_URL/);
  });

  it("reads cost caps from the environment and clamps the default to the ceiling", () => {
    expect(configFromEnv({})).toMatchObject({ defaultMaxCostUsd: 0.25, maxCostCeilingUsd: 5 });
    expect(configFromEnv({ APIFY_MAX_COST_USD: "1", APIFY_MAX_COST_CEILING_USD: "2" })).toMatchObject({
      defaultMaxCostUsd: 1,
      maxCostCeilingUsd: 2
    });
    expect(configFromEnv({ APIFY_MAX_COST_USD: "10", APIFY_MAX_COST_CEILING_USD: "2" })).toMatchObject({
      defaultMaxCostUsd: 2,
      maxCostCeilingUsd: 2
    });
    expect(normalizeCostCaps(9, 5)).toEqual({ defaultMaxCostUsd: 5, maxCostCeilingUsd: 5 });
  });

  it.each(["0", "-1", "abc", "NaN", "Infinity"])("rejects APIFY_MAX_COST_USD=%s", (value) => {
    expect(() => configFromEnv({ APIFY_MAX_COST_USD: value })).toThrow(/APIFY_MAX_COST_USD/);
  });

  it.each(["0", "-5", "abc"])("rejects APIFY_MAX_COST_CEILING_USD=%s", (value) => {
    expect(() => configFromEnv({ APIFY_MAX_COST_CEILING_USD: value })).toThrow(/APIFY_MAX_COST_CEILING_USD/);
  });

  it("rejects a zero, negative or NaN default cap passed to createServer", async () => {
    for (const bad of [0, -1, Number.NaN]) {
      await expect(createServer(baseConfig({ defaultMaxCostUsd: bad }))).rejects.toThrow(/APIFY_MAX_COST_USD/);
    }
  });

  it("clamps a default cap above the ceiling before calling Apify", async () => {
    const { fetchFn, calls } = mockApify({ "run-sync-get-dataset-items": () => json([]) });
    const client = await connect(baseConfig({ fetchFn, defaultMaxCostUsd: 20, maxCostCeilingUsd: 2 }));
    const { tools } = await client.listTools();
    expect(tools[0].description).toContain("(default $2)");
    await client.callTool({ name: "search_hacker_news", arguments: { query: "mcp" } });
    const call = calls.find((c) => c.url.includes("run-sync"))!;
    expect(new URL(call.url).searchParams.get("maxTotalChargeUsd")).toBe("2");
  });
});

describe("schema conversion", () => {
  it("keeps types, defaults, enums and required, and adds the cost cap", () => {
    const schema = toToolInputSchema(
      {
        type: "object",
        required: ["startUrls"],
        properties: {
          startUrls: { title: "Start URLs", type: "array", editor: "requestListSources", description: "Pages <b>to</b> crawl", default: [{ url: "https://sample.example" }] },
          mode: { title: "Mode", type: "string", enum: ["a", "b"], enumTitles: ["Alpha", "Beta"], default: "a" },
          limit: { title: "Limit", type: "integer", minimum: 0, default: 10, prefill: 3 }
        }
      },
      "cap"
    );
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(schema.required).toEqual(["startUrls"]);
    expect(props.startUrls.description).toBe("Start URLs. Pages to crawl");
    expect(props.startUrls).not.toHaveProperty("default");
    expect((props.startUrls.items as Record<string, unknown>).required).toEqual(["url"]);
    expect(props.mode.enum).toEqual(["a", "b"]);
    expect(props.mode.description).toContain("a = Alpha; b = Beta");
    expect(props.limit).toMatchObject({ type: "integer", minimum: 0, default: 10 });
    expect(props.limit).not.toHaveProperty("prefill");
    expect(props.maxCostUsd).toMatchObject({ type: "number", description: "cap" });
  });

  it("parses the inputSchema string on an Apify build", () => {
    const s = parseBuildInputSchema({ data: { inputSchema: JSON.stringify({ properties: { a: { type: "string" } } }) } });
    expect(s?.properties?.a).toBeTruthy();
    expect(parseBuildInputSchema({ data: { inputSchema: "not json" } })).toBeUndefined();
  });

  it("strips HTML", () => {
    expect(stripHtml("<b>None</b>: every&nbsp;job")).toBe("None: every job");
  });
});

describe("tools/list", () => {
  it("lists core and jobs tools by default, from snapshots when live schemas are off", async () => {
    const client = await connect(baseConfig());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "ashby_jobs",
        "ats_jobs",
        "extract_sitemap_urls",
        "extract_website_metadata",
        "greenhouse_jobs",
        "lever_jobs",
        "search_hacker_news",
        "search_remote_jobs",
        "seo_audit_website",
        "workday_jobs"
      ].sort()
    );
    const seo = tools.find((t) => t.name === "seo_audit_website")!;
    expect(seo.description).toContain("$0.003 per page audited");
    expect(seo.description).toContain("https://apify.com/fecklesspleb/website-seo-audit");
    expect(seo.inputSchema.required).toEqual(["startUrls"]);
    expect(seo.inputSchema.properties).toHaveProperty("maxCostUsd");
    expect(seo.annotations?.openWorldHint).toBe(true);
  });

  it("lists tools without a token, so clients and directories can introspect", async () => {
    const client = await connect(baseConfig({ token: undefined, toolsets: "all" }));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOLS.length);
  });

  it("uses the live schema when Apify returns one, and falls back otherwise", async () => {
    const live = { type: "object", properties: { onlyLiveField: { title: "Live", type: "string" } } };
    const { fetchFn, calls } = mockApify({
      "fecklesspleb~sitemap-extractor/builds/default": () => json({ data: { inputSchema: JSON.stringify(live) } }),
      "/builds/default": () => json({ error: { message: "down" } }, 500)
    });
    const client = await connect(baseConfig({ liveSchemas: true, toolsets: "core", fetchFn }));
    const { tools } = await client.listTools();
    const sitemap = tools.find((t) => t.name === "extract_sitemap_urls")!;
    expect(Object.keys(sitemap.inputSchema.properties!)).toEqual(["onlyLiveField", "maxCostUsd"]);
    const meta = tools.find((t) => t.name === "extract_website_metadata")!;
    expect(meta.inputSchema.properties).toHaveProperty("urls");
    expect(calls.every((c) => !(c.init?.headers as Record<string, string> | undefined)?.authorization)).toBe(true);
  });
});

describe("advertised defaults", () => {
  const JOB_TOOLS = ["greenhouse_jobs", "lever_jobs", "ashby_jobs", "workday_jobs", "ats_jobs"];

  it.each(JOB_TOOLS)("%s advertises the includeDescription default it sends", async (name) => {
    const { fetchFn, calls } = mockApify({ "run-sync-get-dataset-items": () => json([]) });
    const client = await connect(baseConfig({ fetchFn }));
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === name)!;
    const advertised = (tool.inputSchema.properties as Record<string, { default?: unknown }>).includeDescription.default;
    await client.callTool({ name, arguments: { companies: ["https://example.com/careers"] } });
    const sent = JSON.parse(String(calls.find((c) => c.url.includes("run-sync"))!.init?.body)).includeDescription;
    expect(advertised).toBe(false);
    expect(sent).toBe(advertised);
  });

  it("advertises every safe default as the schema default", async () => {
    const client = await connect(baseConfig({ toolsets: "all" }));
    const { tools } = await client.listTools();
    for (const def of TOOLS) {
      const props = tools.find((t) => t.name === def.name)!.inputSchema.properties as Record<string, { default?: unknown }>;
      for (const [key, value] of Object.entries(def.safeDefaults ?? {})) {
        expect(props[key].default, `${def.name}.${key}`).toEqual(value);
      }
    }
  });
});

describe("tools/call", () => {
  it("runs the Actor synchronously with the token, cost cap and safe defaults", async () => {
    const items = [{ url: "https://example.com/a", lastmod: "2026-10-01" }];
    const { fetchFn, calls } = mockApify({ "run-sync-get-dataset-items": () => json(items) });
    const client = await connect(baseConfig({ fetchFn }));
    const res = await client.callTool({
      name: "extract_sitemap_urls",
      arguments: { startUrls: ["https://example.com"], maxCostUsd: 0.1 }
    });
    expect(res.isError).toBeFalsy();
    const call = calls.find((c) => c.url.includes("run-sync"))!;
    const url = new URL(call.url);
    expect(url.pathname).toBe("/v2/acts/fecklesspleb~sitemap-extractor/run-sync-get-dataset-items");
    expect(url.searchParams.get("maxTotalChargeUsd")).toBe("0.1");
    expect(url.searchParams.get("timeout")).toBe("280");
    expect(call.init?.method).toBe("POST");
    expect((call.init?.headers as Record<string, string>).authorization).toBe("Bearer test-token");
    const body = JSON.parse(String(call.init?.body));
    expect(body).toEqual({ startUrls: ["https://example.com"], maxTotalUrls: 500 });
    const text = (res.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toMatchObject({ actor: "fecklesspleb/sitemap-extractor", itemCount: 1, items });
  });

  it("lets the caller override safe defaults and clamps the cost cap to the ceiling", async () => {
    const { fetchFn, calls } = mockApify({ "run-sync-get-dataset-items": () => json([]) });
    const client = await connect(baseConfig({ fetchFn, maxCostCeilingUsd: 1 }));
    await client.callTool({
      name: "greenhouse_jobs",
      arguments: { companies: ["airbnb"], maxTotalJobs: 3, includeDescription: true, maxCostUsd: 50 }
    });
    const call = calls.find((c) => c.url.includes("run-sync"))!;
    expect(new URL(call.url).searchParams.get("maxTotalChargeUsd")).toBe("1");
    expect(JSON.parse(String(call.init?.body))).toEqual({ companies: ["airbnb"], maxTotalJobs: 3, includeDescription: true });
  });

  it("uses the default cap when none is given", async () => {
    const { fetchFn, calls } = mockApify({ "run-sync-get-dataset-items": () => json([]) });
    const client = await connect(baseConfig({ fetchFn }));
    await client.callTool({ name: "search_hacker_news", arguments: { query: "mcp" } });
    const call = calls.find((c) => c.url.includes("run-sync"))!;
    expect(new URL(call.url).searchParams.get("maxTotalChargeUsd")).toBe("0.25");
    expect(JSON.parse(String(call.init?.body))).toEqual({ query: "mcp", maxItems: 50 });
  });

  it("rejects a non-positive cost cap without calling Apify", async () => {
    const { fetchFn, calls } = mockApify({});
    const client = await connect(baseConfig({ fetchFn }));
    const res = await client.callTool({ name: "search_hacker_news", arguments: { maxCostUsd: 0 } });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("explains a missing token without calling Apify", async () => {
    const { fetchFn, calls } = mockApify({});
    const client = await connect(baseConfig({ token: undefined, fetchFn }));
    const res = await client.callTool({ name: "seo_audit_website", arguments: { startUrls: ["https://example.com"] } });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toContain("APIFY_TOKEN is not set");
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, "rejected the API token"],
    [402, "billing"],
    [408, "300 seconds"],
    [400, "Apify API error 400"]
  ])("maps Apify HTTP %i to a clear error", async (status, expected) => {
    const { fetchFn } = mockApify({
      "run-sync-get-dataset-items": () => json({ error: { type: "x", message: "detail from apify" } }, status)
    });
    const client = await connect(baseConfig({ fetchFn }));
    const res = await client.callTool({ name: "extract_website_metadata", arguments: { urls: ["https://example.com"] } });
    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[])[0].text;
    expect(text).toContain(expected);
    expect(text).toContain("detail from apify");
  });

  it("reports network failures", async () => {
    const client = await connect(
      baseConfig({
        fetchFn: async () => {
          throw new Error("ECONNRESET");
        }
      })
    );
    const res = await client.callTool({ name: "search_remote_jobs", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toContain("ECONNRESET");
  });

  it("truncates long results and says so", async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ i, text: "x".repeat(500) }));
    const { fetchFn } = mockApify({ "run-sync-get-dataset-items": () => json(items) });
    const client = await connect(baseConfig({ fetchFn, maxOutputChars: 20000 }));
    const res = await client.callTool({ name: "search_remote_jobs", arguments: {} });
    const text = (res.content as { text: string }[])[0].text;
    expect(text.length).toBeLessThanOrEqual(20000);
    const parsed = JSON.parse(text);
    expect(parsed.itemCount).toBe(200);
    expect(parsed.items.length).toBeLessThan(200);
    expect(parsed.truncated).toContain("of 200 items");
  });

  it("keeps a result under MAX_OUTPUT_CHARS even when no items fit", async () => {
    const items = [{ text: "x".repeat(5000) }];
    const { fetchFn } = mockApify({ "run-sync-get-dataset-items": () => json(items) });
    const run = async (limit: number) => {
      const client = await connect(baseConfig({ fetchFn, maxOutputChars: limit }));
      const res = await client.callTool({ name: "search_remote_jobs", arguments: {} });
      const text = (res.content as { text: string }[])[0].text;
      expect(text.length).toBeLessThanOrEqual(limit);
      expect(text).not.toContain("x".repeat(100));
      return text;
    };
    // Room for the metadata: valid JSON with no items and the truncation note.
    expect(JSON.parse(await run(300))).toMatchObject({ itemCount: 1, items: [] });
    // Not even that fits: cut with a marker.
    expect(await run(260)).toContain("[truncated: result cut to 260 characters");
    expect(await run(20)).toHaveLength(20);
  });

  it("returns an error for unknown or disabled tools", async () => {
    const client = await connect(baseConfig({ toolsets: "core" }));
    const res = await client.callTool({ name: "greenhouse_jobs", arguments: {} });
    expect(res.isError).toBe(true);
  });
});

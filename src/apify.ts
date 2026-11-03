/** Minimal Apify API client: read an Actor's input schema, run it and get its dataset items. */

import { parseBuildInputSchema, type ApifyInputSchema } from "./schema.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const APIFY_API = "https://api.apify.com/v2";

export function actorPath(actor: string): string {
  // "user/name" -> "user~name", as the Apify API expects.
  return encodeURIComponent(actor.replace("/", "~"));
}

export async function fetchLiveInputSchema(
  actor: string,
  fetchFn: FetchLike,
  timeoutMs = 5000,
  baseUrl = APIFY_API
): Promise<ApifyInputSchema | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${baseUrl}/acts/${actorPath(actor)}/builds/default`, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });
    if (!res.ok) return undefined;
    return parseBuildInputSchema(await res.json());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export interface RunOptions {
  token: string;
  maxCostUsd: number;
  /** Run timeout in seconds passed to Apify. */
  timeoutSecs?: number;
  fetchFn: FetchLike;
  baseUrl?: string;
}

/** Remove the API token (and anything that looks like a bearer token) from text before it is shown. */
export function redactToken(text: string, token: string | undefined): string {
  let out = text;
  if (token) {
    for (const form of new Set([token, encodeURIComponent(token)])) out = out.split(form).join("[redacted]");
  }
  return out.replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [redacted]").replace(/([?&]token=)[^&\s"']+/gi, "$1[redacted]");
}

export type RunResult =
  | { ok: true; items: unknown[] }
  | { ok: false; status: number; message: string };

export async function runActorSync(actor: string, input: Record<string, unknown>, opts: RunOptions): Promise<RunResult> {
  const params = new URLSearchParams({
    format: "json",
    clean: "true",
    maxTotalChargeUsd: String(opts.maxCostUsd)
  });
  if (opts.timeoutSecs && opts.timeoutSecs > 0) params.set("timeout", String(opts.timeoutSecs));
  const url = `${opts.baseUrl ?? APIFY_API}/acts/${actorPath(actor)}/run-sync-get-dataset-items?${params}`;

  let res: Response;
  try {
    res = await opts.fetchFn(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.token}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(input)
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: `Could not reach the Apify API: ${redactToken((err as Error).message, opts.token)}`
    };
  }

  const text = await res.text();
  if (res.ok) {
    try {
      const parsed = JSON.parse(text);
      return { ok: true, items: Array.isArray(parsed) ? parsed : [parsed] };
    } catch {
      return { ok: false, status: res.status, message: "Apify returned a response that is not JSON." };
    }
  }

  let apifyMessage = "";
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; type?: string } };
    apifyMessage = parsed.error?.message ?? "";
  } catch {
    apifyMessage = text.slice(0, 300);
  }

  let message: string;
  switch (res.status) {
    case 401:
      message = "Apify rejected the API token. Check APIFY_TOKEN (Apify Console > Settings > API & Integrations).";
      break;
    case 402:
      message = "Apify refused the run for billing reasons (for example, no remaining credit).";
      break;
    case 408:
      message =
        "The Actor did not finish within Apify's synchronous limit (300 seconds). The run may still be going in your " +
        "Apify Console. Ask for less (fewer URLs, companies or pages) and try again.";
      break;
    default:
      message = `Apify API error ${res.status}.`;
  }
  if (apifyMessage) message += ` Apify said: ${redactToken(apifyMessage, opts.token)}`;
  return { ok: false, status: res.status, message };
}

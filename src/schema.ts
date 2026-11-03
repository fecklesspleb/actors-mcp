/** Convert an Apify Actor input schema into a plain JSON Schema for MCP tools. */

export type JsonSchema = Record<string, unknown>;

export interface ApifyInputSchema {
  type?: string;
  properties?: Record<string, ApifyProperty>;
  required?: string[];
  [key: string]: unknown;
}

export interface ApifyProperty {
  title?: string;
  type?: string | string[];
  description?: string;
  editor?: string;
  default?: unknown;
  enum?: unknown[];
  enumTitles?: string[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  nullable?: boolean;
  [key: string]: unknown;
}

export const COST_CAP_PROPERTY = "maxCostUsd";

export function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function convertProperty(prop: ApifyProperty, required: boolean): JsonSchema {
  const out: JsonSchema = {};
  const type = prop.type;
  if (type) out.type = type;

  const parts: string[] = [];
  if (prop.title) parts.push(stripHtml(prop.title) + ".");
  if (prop.description) parts.push(stripHtml(prop.description));
  if (Array.isArray(prop.enum) && Array.isArray(prop.enumTitles) && prop.enumTitles.length === prop.enum.length) {
    parts.push("Values: " + prop.enum.map((v, i) => `${String(v)} = ${stripHtml(prop.enumTitles![i])}`).join("; ") + ".");
  }
  if (parts.length) out.description = parts.join(" ");

  // A default on a required field is only a form sample; agents should supply their own value.
  if (prop.default !== undefined && !required) out.default = prop.default;
  if (Array.isArray(prop.enum)) out.enum = prop.enum;
  if (typeof prop.minimum === "number") out.minimum = prop.minimum;
  if (typeof prop.maximum === "number") out.maximum = prop.maximum;

  if (type === "array") {
    if (prop.items && typeof prop.items === "object") {
      out.items = prop.items;
    } else if (prop.editor === "requestListSources") {
      out.items = {
        type: "object",
        properties: { url: { type: "string", description: "Absolute URL" } },
        required: ["url"]
      };
    } else if (prop.editor === "stringList") {
      out.items = { type: "string" };
    }
    // Otherwise leave items open: some Actors accept plain strings or {url} objects.
  }
  return out;
}

export function toToolInputSchema(input: ApifyInputSchema, costCapDescription: string): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [key, prop] of Object.entries(input.properties ?? {})) {
    properties[key] = convertProperty(prop, (input.required ?? []).includes(key));
  }
  properties[COST_CAP_PROPERTY] = {
    type: "number",
    exclusiveMinimum: 0,
    description: costCapDescription
  };
  const schema: JsonSchema = { type: "object", properties };
  if (input.required && input.required.length) schema.required = [...input.required];
  return schema;
}

/** Parse the inputSchema string that Apify returns on a build object. */
export function parseBuildInputSchema(build: unknown): ApifyInputSchema | undefined {
  const data = (build as { data?: { inputSchema?: unknown } } | undefined)?.data;
  const raw = data?.inputSchema;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.properties) return parsed as ApifyInputSchema;
    } catch {
      return undefined;
    }
  } else if (raw && typeof raw === "object" && (raw as ApifyInputSchema).properties) {
    return raw as ApifyInputSchema;
  }
  return undefined;
}

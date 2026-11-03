#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configFromEnv, createServer } from "./server.js";

async function main() {
  const config = configFromEnv();
  if (!config.token) {
    console.error("fecklesspleb-actors-mcp: APIFY_TOKEN is not set; tools will list but calls will fail until it is.");
  }
  const server = await createServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(`fecklesspleb-actors-mcp: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

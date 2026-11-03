# fecklesspleb-actors-mcp

<!-- mcp-name: io.github.fecklesspleb/actors-mcp -->

An MCP server that gives AI agents 14 tools: 10 on by default for SEO audits, page metadata, sitemaps, Hacker News search and job listings, plus 4 opt-in web tools for Markdown crawling, image downloads, screenshots and broken-link checks. Each tool runs one of my public Apify Actors and returns the results in the tool response.

**Disclosure:** I (fecklesspleb) wrote and maintain this server and every Actor it calls. Runs are billed per result to **your own** Apify account at the Actors' Store prices, and some of that money comes to me as the Actor developer. This project is not affiliated with or endorsed by Apify, Greenhouse, Lever, Ashby, Workday, Remote OK, We Work Remotely, Jobicy, Hacker News, Y Combinator or Algolia.

## Why use this instead of Apify's own MCP server

You don't have to. Apify's official server can run these Actors too:

- Hosted: `https://mcp.apify.com?tools=fecklesspleb/website-seo-audit,fecklesspleb/sitemap-extractor` (OAuth, or an `Authorization: Bearer <APIFY_TOKEN>` header)
- Local: `npx -y @apify/actors-mcp-server --tools fecklesspleb/website-seo-audit,fecklesspleb/sitemap-extractor` with `APIFY_TOKEN` set

This server is a smaller, focused option:

- **The results come back in the tool call.** Each call uses Apify's synchronous `run-sync-get-dataset-items` endpoint, so the agent gets the dataset items directly instead of a run ID to poll.
- **Every call has a dollar cap.** `maxCostUsd` (default $0.25) is sent to Apify as `maxTotalChargeUsd`. A server-side ceiling (default $5) caps what an agent can ask for.
- **Small defaults.** When the agent leaves them out, the server sets limits such as 25 jobs, 50 Hacker News items or 10 pages per site. Job descriptions are left out unless the agent asks for them, which keeps responses short.
- **Input schemas stay current.** At startup the server reads each Actor's input schema from its live Apify build, so the tools accept exactly what the Actors accept. If Apify can't be reached, it uses a bundled snapshot.

## Tools

Prices are the Apify Store prices when this was written. The live price is on each Actor's page.

### `core` (5 tools, on by default)

| Tool | Actor | What it returns | Price |
| --- | --- | --- | --- |
| `seo_audit_website` | [website-seo-audit](https://apify.com/fecklesspleb/website-seo-audit) | Crawls a site from `startUrls` (same host) and returns one record per page: status, score 0-100, issues (title, meta description, H1, canonical, noindex, alt text, thin content, Open Graph, JSON-LD, slow pages) | $0.003 per page + $0.00005 per run start |
| `extract_website_metadata` | [website-metadata-extractor](https://apify.com/fecklesspleb/website-metadata-extractor) | For each of `urls`: title, meta description, canonical, language, Open Graph, Twitter card, JSON-LD, favicon, RSS feeds, hreflang. Rows for URLs that could not be read are free | $0.001 per URL + $0.00005 per run start |
| `extract_sitemap_urls` | [sitemap-extractor](https://apify.com/fecklesspleb/sitemap-extractor) | Every URL in a site's sitemaps (found through robots.txt, or from a sitemap URL you pass) with lastmod, changefreq, priority. Regex and date filters | $0.0002 per URL |
| `search_hacker_news` | [hacker-news-scraper](https://apify.com/fecklesspleb/hacker-news-scraper) | `mode: "search"`: HN stories and comments by keyword, points, comments and date (HN Search API by Algolia). `mode: "whoIsHiring"`: job records from the monthly "Ask HN: Who is hiring?" thread | $0.00015 per item |
| `search_remote_jobs` | [remote-jobs-aggregator](https://apify.com/fecklesspleb/remote-jobs-aggregator) | One deduplicated list of remote jobs from the Remote OK, We Work Remotely and Jobicy feeds, with the source on every job. Keyword, location, salary and date filters | $0.001 per job |

### `jobs` (5 tools, on by default)

Open jobs from company career sites. Each job has the company, title, location, remote flag, department, employment type, salary (when the posting gives one), posting date and URL.

| Tool | Actor | Pass `companies` as | Price |
| --- | --- | --- | --- |
| `greenhouse_jobs` | [greenhouse-jobs-scraper](https://apify.com/fecklesspleb/greenhouse-jobs-scraper) | Greenhouse slugs (`airbnb`), board URLs or careers pages. Or set `searchDirectory: true` | $0.001 per job |
| `lever_jobs` | [lever-jobs-scraper](https://apify.com/fecklesspleb/lever-jobs-scraper) | Lever slugs (`palantir`), board URLs or careers pages. Or set `searchDirectory: true` | $0.001 per job |
| `ashby_jobs` | [ashby-jobs-scraper](https://apify.com/fecklesspleb/ashby-jobs-scraper) | Ashby slugs (`ramp`), board URLs or careers pages. Or set `searchDirectory: true` | $0.001 per job |
| `workday_jobs` | [workday-jobs-scraper](https://apify.com/fecklesspleb/workday-jobs-scraper) | Full Workday career site URLs, e.g. `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite` | $0.002 per job |
| `ats_jobs` | [ats-jobs-scraper](https://apify.com/fecklesspleb/ats-jobs-scraper) | Board URLs or careers pages on Greenhouse, Lever, Ashby, Workday, Workable, Recruitee or Teamtailor (Polymer and HireHive by URL). Use it when you don't know which ATS a company uses | $0.002 per job |

### `web` (4 tools, opt-in: `FECKLESSPLEB_TOOLSETS=core,jobs,web` or `all`)

| Tool | Actor | What it returns | Price |
| --- | --- | --- | --- |
| `crawl_website_to_markdown` | [website-to-markdown-crawler](https://apify.com/fecklesspleb/website-to-markdown-crawler) | Pages of a site as Markdown or text | $0.0008 per page + $0.00005 per run start |
| `download_images` | [bulk-image-downloader](https://apify.com/fecklesspleb/bulk-image-downloader) | Links to images and files saved in your Apify storage, with size, dimensions, alt text, SHA-256 | $0.001 per file + $0.00005 per run start |
| `screenshot_website` | [website-screenshot](https://apify.com/fecklesspleb/website-screenshot) | Links to PNG/JPEG screenshots (and optional PDFs) saved in your Apify storage | $0.0008 per screenshot + $0.00005 per run start |
| `check_broken_links` | [broken-link-checker](https://apify.com/fecklesspleb/broken-link-checker) | Broken links and images with the page, link text and status code | $0.003 per broken link ($0.0005 per checked link when `onlyBroken` is off) + $0.00005 per run start |

The "run start" charge is per GB of run memory, once per run.

Every tool also takes `maxCostUsd`. All other arguments are the Actor's own input fields, described in the tool's input schema.

## Setup

You need Node.js 20 or newer and an [Apify](https://apify.com) account. Copy your API token from Apify Console > Settings > API & Integrations.

Claude Desktop, Cursor and other clients that use an `mcpServers` config:

```json
{
  "mcpServers": {
    "fecklesspleb-actors": {
      "command": "npx",
      "args": ["-y", "fecklesspleb-actors-mcp"],
      "env": { "APIFY_TOKEN": "<your Apify API token>" }
    }
  }
}
```

Claude Code:

```sh
claude mcp add fecklesspleb-actors --env APIFY_TOKEN=<your Apify API token> -- npx -y fecklesspleb-actors-mcp
```

From source:

```sh
git clone https://github.com/fecklesspleb/actors-mcp.git
cd actors-mcp
npm ci && npm run build
APIFY_TOKEN=<your Apify API token> node dist/index.js
```

Docker:

```sh
docker build -t fecklesspleb-actors-mcp .
docker run -i --rm -e APIFY_TOKEN=<your Apify API token> fecklesspleb-actors-mcp
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `APIFY_TOKEN` | (required for calls) | Your Apify API token. Tools are still listed without one, but calls return an error. |
| `FECKLESSPLEB_TOOLSETS` | `core,jobs` | Comma-separated: `core`, `jobs`, `web`, or `all`. |
| `APIFY_MAX_COST_USD` | `0.25` | Cap per call when the agent doesn't pass `maxCostUsd`. Must be a positive number; `0`, negative values and non-numbers stop the server at startup. A value above the ceiling is lowered to the ceiling. |
| `APIFY_MAX_COST_CEILING_USD` | `5` | Highest `maxCostUsd` an agent can request. Bigger values are lowered to this. Must be a positive number. |
| `APIFY_RUN_TIMEOUT_SECS` | `280` | Run timeout sent to Apify. `0` uses the Actor's own timeout. |
| `MAX_OUTPUT_CHARS` | `60000` | Longest tool response. Longer results are cut short, and the response says how many items were left out. |
| `FECKLESSPLEB_LIVE_SCHEMAS` | `1` | Set to `0` to skip the live schema lookup and use the bundled snapshots. |
| `APIFY_API_BASE_URL` | `https://api.apify.com/v2` | API base URL. Only for testing against a mock API; leave unset. Must be `https`; plain `http` is accepted only for `localhost`, `127.0.0.1` and `::1`. |

## What a call returns

```json
{
  "actor": "fecklesspleb/sitemap-extractor",
  "itemCount": 2,
  "maxCostUsd": 0.25,
  "items": [
    { "url": "https://example.com/blog/a", "lastmod": "2026-10-01", "sitemapUrl": "https://example.com/sitemap.xml" },
    { "url": "https://example.com/blog/b", "lastmod": "2026-10-03", "sitemapUrl": "https://example.com/sitemap.xml" }
  ]
}
```

`items` are the Actor's dataset items, unchanged. The fields for each Actor are listed on its Apify Store page.

## Limits

- Apify's synchronous endpoint waits at most 300 seconds. A longer run returns an error, but the run may keep going in your Apify Console. Ask for fewer URLs, pages or companies.
- Results larger than `MAX_OUTPUT_CHARS` are cut short. The full dataset stays in your Apify account.
- Screenshots and downloaded files are returned as links to your Apify storage, not as image data.

## Development

Building and running the tests needs Node.js 20.19 or newer (on Node 22, 22.12 or newer), because the test runner (Vitest, on Vite 8) requires it. Running the server still needs only Node.js 20 or newer.

```sh
npm ci
npm run build
npm test                  # builds, then runs unit, protocol and token-leak tests against a mocked Apify API, no network
APIFY_TOKEN=<your Apify API token> npm run e2e   # one real call (Hacker News, 5 items, about $0.00075, billed to that account)
npm run snapshot-schemas  # refresh the bundled input schemas from the live Actor builds
```

## License

MIT. Copyright (c) 2026 fecklesspleb.

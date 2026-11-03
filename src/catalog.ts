/**
 * The tools this server exposes. Each tool runs one public Apify Actor
 * published by fecklesspleb (https://apify.com/fecklesspleb).
 *
 * Input schemas are NOT hard-coded here: they are read from the Actor's
 * live build at startup (with a bundled snapshot as fallback), so a tool
 * always accepts exactly what the Actor accepts.
 */

export type Toolset = "core" | "jobs" | "web";

export interface ToolDef {
  /** MCP tool name. */
  name: string;
  /** Apify Actor id, "username/actor-name". */
  actor: string;
  toolset: Toolset;
  title: string;
  /** What the tool does and when to use it. Prices are appended automatically. */
  description: string;
  /** Pay-per-event prices in USD, as listed on Apify Store. */
  pricing: { event: string; usd: number; note?: string }[];
  /**
   * Input values applied when the caller omits them, to keep agent calls
   * small and cheap. Only applied if the Actor's current schema still has
   * the field.
   */
  safeDefaults?: Record<string, unknown>;
}

const JOB_FILTER_HINT =
  "Filter with keywords, excludeKeywords, locations, remoteOnly and postedWithinDays. " +
  "Full descriptions are off by default here to save tokens; set includeDescription to true to get them.";

export const TOOLS: ToolDef[] = [
  // ---- core ----
  {
    name: "seo_audit_website",
    actor: "fecklesspleb/website-seo-audit",
    toolset: "core",
    title: "SEO audit of a website",
    description:
      "Crawl a site from one or more start pages (same host only) and audit every page for on-page SEO problems: " +
      "missing or overlong titles and meta descriptions, H1s, canonicals, noindex, image alt text, thin content, " +
      "Open Graph, JSON-LD and slow responses. Returns one record per page with a list of issues and a 0-100 score. " +
      "Use it to find what to fix on a site; use extract_website_metadata instead when you only need the tags of known URLs.",
    pricing: [
      { event: "page audited", usd: 0.003 },
      { event: "Actor start", usd: 0.00005, note: "per GB of memory, once per run" }
    ],
    safeDefaults: { maxPagesPerSite: 10 }
  },
  {
    name: "extract_website_metadata",
    actor: "fecklesspleb/website-metadata-extractor",
    toolset: "core",
    title: "Extract page metadata and Open Graph tags",
    description:
      "Fetch a list of URLs (plain HTTP, no browser) and return each page's title, meta description, canonical URL, " +
      "language, Open Graph and Twitter card tags, schema.org JSON-LD, favicon, RSS feeds and hreflang links. " +
      "Use it for link previews, enrichment or quick SEO checks of specific pages. Failed URLs come back as free error rows.",
    pricing: [
      { event: "URL processed", usd: 0.001 },
      { event: "Actor start", usd: 0.00005, note: "per GB of memory, once per run" }
    ]
  },
  {
    name: "extract_sitemap_urls",
    actor: "fecklesspleb/sitemap-extractor",
    toolset: "core",
    title: "List the URLs in a site's sitemaps",
    description:
      "Give a site (sitemaps are discovered through robots.txt) or a direct sitemap.xml URL and get every listed URL " +
      "with lastmod, changefreq and priority. Follows sitemap indexes and reads .gz files. " +
      "Filter with includePatterns/excludePatterns (regular expressions) and lastmodAfter or lastmodWithinDays. " +
      "Use it to map a site's pages or find recently changed ones before crawling.",
    pricing: [{ event: "URL returned", usd: 0.0002 }],
    safeDefaults: { maxTotalUrls: 500 }
  },
  {
    name: "search_hacker_news",
    actor: "fecklesspleb/hacker-news-scraper",
    toolset: "core",
    title: "Search Hacker News or its Who is hiring threads",
    description:
      "mode 'search': search Hacker News stories and comments (including Ask HN and Show HN) by keyword, points, " +
      "comment count and date through the public HN Search API by Algolia. mode 'whoIsHiring': turn the monthly " +
      "'Ask HN: Who is hiring?' thread into job records with company, role, location, remote flag and salary when stated. " +
      "Emails and phone numbers in post text are redacted by default.",
    pricing: [{ event: "item returned", usd: 0.00015 }],
    safeDefaults: { maxItems: 50 }
  },
  {
    name: "search_remote_jobs",
    actor: "fecklesspleb/remote-jobs-aggregator",
    toolset: "core",
    title: "Search remote jobs (Remote OK, We Work Remotely, Jobicy)",
    description:
      "One deduplicated list of remote job postings from the official public feeds of Remote OK, We Work Remotely and Jobicy, " +
      "with the source named on every job. Filter by keywords, excludeKeywords, locations (for example 'USA', 'Europe'), " +
      "requireSalary, minSalaryUsd and postedWithinDays. Set includeDescription to true for full descriptions.",
    pricing: [{ event: "job returned", usd: 0.001 }],
    safeDefaults: { maxTotalJobs: 25 }
  },

  // ---- jobs (company career sites) ----
  {
    name: "greenhouse_jobs",
    actor: "fecklesspleb/greenhouse-jobs-scraper",
    toolset: "jobs",
    title: "Open jobs from Greenhouse job boards",
    description:
      "Open jobs from companies that hire through Greenhouse. Pass companies as Greenhouse slugs (e.g. 'airbnb'), " +
      "boards.greenhouse.io URLs, or careers pages that embed a Greenhouse board; or set searchDirectory to true to search " +
      "a built-in directory of boards. " + JOB_FILTER_HINT + " Not affiliated with Greenhouse.",
    pricing: [{ event: "job returned", usd: 0.001 }],
    safeDefaults: { maxTotalJobs: 25, includeDescription: false }
  },
  {
    name: "lever_jobs",
    actor: "fecklesspleb/lever-jobs-scraper",
    toolset: "jobs",
    title: "Open jobs from Lever job boards",
    description:
      "Open jobs from companies that hire through Lever (jobs.lever.co, EU boards included). Pass companies as Lever slugs " +
      "(e.g. 'palantir'), board URLs or careers pages that embed a Lever board; or set searchDirectory to true to search a " +
      "built-in directory of boards. " + JOB_FILTER_HINT + " Not affiliated with Lever.",
    pricing: [{ event: "job returned", usd: 0.001 }],
    safeDefaults: { maxTotalJobs: 25, includeDescription: false }
  },
  {
    name: "ashby_jobs",
    actor: "fecklesspleb/ashby-jobs-scraper",
    toolset: "jobs",
    title: "Open jobs from Ashby job boards",
    description:
      "Open jobs from companies that hire through Ashby (jobs.ashbyhq.com). Pass companies as Ashby slugs (e.g. 'ramp'), " +
      "board URLs or careers pages that embed an Ashby board; or set searchDirectory to true to search a built-in directory " +
      "of boards. " + JOB_FILTER_HINT + " Not affiliated with Ashby.",
    pricing: [{ event: "job returned", usd: 0.001 }],
    safeDefaults: { maxTotalJobs: 25, includeDescription: false }
  },
  {
    name: "workday_jobs",
    actor: "fecklesspleb/workday-jobs-scraper",
    toolset: "jobs",
    title: "Open jobs from Workday career sites",
    description:
      "Open jobs from a Workday career site. Pass companies as full career site URLs as shown in the browser " +
      "(for example https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite); bare company names are skipped. " +
      "Also filters by salary, work arrangement, employment type, seniority and years of experience. " +
      JOB_FILTER_HINT + " Not affiliated with Workday.",
    pricing: [{ event: "job returned", usd: 0.002 }],
    safeDefaults: { maxTotalJobs: 25, includeDescription: false }
  },
  {
    name: "ats_jobs",
    actor: "fecklesspleb/ats-jobs-scraper",
    toolset: "jobs",
    title: "Open jobs from any of 9 applicant tracking systems",
    description:
      "Open jobs from company career pages on Greenhouse, Lever, Ashby, Workday, Workable, Recruitee and Teamtailor " +
      "(Polymer and HireHive by URL), normalised into one schema. Use it when you have a mix of companies or do not know " +
      "which ATS a company uses; pass board URLs or careers pages in companies. Also filters by salary, seniority, work " +
      "arrangement and staffing agencies. " + JOB_FILTER_HINT + " Not affiliated with any ATS vendor.",
    pricing: [{ event: "job returned", usd: 0.002 }],
    safeDefaults: { maxTotalJobs: 25, includeDescription: false }
  },

  // ---- web (opt-in) ----
  {
    name: "crawl_website_to_markdown",
    actor: "fecklesspleb/website-to-markdown-crawler",
    toolset: "web",
    title: "Crawl a website to Markdown",
    description:
      "Crawl a website, docs section or blog from start URLs and return each page as clean Markdown or plain text for " +
      "reading, RAG or summarising. Stays on the site, respects robots.txt, no browser. Limit with maxPages and maxDepth.",
    pricing: [
      { event: "page saved", usd: 0.0008 },
      { event: "Actor start", usd: 0.00005, note: "per GB of memory, once per run" }
    ],
    safeDefaults: { maxPages: 10, maxCharsPerPage: 20000 }
  },
  {
    name: "download_images",
    actor: "fecklesspleb/bulk-image-downloader",
    toolset: "web",
    title: "Download images and files to Apify storage",
    description:
      "Download images from a list of web pages (img, srcset, og:image) or direct file URLs into Apify storage. " +
      "Returns a public link, size, dimensions, alt text and SHA-256 for each file; the files themselves stay in your Apify account.",
    pricing: [
      { event: "file saved", usd: 0.001 },
      { event: "Actor start", usd: 0.00005, note: "per GB of memory, once per run" }
    ],
    safeDefaults: { maxFiles: 25 }
  },
  {
    name: "screenshot_website",
    actor: "fecklesspleb/website-screenshot",
    toolset: "web",
    title: "Screenshot web pages",
    description:
      "Take screenshots of web pages with headless Chrome (viewport or full page, PNG or JPEG, desktop or mobile, optional PDF). " +
      "Returns a public link to each file stored in your Apify account, not the image bytes.",
    pricing: [
      { event: "screenshot", usd: 0.0008 },
      { event: "Actor start", usd: 0.00005, note: "per GB of memory, once per run" }
    ],
    safeDefaults: { maxResults: 10 }
  },
  {
    name: "check_broken_links",
    actor: "fecklesspleb/broken-link-checker",
    toolset: "web",
    title: "Find broken links on a website",
    description:
      "Crawl a website and report broken links and images (404, 410, 5xx, DNS failures, timeouts) with the page each one is on, " +
      "the link text and the status code. Healthy links are free while onlyBroken is on (the default).",
    pricing: [
      { event: "broken link", usd: 0.003 },
      { event: "link checked", usd: 0.0005, note: "only when onlyBroken is off" },
      { event: "Actor start", usd: 0.00005, note: "per GB of memory, once per run" }
    ],
    safeDefaults: { maxPagesPerSite: 10 }
  }
];

export const DEFAULT_TOOLSETS: Toolset[] = ["core", "jobs"];

export function parseToolsets(value: string | undefined): Toolset[] {
  if (!value || !value.trim()) return DEFAULT_TOOLSETS;
  const parts = value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (parts.includes("all")) return ["core", "jobs", "web"];
  const valid = parts.filter((p): p is Toolset => p === "core" || p === "jobs" || p === "web");
  return valid.length ? valid : DEFAULT_TOOLSETS;
}

export function selectTools(toolsets: Toolset[]): ToolDef[] {
  return TOOLS.filter((t) => toolsets.includes(t.toolset));
}

export function formatPricing(def: ToolDef): string {
  return def.pricing
    .map((p) => `$${p.usd} per ${p.event}${p.note ? ` (${p.note})` : ""}`)
    .join("; ");
}

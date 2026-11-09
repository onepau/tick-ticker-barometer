// Outgoing requests, with the etiquette agreed for the price tracker:
// - one honest user agent naming tick-ticker.com (no personal email, never a
//   browser string), no cookies, no headless browser, no proxy;
// - robots.txt read once per domain per invocation and obeyed, including
//   Crawl-delay;
// - one request at a time per domain, at least MIN_DELAY_MS apart;
// - back-off on 429 and 5xx (honouring Retry-After), a bounded number of times;
// - a 403 is never retried: the domain is treated as blocked for the rest of the
//   invocation.

import {
  ALLOW_ALL,
  isAllowed,
  parseRobots,
  type RobotsRules,
} from "./robots.ts";

export const PRODUCT_TOKEN = "tick-ticker-prices";
export const USER_AGENT = `${PRODUCT_TOKEN}/1.0 (+https://tick-ticker.com)`;

export type FetchOutcome =
  | { status: "ok"; html: string; httpStatus: number; finalUrl: string }
  | { status: "not_found"; httpStatus: number; finalUrl: string }
  | { status: "blocked"; httpStatus?: number; message: string }
  | { status: "disallowed"; message: string }
  | { status: "rate_limited"; httpStatus: number; message: string }
  | { status: "error"; httpStatus?: number; message: string }
  | { status: "budget"; message: string };

export interface PoliteFetcherOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  userAgent?: string;
  minDelayMs?: number;
  /** Retries after a 429 or 5xx (not counting the first attempt). */
  maxRetries?: number;
  /** Give up rather than wait longer than this for one back-off. */
  maxBackoffMs?: number;
  /** Total outgoing requests allowed (robots.txt included). */
  maxRequests?: number;
  /** Absolute time (ms, same clock as now()) after which no request starts. */
  deadline?: number;
}

interface DomainState {
  robots: Promise<RobotsRules> | null;
  lastStart: number;
  queue: Promise<unknown>;
  blocked: string | null;
  crawlDelayMs: number;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export class PoliteFetcher {
  private readonly domains = new Map<string, DomainState>();
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  readonly userAgent: string;
  private readonly minDelayMs: number;
  private readonly maxRetries: number;
  private readonly maxBackoffMs: number;
  private readonly maxRequests: number;
  private readonly deadline: number;
  requestsMade = 0;
  /** One line per outgoing request, for the run log. */
  readonly log: { url: string; httpStatus: number | null; at: number }[] = [];

  constructor(o: PoliteFetcherOptions = {}) {
    this.f = o.fetch ?? ((...a) => fetch(...a));
    this.sleep = o.sleep ?? defaultSleep;
    this.now = o.now ?? Date.now;
    this.userAgent = o.userAgent ?? USER_AGENT;
    this.minDelayMs = Math.max(3000, o.minDelayMs ?? 3000);
    this.maxRetries = o.maxRetries ?? 2;
    this.maxBackoffMs = o.maxBackoffMs ?? 120_000;
    this.maxRequests = o.maxRequests ?? Infinity;
    this.deadline = o.deadline ?? Infinity;
  }

  private state(host: string): DomainState {
    let s = this.domains.get(host);
    if (!s) {
      s = {
        robots: null,
        lastStart: -Infinity,
        queue: Promise.resolve(),
        blocked: null,
        crawlDelayMs: 0,
      };
      this.domains.set(host, s);
    }
    return s;
  }

  /** Runs fn after every earlier task for this host has finished. */
  private serial<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const s = this.state(host);
    const next = s.queue.then(fn, fn);
    s.queue = next.catch(() => undefined);
    return next;
  }

  private budgetLeft(): string | null {
    if (this.requestsMade >= this.maxRequests)
      return "request budget for this invocation used";
    if (this.now() >= this.deadline)
      return "time budget for this invocation used";
    return null;
  }

  /** One raw request, paced for its domain. Caller holds the domain's queue. */
  private async request(url: URL, accept: string): Promise<Response> {
    const s = this.state(url.host);
    const gap = Math.max(this.minDelayMs, s.crawlDelayMs);
    const wait = s.lastStart + gap - this.now();
    if (wait > 0) await this.sleep(wait);
    s.lastStart = this.now();
    this.requestsMade++;
    try {
      const res = await this.f(url.toString(), {
        headers: { "User-Agent": this.userAgent, Accept: accept },
        redirect: "follow",
      });
      this.log.push({
        url: url.toString(),
        httpStatus: res.status,
        at: s.lastStart,
      });
      return res;
    } catch (e) {
      this.log.push({ url: url.toString(), httpStatus: null, at: s.lastStart });
      throw e;
    }
  }

  /** robots.txt for a host, fetched once per invocation. */
  robots(host: string): Promise<RobotsRules> {
    const s = this.state(host);
    if (!s.robots) {
      s.robots = this.serial(host, async () => {
        const budget = this.budgetLeft();
        if (budget) return { ...ALLOW_ALL, blockedReason: budget };
        let res: Response;
        try {
          res = await this.request(
            new URL(`https://${host}/robots.txt`),
            "text/plain",
          );
        } catch (e) {
          return {
            ...ALLOW_ALL,
            blockedReason: `robots.txt unreachable: ${(e as Error).message}`,
          };
        }
        if (res.status === 401 || res.status === 403) {
          s.blocked = `robots.txt returned ${res.status}`;
          return { ...ALLOW_ALL, blockedReason: s.blocked };
        }
        if (res.status >= 500 || res.status === 429) {
          return {
            ...ALLOW_ALL,
            blockedReason: `robots.txt returned ${res.status}`,
          };
        }
        if (res.status >= 400) return { ...ALLOW_ALL }; // 404 and friends: no rules
        const rules = parseRobots(await res.text(), PRODUCT_TOKEN);
        if (rules.crawlDelaySec) s.crawlDelayMs = rules.crawlDelaySec * 1000;
        return rules;
      });
    }
    return s.robots;
  }

  /** GET a page, following the etiquette above. Never throws. */
  async get(rawUrl: string): Promise<FetchOutcome> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { status: "error", message: `invalid URL: ${rawUrl}` };
    }
    if (url.protocol !== "https:")
      return { status: "error", message: "only https URLs are fetched" };
    const rules = await this.robots(url.host);
    const s = this.state(url.host);
    if (s.blocked) return { status: "blocked", message: s.blocked };
    if (rules.blockedReason) {
      return rules.blockedReason.includes("budget")
        ? { status: "budget", message: rules.blockedReason }
        : { status: "disallowed", message: rules.blockedReason };
    }
    if (!isAllowed(rules, url.pathname + url.search)) {
      return {
        status: "disallowed",
        message: `robots.txt disallows ${url.pathname}`,
      };
    }
    return this.serial(url.host, async () => {
      for (let attempt = 0; ; attempt++) {
        if (s.blocked) return { status: "blocked", message: s.blocked };
        const budget = this.budgetLeft();
        if (budget) return { status: "budget", message: budget };
        let res: Response;
        try {
          res = await this.request(url, "text/html,application/xhtml+xml");
        } catch (e) {
          if (attempt >= this.maxRetries)
            return { status: "error", message: (e as Error).message };
          await this.sleep(this.backoff(attempt, null));
          continue;
        }
        if (res.ok)
          return {
            status: "ok",
            html: await res.text(),
            httpStatus: res.status,
            finalUrl: res.url || url.toString(),
          };
        if (res.status === 403 || res.status === 401) {
          s.blocked = `HTTP ${res.status} on ${url.pathname}; not retried`;
          return {
            status: "blocked",
            httpStatus: res.status,
            message: s.blocked,
          };
        }
        if (res.status === 404 || res.status === 410) {
          return {
            status: "not_found",
            httpStatus: res.status,
            finalUrl: res.url || url.toString(),
          };
        }
        if (res.status === 429 || res.status >= 500) {
          const wait = this.backoff(attempt, res.headers.get("retry-after"));
          if (attempt >= this.maxRetries || wait > this.maxBackoffMs) {
            return {
              status: res.status === 429 ? "rate_limited" : "error",
              httpStatus: res.status,
              message: `HTTP ${res.status} after ${attempt + 1} attempt(s)`,
            };
          }
          await this.sleep(wait);
          continue;
        }
        return {
          status: "error",
          httpStatus: res.status,
          message: `HTTP ${res.status}`,
        };
      }
    });
  }

  private backoff(attempt: number, retryAfter: string | null): number {
    const base = 10_000 * 2 ** attempt;
    if (!retryAfter) return base;
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return Math.max(base, secs * 1000);
    const date = Date.parse(retryAfter);
    return Number.isFinite(date) ? Math.max(base, date - this.now()) : base;
  }
}

// robots.txt parsing (RFC 9309): groups by user agent, Allow/Disallow with * and $
// wildcards, longest match wins, Allow wins a tie. Crawl-delay is not in the RFC
// but several brand sites set it, so it is read and respected.

export interface RobotsRules {
  /** Which group applied: our product token or "*". "none" when no group matched. */
  group: string;
  allow: string[];
  disallow: string[];
  crawlDelaySec: number | null;
  /** Set when robots.txt could not be read in a way that allows crawling. */
  blockedReason?: string;
}

export const ALLOW_ALL: RobotsRules = {
  group: "none",
  allow: [],
  disallow: [],
  crawlDelaySec: null,
};

export function parseRobots(text: string, productToken: string): RobotsRules {
  const groups: {
    agents: string[];
    allow: string[];
    disallow: string[];
    delay: number | null;
  }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    else if (key === "disallow" && value) current.disallow.push(value);
    else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.delay = n;
    }
  }
  const token = productToken.toLowerCase();
  const own = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && token.startsWith(a)),
  );
  const chosen = own.length
    ? own
    : groups.filter((g) => g.agents.includes("*"));
  if (chosen.length === 0) return { ...ALLOW_ALL };
  return {
    group: own.length ? token : "*",
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
    crawlDelaySec: chosen.reduce<number | null>(
      (d, g) => (g.delay === null ? d : Math.max(d ?? 0, g.delay)),
      null,
    ),
  };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Whether the path (with query string) may be fetched under these rules. */
export function isAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  if (rules.blockedReason) return false;
  let best: { len: number; allow: boolean } | null = null;
  const consider = (patterns: string[], allow: boolean) => {
    for (const p of patterns) {
      if (!patternToRegex(p).test(pathAndQuery)) continue;
      const len = p.length;
      if (!best || len > best.len || (len === best.len && allow))
        best = { len, allow };
    }
  };
  consider(rules.disallow, false);
  consider(rules.allow, true);
  return best === null ? true : (best as { allow: boolean }).allow;
}

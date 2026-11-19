-- Editable page text (unit 10). Forward-only.
--
-- site_text holds short blocks of copy that Paul can change without a deploy. The first
-- is the introduction of the January price-increase report, one row per report
-- ('increases-2027-intro'; a 2028 report adds 'increases-2028-intro').
--
-- body is plain text: a blank line starts a new paragraph, HTML is escaped on render, so
-- nothing typed here can break the page. To edit it:
--
--   wrangler d1 execute baromontres --remote --command \
--     "UPDATE site_text SET body = 'First paragraph.' || char(10) || char(10) || 'Second.',
--             updated_at = datetime('now') WHERE key = 'increases-2027-intro'"
--
-- Pages cache for five minutes, so an edit shows within that time.

CREATE TABLE IF NOT EXISTS site_text (
  key        TEXT PRIMARY KEY CHECK (key GLOB '[a-z0-9]*' AND key NOT GLOB '*[^a-z0-9-]*'),
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO site_text (key, body) VALUES (
  'increases-2027-intro',
  'Watch brands usually raise their list prices at the start of the year, and rarely say so. This page lists every official list price that has changed since our December 2026 baseline, in each of the four markets we track.' || char(10) || char(10) ||
  'Each row compares the price captured from the brand''s own site (or a named authorised retailer) in the December baseline with the latest price captured since. The table is sorted by the size of the change; use the column headings to sort by brand or market instead.'
);

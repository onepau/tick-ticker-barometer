-- List-price tracker, unit 6: sources by domain, manual capture, reference URLs.
-- Forward-only.
--
-- 1. price_sources gains a `source` ('brand:<domain>' or 'retailer:<domain>'),
--    the method 'manual' (Paul's bookmarklet capture on a page he opened himself),
--    the robots rules seen and the page's tax label. SQLite cannot change a CHECK
--    constraint in place, so the table is rebuilt. It holds no rows on the remote
--    database yet (0007 is not applied remotely); any local rows are copied with
--    source 'brand:unknown' for a person to fix.
-- 2. reference_price_urls: the product page of each reference in each market, per
--    source (loaded from docs/plans/u5-reference-candidates.csv).
-- 3. price_snapshots gains source, method and tax_label. Adding columns does not
--    touch existing rows, so the append-only triggers stay as they are.
-- 4. price_snapshots_countable: the snapshots that may be published. A retailer
--    price counts only once the same reference has an 'ok' manual capture from the
--    brand's own site (decision of 9 November 2026 for Rolex and Panerai).

CREATE TABLE price_sources_v8 (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id     INTEGER NOT NULL,              -- brands.id
  market_code  TEXT    NOT NULL REFERENCES price_markets(code),
  source       TEXT    NOT NULL
               CHECK (source GLOB 'brand:?*' OR source GLOB 'retailer:?*'),
  url_template TEXT,
  adapter_key  TEXT,
  method       TEXT    NOT NULL DEFAULT 'fetch'
               CHECK (method IN ('fetch', 'browser', 'manual')),
  robots_ok    INTEGER NOT NULL DEFAULT 0 CHECK (robots_ok IN (0, 1)),
  robots_rules TEXT    CHECK (robots_rules IS NULL OR json_valid(robots_rules)),
  checked_at   TEXT,
  tax_label    TEXT,                          -- as shown on the page, e.g. 'incl. VAT'
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (url_template IS NOT NULL OR adapter_key IS NOT NULL OR method = 'manual'),
  UNIQUE (brand_id, market_code, source, method)
);

INSERT INTO price_sources_v8
  (id, brand_id, market_code, source, url_template, adapter_key, method,
   robots_ok, checked_at, notes, created_at)
SELECT id, brand_id, market_code, 'brand:unknown', url_template, adapter_key, method,
       robots_ok, checked_at, notes, created_at
  FROM price_sources;

DROP TABLE price_sources;
ALTER TABLE price_sources_v8 RENAME TO price_sources;
CREATE INDEX IF NOT EXISTS idx_price_sources_market ON price_sources(market_code);
CREATE INDEX IF NOT EXISTS idx_price_sources_source ON price_sources(source);

CREATE TABLE IF NOT EXISTS reference_price_urls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_id INTEGER NOT NULL REFERENCES watch_references(id),
  market_code  TEXT    NOT NULL REFERENCES price_markets(code),
  source       TEXT    NOT NULL
               CHECK (source GLOB 'brand:?*' OR source GLOB 'retailer:?*'),
  url          TEXT    NOT NULL CHECK (url GLOB 'https://?*'),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reference_id, market_code, source)
);
CREATE INDEX IF NOT EXISTS idx_reference_price_urls_source
  ON reference_price_urls(source, active);

ALTER TABLE price_snapshots ADD COLUMN source TEXT
  CHECK (source IS NULL OR source GLOB 'brand:?*' OR source GLOB 'retailer:?*');
ALTER TABLE price_snapshots ADD COLUMN method TEXT
  CHECK (method IS NULL OR method IN ('fetch', 'browser', 'manual'));
ALTER TABLE price_snapshots ADD COLUMN tax_label TEXT;

CREATE INDEX IF NOT EXISTS idx_price_snapshots_manual
  ON price_snapshots(reference_id, method, status);

CREATE VIEW IF NOT EXISTS price_snapshots_countable AS
SELECT s.*
  FROM price_snapshots s
 WHERE s.source IS NULL
    OR s.source NOT GLOB 'retailer:*'
    OR EXISTS (
         SELECT 1 FROM price_snapshots m
          WHERE m.reference_id = s.reference_id
            AND m.method = 'manual'
            AND m.source GLOB 'brand:*'
            AND m.status = 'ok'
       );

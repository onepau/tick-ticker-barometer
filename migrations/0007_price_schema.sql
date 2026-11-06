-- List-price tracker schema (unit 4). Forward-only.
--
-- Official retail prices for new watches, captured per reference and market.
-- Amounts are always integer minor units (centimes, cents, pence); never floats.
--
-- Cross-unit references: price_sources.brand_id and price_snapshots.reference_id
-- point at brands.id and watch_references.id, which unit 1 creates in migrations
-- 0005–0006. They are plain INTEGER columns without FOREIGN KEY constraints so
-- this migration applies on its own; a later migration may add the constraints
-- once both units are on main.

-- Markets: one row per country we capture, with its currency and whether the
-- displayed retail price includes sales tax (VAT in CH, FR and UK; not in the US).
CREATE TABLE IF NOT EXISTS price_markets (
  code         TEXT    PRIMARY KEY CHECK (length(code) = 2),
  currency     TEXT    NOT NULL CHECK (length(currency) = 3),
  tax_included INTEGER NOT NULL CHECK (tax_included IN (0, 1))
);

INSERT OR IGNORE INTO price_markets (code, currency, tax_included) VALUES
  ('CH', 'CHF', 1),
  ('FR', 'EUR', 1),
  ('UK', 'GBP', 1),
  ('US', 'USD', 0);

-- Where and how each brand's prices are fetched in each market.
CREATE TABLE IF NOT EXISTS price_sources (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id     INTEGER NOT NULL,              -- brands.id (unit 1); no FK yet
  market_code  TEXT    NOT NULL REFERENCES price_markets(code),
  url_template TEXT,
  adapter_key  TEXT,
  method       TEXT    NOT NULL DEFAULT 'fetch' CHECK (method IN ('fetch', 'browser')),
  robots_ok    INTEGER NOT NULL DEFAULT 0 CHECK (robots_ok IN (0, 1)),
  checked_at   TEXT,
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (url_template IS NOT NULL OR adapter_key IS NOT NULL),
  UNIQUE (brand_id, market_code)
);
CREATE INDEX IF NOT EXISTS idx_price_sources_market ON price_sources(market_code);

-- One row per capture run (monthly cron, January dailies, manual re-runs).
-- "trigger" is an SQL keyword, so it is quoted wherever it is used.
CREATE TABLE IF NOT EXISTS capture_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT    NOT NULL,
  finished_at TEXT,
  "trigger"   TEXT    NOT NULL CHECK ("trigger" IN ('cron', 'manual')),
  counts      TEXT    CHECK (counts IS NULL OR json_valid(counts)),
  errors      TEXT    CHECK (errors IS NULL OR json_valid(errors))
);
CREATE INDEX IF NOT EXISTS idx_capture_runs_started ON capture_runs(started_at);

-- Append-only price observations. Never updated or deleted in place: a
-- correction is a new row. The triggers below enforce this.
--
-- amount_minor is set only when status = 'ok'; it must be a positive integer.
-- With INTEGER affinity, 990.0 is stored as 990, while 990.5 stays REAL and is
-- rejected by the typeof() check.
CREATE TABLE IF NOT EXISTS price_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_id INTEGER NOT NULL,              -- watch_references.id (unit 1); no FK yet
  market_code  TEXT    NOT NULL REFERENCES price_markets(code),
  amount_minor INTEGER,
  currency     TEXT    NOT NULL CHECK (length(currency) = 3),
  status       TEXT    NOT NULL
               CHECK (status IN ('ok', 'price_on_request', 'unavailable', 'error')),
  captured_at  TEXT    NOT NULL,
  source_url   TEXT,
  evidence_key TEXT,                          -- R2 object key of the stored page or extract
  content_hash TEXT,
  run_id       INTEGER REFERENCES capture_runs(id),
  CHECK (
    (status = 'ok' AND typeof(amount_minor) = 'integer' AND amount_minor > 0)
    OR (status <> 'ok' AND amount_minor IS NULL)
  )
);

-- Latest price per reference and market, and history per reference (prefix
-- reference_id). id breaks ties between rows captured in the same instant.
CREATE INDEX IF NOT EXISTS idx_price_snapshots_ref_market_time
  ON price_snapshots(reference_id, market_code, captured_at DESC, id DESC);
-- Market-wide scans (all references in one market) and per-run reports.
CREATE INDEX IF NOT EXISTS idx_price_snapshots_market_time
  ON price_snapshots(market_code, captured_at);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_run ON price_snapshots(run_id);

CREATE TRIGGER IF NOT EXISTS trg_price_snapshots_no_update
BEFORE UPDATE ON price_snapshots
BEGIN
  SELECT RAISE(ABORT, 'price_snapshots is append-only: insert a new row instead');
END;

CREATE TRIGGER IF NOT EXISTS trg_price_snapshots_no_delete
BEFORE DELETE ON price_snapshots
BEGIN
  SELECT RAISE(ABORT, 'price_snapshots is append-only: rows cannot be deleted');
END;

-- ECB euro foreign exchange reference rates (base EUR). Used for regional
-- comparisons only, never to overwrite captured prices. A rate is a ratio, not
-- an amount, so REAL is acceptable here: 1 EUR = rate units of currency.
CREATE TABLE IF NOT EXISTS fx_rates (
  date     TEXT NOT NULL,                     -- YYYY-MM-DD, ECB reference date
  base     TEXT NOT NULL DEFAULT 'EUR' CHECK (base = 'EUR'),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  rate     REAL NOT NULL CHECK (rate > 0),
  PRIMARY KEY (date, base, currency)
);
CREATE INDEX IF NOT EXISTS idx_fx_rates_currency_date ON fx_rates(currency, date);

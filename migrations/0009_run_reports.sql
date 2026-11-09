-- List-price tracker, unit 7: validation report per capture run, and review flags.
-- Forward-only.
--
-- run_reports: the JSON report built when a run finishes (coverage, changes since
-- the previous capture of each cell, outliers). One row per run; rebuilt if the
-- run is finished again.
-- price_review_flags: a snapshot that needs a person's look before it is
-- published (change above 15%, currency mismatch, retailer price without a brand
-- capture). Snapshots stay append-only; the flag is a separate row, and the view
-- of publishable snapshots now skips snapshots with an unresolved flag. A person
-- resolves a flag by setting resolved_at (and a note).

CREATE TABLE IF NOT EXISTS run_reports (
  run_id     INTEGER PRIMARY KEY REFERENCES capture_runs(id),
  created_at TEXT    NOT NULL,
  report     TEXT    NOT NULL CHECK (json_valid(report))
);

CREATE TABLE IF NOT EXISTS price_review_flags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES price_snapshots(id),
  run_id      INTEGER REFERENCES capture_runs(id),
  kind        TEXT    NOT NULL
              CHECK (kind IN ('change_over_15', 'currency_mismatch', 'retailer_unconfirmed')),
  detail      TEXT,
  created_at  TEXT    NOT NULL,
  resolved_at TEXT,
  resolution  TEXT,
  UNIQUE (snapshot_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_price_review_flags_open
  ON price_review_flags(resolved_at, run_id);

DROP VIEW IF EXISTS price_snapshots_countable;
CREATE VIEW price_snapshots_countable AS
SELECT s.*
  FROM price_snapshots s
 WHERE (
         s.source IS NULL
      OR s.source NOT GLOB 'retailer:*'
      OR EXISTS (
           SELECT 1 FROM price_snapshots m
            WHERE m.reference_id = s.reference_id
              AND m.method = 'manual'
              AND m.source GLOB 'brand:*'
              AND m.status = 'ok'
         )
       )
   AND NOT EXISTS (
         SELECT 1 FROM price_review_flags f
          WHERE f.snapshot_id = s.id AND f.resolved_at IS NULL
       );

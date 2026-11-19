-- Brand registry, unit 1: watch references (the models whose list prices are tracked).
-- Forward-only. Named watch_references because REFERENCES is an SQL keyword.
-- price_snapshots.reference_id (0007, unit 4) points at watch_references.id.
--
-- slug is slugifyReference(brand slug, ref_code), for example
-- 'omega/310-30-42-50-01-001' (packages/shared/src/slug.ts).

CREATE TABLE IF NOT EXISTS watch_references (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id      INTEGER NOT NULL REFERENCES brands(id),
  slug          TEXT    NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*/[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9/-]*'),
  ref_code      TEXT    NOT NULL,          -- the manufacturer's reference, as printed
  family        TEXT,                      -- for example 'Speedmaster', 'Submariner'
  name          TEXT,
  case_material TEXT,
  diameter_mm   REAL    CHECK (diameter_mm IS NULL OR diameter_mm BETWEEN 10 AND 80),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (brand_id, ref_code)
);
CREATE INDEX IF NOT EXISTS idx_watch_references_brand  ON watch_references(brand_id, active);
CREATE INDEX IF NOT EXISTS idx_watch_references_family ON watch_references(brand_id, family);

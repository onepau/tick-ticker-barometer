-- Brand registry, unit 1: groups, brands, cross-site aliases and key people.
-- Forward-only. Served publicly by the registry Worker (apps/registry); the private
-- barometer does not read these tables yet.
--
-- brands.id and watch_references.id (0006) are the join keys for the price tables
-- (0007, unit 4): keep them stable. The seed upserts on slug, so re-seeding never
-- renumbers a brand.

CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  wikidata_id TEXT    UNIQUE CHECK (wikidata_id IS NULL OR wikidata_id GLOB 'Q[0-9]*'),
  website     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- slug equals the live GPHG slug wherever a GPHG brand page exists (slugifyBrand in
-- packages/shared/src/slug.ts). status and prices_public are NULL until researched
-- (unit 2), rather than guessed.
CREATE TABLE IF NOT EXISTS brands (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT    NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  name           TEXT    NOT NULL,
  group_id       INTEGER REFERENCES groups(id),
  founded_year   INTEGER CHECK (founded_year IS NULL OR founded_year BETWEEN 1500 AND 2100),
  dissolved_year INTEGER CHECK (dissolved_year IS NULL OR dissolved_year BETWEEN 1500 AND 2100),
  status         TEXT    CHECK (status IS NULL OR status IN ('active','dormant','dead','revived')),
  hq_city        TEXT,
  hq_country     TEXT    CHECK (hq_country IS NULL OR length(hq_country) = 2),  -- ISO 3166-1 alpha-2
  website        TEXT,
  wikidata_id    TEXT    UNIQUE CHECK (wikidata_id IS NULL OR wikidata_id GLOB 'Q[0-9]*'),
  prices_public  INTEGER CHECK (prices_public IS NULL OR prices_public IN (0,1)),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (dissolved_year IS NULL OR founded_year IS NULL OR dissolved_year >= founded_year)
);
CREATE INDEX IF NOT EXISTS idx_brands_group  ON brands(group_id);
CREATE INDEX IF NOT EXISTS idx_brands_status ON brands(status);

-- Maps each site's own brand identifier to the registry brand:
--   gphg      GPHG brand_id ('audemars piguet') and raw names from brand_aliases.csv
--   onlywatch Only Watch brand_id ('andersen-geneve')
--   manual    anything added by hand (press spellings, former names)
CREATE TABLE IF NOT EXISTS brand_aliases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  alias      TEXT    NOT NULL,
  source     TEXT    NOT NULL CHECK (source IN ('gphg','onlywatch','manual')),
  brand_id   INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, alias)
);
CREATE INDEX IF NOT EXISTS idx_brand_aliases_brand ON brand_aliases(brand_id);

CREATE TABLE IF NOT EXISTS brand_people (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id   INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  role       TEXT    NOT NULL,          -- for example 'founder', 'CEO', 'watchmaker'
  from_year  INTEGER,
  to_year    INTEGER,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (to_year IS NULL OR from_year IS NULL OR to_year >= from_year)
);
CREATE INDEX IF NOT EXISTS idx_brand_people_brand ON brand_people(brand_id);

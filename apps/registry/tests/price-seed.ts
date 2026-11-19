import type { TestD1 } from "./d1.ts";

/** Omega (public prices, one reference) and Rolex (public, retailer prices); Tissot is not public. */
export function seedPrices(t: TestD1): void {
  t.raw.exec(`
    INSERT INTO brands (id, slug, name, status, prices_public) VALUES
      (1, 'omega', 'Omega', 'active', 1),
      (2, 'rolex', 'Rolex', 'active', 1),
      (3, 'tissot', 'Tissot', 'active', 0);
    INSERT INTO watch_references (id, brand_id, slug, ref_code, family, name, case_material, diameter_mm) VALUES
      (1, 1, 'omega/310-30-42-50-01-001', '310.30.42.50.01.001', 'Speedmaster', 'Speedmaster Moonwatch Professional', 'steel', 42),
      (2, 2, 'rolex/126610ln', '126610LN', 'Submariner', 'Submariner Date', 'steel', 41),
      (3, 3, 'tissot/t137-407', 'T137.407', 'PRX', 'PRX', 'steel', 40),
      (4, 1, 'omega/no-prices', '000.00', NULL, 'No prices yet', NULL, NULL);
    INSERT INTO fx_rates (date, base, currency, rate) VALUES
      ('2026-12-01','EUR','CHF',0.93),('2026-12-01','EUR','GBP',0.83),('2026-12-01','EUR','USD',1.06);
    -- Omega: CH brand price rising on 2 January; FR; US excludes tax; UK price on request.
    INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at, source, method, source_url) VALUES
      (1,'CH',700000,'CHF','ok','2026-12-01T10:00:00Z','brand:www.omegawatches.com','fetch','https://www.omegawatches.com/ch/x'),
      (1,'CH',700000,'CHF','ok','2026-12-29T10:00:00Z','brand:www.omegawatches.com','fetch',NULL),
      (1,'CH',721000,'CHF','ok','2027-01-02T10:00:00Z','brand:www.omegawatches.com','fetch',NULL),
      (1,'FR',745000,'EUR','ok','2027-01-02T10:00:00Z','brand:www.omegawatches.com','fetch',NULL),
      (1,'US',700000,'USD','ok','2027-01-02T10:00:00Z','brand:www.omegawatches.com','fetch',NULL),
      (1,'UK',NULL,'GBP','price_on_request','2027-01-02T10:00:00Z','brand:www.omegawatches.com','fetch',NULL),
      (1,'FR',NULL,'EUR','error','2027-01-03T10:00:00Z','brand:www.omegawatches.com','fetch',NULL);
    -- Rolex: retailer prices only; counted once a manual brand capture exists.
    INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at, source, method) VALUES
      (2,'CH',1020000,'CHF','ok','2026-12-01T10:00:00Z','retailer:www.bucherer.com','fetch'),
      (2,'CH',1020000,'CHF','ok','2026-11-09T10:00:00Z','brand:www.rolex.com','manual');
    -- Tissot: not public.
    INSERT INTO price_snapshots (reference_id, market_code, amount_minor, currency, status, captured_at, source, method) VALUES
      (3,'CH',50000,'CHF','ok','2026-12-01T10:00:00Z','brand:www.tissotwatches.com','fetch');
  `);
}


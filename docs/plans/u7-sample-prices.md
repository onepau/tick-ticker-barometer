# Unit 7: sample prices for Paul's spot check

Twelve pages, two per new brand, read on 9 November 2026 at 13:27 UTC by the unit 7 adapters through the polite fetcher (`apps/prices/scripts/sample-live.ts`; robots.txt first, at least 3 s per domain, user agent `tick-ticker-prices/1.0 (+https://tick-ticker.com)`). Nothing was written to D1 or R2. Every figure equals the price recorded in `docs/plans/u5-reference-candidates.csv` on 6 November.

**What to check:** open the URL, find the price on the page, compare with the "Price read" column. "Tax wording" is what the page prints beside the price; "none" means nothing is printed there, so the market convention applies (tax included in CH, FR and UK, excluded in the US).

| Brand       | Reference                      | Market | Price read                                                          | Tax wording | URL                                                                                                                  |
| ----------- | ------------------------------ | ------ | ------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| Longines    | L2.286.4.52.6                  | CH     | CHF 950.00                                                          | none        | https://www.longines.com/fr-ch/p/watch-conquest-classic-l2-286-4-52-6                                                |
| Longines    | L2.142.4.70.6                  | UK     | £2,100.00                                                           | none        | https://www.longines.com/en-gb/p/watch-longines-evidenza-l2-142-4-70-6                                               |
| Tissot      | T150.410.11.041.00             | CH     | 285,00 CHF                                                          | none        | https://www.tissotwatches.com/fr-ch/T1504101104100.html                                                              |
| Tissot      | T150.417.11.041.00             | US     | $425.00                                                             | none        | https://www.tissotwatches.com/en-us/T1504171104100.html                                                              |
| Rado        | R32505313                      | CH     | 2 100.00 CHF                                                        | none        | https://www.rado.com/fr_ch/captain-cook-automatic-r32505313.html                                                     |
| Rado        | R32505313                      | UK     | £2,050.00                                                           | none        | https://www.rado.com/en_gb/captain-cook-automatic-r32505313.html                                                     |
| Omega       | 310.30.42.50.01.001            | CH     | CHF 6’600                                                           | none        | https://www.omegawatches.com/en-ch/watch-omega-speedmaster-moonwatch-professional-co-axial-master-chronometer-chronograph-42-mm-31030425001001 |
| Omega       | 324.30.38.50.01.002            | CH     | CHF 5’500                                                           | none        | https://www.omegawatches.com/en-ch/watch-omega-speedmaster-38-co-axial-chronometer-chronograph-38-mm-32430385001002  |
| Oris        | 01 733 7707 4053-07 8 20 18    | CH     | CHF 2'450.00                                                        | none        | https://www.oris.ch/de-CH/product/watch/divers/divers-sixty-five/01-733-7707-4053-07-8-20-18                         |
| Oris        | 01 733 7707 4064-07 8 20 18    | CH     | **price on request** (page says the model is not available online)  | none        | https://www.oris.ch/de-CH/product/watch/divers/divers-sixty-five/01-733-7707-4064-07-8-20-18                         |
| Grand Seiko | SBGX363                        | CH     | CHF 3,700.00                                                        | none        | https://www.grand-seiko.com/ch-fr/collections/sbgx363g                                                               |
| Grand Seiko | SBGD201                        | US     | **price on request** (title and collection, no price; boutique link) | none        | https://www.grand-seiko.com/us-en/collections/sbgd201j                                                               |

## Notes

- **Omega** is CH only. The two CH pages are the first two Omega rows of the reference list.
- **Oris POR**: the CSV lists this reference as `POR` for CH, FR and UK and 2,400 for the US. The adapter records `price_on_request` when the product's price block is empty and the page shows the "not available online" message. This is a reading of the page, not Oris's own words "on request"; worth a look.
- **Grand Seiko**: SBGX363's page also shows "Jan.2027 Release Date" next to the price, so it is a model announced but not yet on sale; the price is the announced one. The SBGD201 CH page does show a price (CHF 63,100.00); the US page has none.
- **Longines** pages can show OutOfStock in their data while still printing a price; the price is kept.

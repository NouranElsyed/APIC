# Nozzle catalogue data

`src/features/nozzles/catalogue-data.ts` holds the Trouvay & Cauvin "Piping Equipment 2001" tables:

- `CAT_PIPE` - ASME B36.10M, every wall thickness per DN (kg/m from the catalogue). STD / XS / XXS labels only; schedule numbers could not be read reliably, so select by wall.
- `CAT_FLANGE` - ASME B16.5 classes 150-2500, DN15-DN600: OD, thickness, RF dia, holes, bolt circle, hub length, weights for WN / SO / LAP / THR / BLIND (classes 1500 and 2500: WN only).

`calcNozzle({ ..., flangeClass, flangeType, wallMm | schedule })` uses them. The catalogue is the only data source: the old tank-workbook tables (`PIPE_STD`, `FLANGE_WN_150_KG`) and the `source` option were removed.

The Nozzles page has no data selector any more: every row has Class, Flange type and Wall.

Differences from the old tank workbook: DN40 STD is 4.05 kg/m (the workbook's 3.63 is the XS lb/ft value); class 150 weld-neck flanges weigh 10-35% more than the workbook's table (closer to slip-on). Neck and pad still reconcile with the 151 workbook rows (`calc.test.ts`). One catalogue misprint (DN1150 x 12.7 mm) is pinned in `catalogue.test.ts`. Pad sizes, API-650 tables and projections are not in the catalogue and remain inputs.

Tests: `npx vitest run src/features/nozzles`.

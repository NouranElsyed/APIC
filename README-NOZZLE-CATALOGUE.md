# Nozzle catalogue data

`src/features/nozzles/catalogue-data.ts` holds the Trouvay & Cauvin "Piping Equipment 2001" tables:

- `CAT_PIPE` - ASME B36.10M, every wall thickness per DN (kg/m from the catalogue). STD / XS / XXS labels only; schedule numbers could not be read reliably, so select by wall.
- `CAT_FLANGE` - ASME B16.5 classes 150-2500, DN15-DN600: OD, thickness, RF dia, holes, bolt circle, hub length, weights for WN / SO / LAP / THR / BLIND (classes 1500 and 2500: WN only).

`calcNozzle({ ..., source: "catalogue", flangeClass, flangeType, wallMm | schedule })` uses them. Without `source` nothing changes: the tank-workbook values stay the default, so the 151 workbook rows still reproduce.

The Nozzles page has a "Data" selector (workbook / catalogue). In catalogue mode each row gets Class, Flange type and Wall.

Known differences from the workbook: DN40 STD is 4.05 kg/m (the workbook's 3.63 is the XS lb/ft value); class 150 weld-neck flanges weigh 10-35% more than the workbook's table (closer to slip-on). One catalogue misprint (DN1150 x 12.7 mm) is pinned in `catalogue.test.ts`. Pad sizes, API-650 tables and projections are not in the catalogue and remain inputs.

Tests: `npx vitest run src/features/nozzles`.

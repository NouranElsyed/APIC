// ----------------------------------------------------------------------------
// Auto-extracted from the real "calculate_area_formatted.xlsx" workbook
// (sheet "Riser Duct Fabrication Drg"), 97 actual BOM lines across 8 real
// drawings — not a synthetic per-material summary. Regenerate by re-running
// the extraction script against the source workbook if the BOM changes.
// ----------------------------------------------------------------------------

export interface DrawingItemSeed {
  itemNo: string;
  description: string;
  thicknessMm: number;
  qty: number;
  unitAreaSqm: number;
  widthMm: number | null;
  lengthM: number | null;
}

export interface DrawingSeed {
  drawingNumber: string;
  title: string;
  items: DrawingItemSeed[];
}

export interface GroupSeed {
  thicknessMm: number;
  usedAreaSqm: number;
  buyQty: number;
  widthM: number; // buy-stock width in meters
  lengthM: number; // buy-stock length in meters
}

export const DRAWINGS: DrawingSeed[] = [
  {
    drawingNumber: "13334036",
    title: "Existing Riser Ø4657",
    items: [
      { itemNo: "1", description: "PL 20 mm", thicknessMm: 20, qty: 1, unitAreaSqm: 7.686095, widthMm: 240.0, lengthM: 16.0126977553472 },
      { itemNo: "2", description: "PL 20 mm", thicknessMm: 20, qty: 1, unitAreaSqm: 17.77199, widthMm: 500.0, lengthM: 17.7719896413575 },
      { itemNo: "3", description: "PL 20 mm", thicknessMm: 20, qty: 22, unitAreaSqm: 0.5616, widthMm: 500.0, lengthM: 0.78 },
    ],
  },
  {
    drawingNumber: "13334034",
    title: "riser transition Ø4657 to Ø5390",
    items: [
      { itemNo: "1", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 27.374, widthMm: null, lengthM: null },
      { itemNo: "2", description: "FB 80 x 10", thicknessMm: 10, qty: 32, unitAreaSqm: 0.024, widthMm: 80.0, lengthM: 0.236 },
      { itemNo: "3", description: "FB 90 x 20", thicknessMm: 20, qty: 16, unitAreaSqm: 0.1773, widthMm: 90.0, lengthM: 0.985 },
      { itemNo: "4", description: "FB 120 x 12", thicknessMm: 12, qty: 1, unitAreaSqm: 4.207221, widthMm: 120.0, lengthM: 17.530087007031 },
    ],
  },
  {
    drawingNumber: "13282037",
    title: "Riser Ø5390",
    items: [
      { itemNo: "1", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 120.799788, widthMm: 3571.0, lengthM: 16.914 },
      { itemNo: "2", description: "FB 80 x 10", thicknessMm: 10, qty: 32, unitAreaSqm: 0.01768, widthMm: 80.0, lengthM: 0.188 },
      { itemNo: "3", description: "FB 90 x 20", thicknessMm: 20, qty: 16, unitAreaSqm: 0.1773, widthMm: 90.0, lengthM: 0.985 },
      { itemNo: "4", description: "FB 120 x 12", thicknessMm: 12, qty: 1, unitAreaSqm: 4.214761, widthMm: 120.0, lengthM: 17.5615029335669 },
      { itemNo: "5", description: "FB 90 x 20", thicknessMm: 20, qty: 4, unitAreaSqm: 0.1188, widthMm: 90.0, lengthM: 0.66 },
      { itemNo: "6", description: "FB 90 x 20", thicknessMm: 20, qty: 8, unitAreaSqm: 0.0999, widthMm: 90.0, lengthM: 0.555 },
      { itemNo: "7", description: "FB 80 x 10", thicknessMm: 10, qty: 16, unitAreaSqm: 0.010016, widthMm: 80.0, lengthM: 0.181 },
    ],
  },
  {
    drawingNumber: "13334033",
    title: "Riser Ø5390",
    items: [
      { itemNo: "1", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 70.1931, widthMm: 2075.0, lengthM: 16.914 },
      { itemNo: "2", description: "FB 120 x 12", thicknessMm: 12, qty: 1, unitAreaSqm: 4.214761, widthMm: 120.0, lengthM: 17.5615029335669 },
      { itemNo: "3", description: "FB 115 x 10", thicknessMm: 10, qty: 32, unitAreaSqm: 0.025185, widthMm: 115.0, lengthM: 0.186 },
      { itemNo: "4", description: "FB 90 x 20", thicknessMm: 20, qty: 16, unitAreaSqm: 0.1773, widthMm: 90.0, lengthM: 0.985 },
    ],
  },
  {
    drawingNumber: "13334011",
    title: "Riser Ø5390  TOP PLATE",
    items: [
      { itemNo: "1", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 21.219462, widthMm: 2827.0, lengthM: 4.601 },
      { itemNo: "2", description: "FB 170 X 20", thicknessMm: 20, qty: 1, unitAreaSqm: 1.27466, widthMm: 170.0, lengthM: 3.749 },
      { itemNo: "3", description: "FB 170 X 20", thicknessMm: 20, qty: 1, unitAreaSqm: 1.45418, widthMm: 170.0, lengthM: 4.277 },
    ],
  },
  {
    drawingNumber: "13334010",
    title: "Riser Ø5390 TOP PLATE",
    items: [
      { itemNo: "1", description: "PL 8 mm", thicknessMm: 8, qty: 1, unitAreaSqm: 62.64, widthMm: null, lengthM: null },
      { itemNo: "2", description: "FB 170 X 20", thicknessMm: 20, qty: 1, unitAreaSqm: 1.74964, widthMm: 170.0, lengthM: 5.146 },
      { itemNo: "3", description: "FB 170 X 20", thicknessMm: 20, qty: 1, unitAreaSqm: 1.84586, widthMm: 170.0, lengthM: 5.429 },
      { itemNo: "4", description: "FB 170 X 20", thicknessMm: 20, qty: 1, unitAreaSqm: 1.88258, widthMm: 170.0, lengthM: 5.537 },
      { itemNo: "5", description: "FB 170 X 20", thicknessMm: 20, qty: 1, unitAreaSqm: 1.8003, widthMm: 170.0, lengthM: 5.295 },
      { itemNo: "6", description: "FB 170 X 20", thicknessMm: 20, qty: 1, unitAreaSqm: 1.6609, widthMm: 170.0, lengthM: 4.885 },
      { itemNo: "7", description: "FB 170 X 20", thicknessMm: 20, qty: 1, unitAreaSqm: 1.37972, widthMm: 170.0, lengthM: 4.058 },
      { itemNo: "8", description: "FB 170 X 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.8228, widthMm: 170.0, lengthM: 2.42 },
      { itemNo: "19", description: "FB 40 x 10", thicknessMm: 10, qty: 18, unitAreaSqm: 0.0144, widthMm: 40.0, lengthM: 0.18 },
      { itemNo: "20", description: "FB 40 x 10", thicknessMm: 10, qty: 2, unitAreaSqm: 0.0304, widthMm: 40.0, lengthM: 0.38 },
      { itemNo: "21", description: "FB 40 x 10", thicknessMm: 10, qty: 8, unitAreaSqm: 0.0784, widthMm: 40.0, lengthM: 0.98 },
    ],
  },
  {
    drawingNumber: "13333999",
    title: "Riser Ø5390 side plate",
    items: [
      { itemNo: "1", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 59.331728, widthMm: 4723.0, lengthM: 9.787 },
      { itemNo: "2", description: "FB 150 x 15", thicknessMm: 15, qty: 2, unitAreaSqm: 0.5304, widthMm: 150.0, lengthM: 1.768 },
      { itemNo: "3", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.2388, widthMm: 150.0, lengthM: 0.796 },
      { itemNo: "4", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.204, widthMm: 150.0, lengthM: 0.68 },
      { itemNo: "5", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.4062, widthMm: 150.0, lengthM: 1.354 },
      { itemNo: "6", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.1536, widthMm: 150.0, lengthM: 0.512 },
      { itemNo: "7", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.2595, widthMm: 150.0, lengthM: 0.865 },
      { itemNo: "8", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.1875, widthMm: 150.0, lengthM: 0.625 },
      { itemNo: "9", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 1.1295, widthMm: 150.0, lengthM: 3.765 },
      { itemNo: "10", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 1.3995, widthMm: 150.0, lengthM: 4.665 },
      { itemNo: "11", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 1.4328, widthMm: 150.0, lengthM: 4.776 },
      { itemNo: "12", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 1.4328, widthMm: 150.0, lengthM: 4.776 },
      { itemNo: "13", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 1.1865, widthMm: 150.0, lengthM: 3.955 },
      { itemNo: "14", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.9165, widthMm: 150.0, lengthM: 3.055 },
      { itemNo: "15", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.6465, widthMm: 150.0, lengthM: 2.155 },
      { itemNo: "16", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.3765, widthMm: 150.0, lengthM: 1.255 },
      { itemNo: "17", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.1065, widthMm: 150.0, lengthM: 0.355 },
      { itemNo: "18", description: "FB 150 x 15", thicknessMm: 15, qty: 22, unitAreaSqm: 0.2655, widthMm: 150.0, lengthM: 0.885 },
      { itemNo: "19", description: "FB 150 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 2.028, widthMm: 150.0, lengthM: 6.76 },
      { itemNo: "20", description: "FB 90 x 20", thicknessMm: 20, qty: 4, unitAreaSqm: 0.16596, widthMm: 90.0, lengthM: 0.922 },
      { itemNo: "21", description: "FB 90 x 20", thicknessMm: 20, qty: 5, unitAreaSqm: 0.15714, widthMm: 90.0, lengthM: 0.873 },
      { itemNo: "22", description: "FB 90 x 20", thicknessMm: 20, qty: 3, unitAreaSqm: 0.1584, widthMm: 90.0, lengthM: 0.88 },
      { itemNo: "23", description: "FB 90 x 20", thicknessMm: 20, qty: 2, unitAreaSqm: 0.162, widthMm: 90.0, lengthM: 0.9 },
      { itemNo: "24", description: "FB 115 x 10", thicknessMm: 10, qty: 28, unitAreaSqm: 0.04278, widthMm: 115.0, lengthM: 0.186 },
    ],
  },
  {
    drawingNumber: "13334006",
    title: "Riser Ø5390 side plate",
    items: [
      { itemNo: "1", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 60.657062, widthMm: 3883.0, lengthM: 9.786 },
      { itemNo: "2", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.73492, widthMm: 190.0, lengthM: 1.934 },
      { itemNo: "3", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 1.18636, widthMm: 190.0, lengthM: 3.122 },
      { itemNo: "4", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 1.63818, widthMm: 190.0, lengthM: 4.311 },
      { itemNo: "5", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 2.11128, widthMm: 190.0, lengthM: 5.556 },
      { itemNo: "6", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 2.20476, widthMm: 190.0, lengthM: 5.802 },
      { itemNo: "7", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 1.85668, widthMm: 190.0, lengthM: 4.886 },
      { itemNo: "8", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.2831, widthMm: 190.0, lengthM: 0.745 },
      { itemNo: "9", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.26676, widthMm: 190.0, lengthM: 0.702 },
      { itemNo: "10", description: "FB 190 x 20", thicknessMm: 20, qty: 5, unitAreaSqm: 0.34162, widthMm: 190.0, lengthM: 0.899 },
      { itemNo: "11", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.20292, widthMm: 190.0, lengthM: 0.534 },
      { itemNo: "12", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.29906, widthMm: 190.0, lengthM: 0.787 },
      { itemNo: "13", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 3.13424, widthMm: 190.0, lengthM: 8.248 },
      { itemNo: "14", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.31578, widthMm: 190.0, lengthM: 0.831 },
      { itemNo: "15", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.31084, widthMm: 190.0, lengthM: 0.818 },
      { itemNo: "16", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.54872, widthMm: 190.0, lengthM: 1.444 },
      { itemNo: "17", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.30704, widthMm: 190.0, lengthM: 0.808 },
      { itemNo: "18", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.77938, widthMm: 190.0, lengthM: 2.051 },
      { itemNo: "19", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.28918, widthMm: 190.0, lengthM: 0.761 },
      { itemNo: "20", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.38228, widthMm: 190.0, lengthM: 1.006 },
      { itemNo: "21", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.323, widthMm: 190.0, lengthM: 0.85 },
      { itemNo: "22", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.64828, widthMm: 190.0, lengthM: 1.706 },
      { itemNo: "23", description: "FB 190 x 20", thicknessMm: 20, qty: 1, unitAreaSqm: 0.64828, widthMm: 190.0, lengthM: 1.706 },
      { itemNo: "24", description: "FB 90 x 20", thicknessMm: 20, qty: 12, unitAreaSqm: 0.1602, widthMm: 90.0, lengthM: 0.89 },
      { itemNo: "25", description: "FB 90 x 20", thicknessMm: 20, qty: 2, unitAreaSqm: 0.162, widthMm: 90.0, lengthM: 0.9 },
      { itemNo: "26", description: "FB 115 x 10", thicknessMm: 10, qty: 28, unitAreaSqm: 0.04278, widthMm: 115.0, lengthM: 0.186 },
      { itemNo: "27", description: "FB 190 x 20", thicknessMm: 20, qty: 14, unitAreaSqm: 0.34466, widthMm: 190.0, lengthM: 0.907 },
    ],
  },
  {
    drawingNumber: "13334012",
    title: "Back bottom and transition plate",
    items: [
      { itemNo: "1", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 110.24274, widthMm: 9987.0, lengthM: 8.21 },
      { itemNo: "2.1.1", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 5.442158, widthMm: 2578.0, lengthM: 2.111 },
      { itemNo: "2.1.2", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 6.981224, widthMm: 2578.0, lengthM: 2.708 },
      { itemNo: "2.1.3", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 6.421978, widthMm: 3061.0, lengthM: 2.098 },
      { itemNo: "2.1.4", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 3.68846, widthMm: 1244.0, lengthM: 2.965 },
      { itemNo: "2.1.5", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 7.93434, widthMm: 2965.0, lengthM: 2.676 },
      { itemNo: "2.2", description: "FB 100 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.1622, widthMm: 100.0, lengthM: 1.622 },
      { itemNo: "2.3", description: "FB 100 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.0795, widthMm: 100.0, lengthM: 0.795 },
      { itemNo: "3.1", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 7.593232, widthMm: 2708.0, lengthM: 2.804 },
      { itemNo: "3.2", description: "FB 100 x 15", thicknessMm: 15, qty: 1, unitAreaSqm: 0.1706, widthMm: 100.0, lengthM: 1.706 },
      { itemNo: "4", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 0.984394, widthMm: 2974.0, lengthM: 0.331 },
      { itemNo: "5", description: "PL 6 mm", thicknessMm: 6, qty: 1, unitAreaSqm: 0.439845, widthMm: 1239.0, lengthM: 0.355 },
      { itemNo: "6", description: "FB 90 x 20", thicknessMm: 20, qty: 13, unitAreaSqm: 0.06345, widthMm: 90.0, lengthM: 0.705 },
      { itemNo: "7", description: "FB 115 x 10", thicknessMm: 10, qty: 26, unitAreaSqm: 0.02139, widthMm: 115.0, lengthM: 0.186 },
    ],
  },
];

export const GROUPS: Record<string, GroupSeed> = {
  "PL 20 MM": { thicknessMm: 20, usedAreaSqm: 37.813285, buyQty: 5, widthM: 1.5, lengthM: 6 },
  "PL 6 MM": { thicknessMm: 6, usedAreaSqm: 509.303511, buyQty: 57, widthM: 1.5, lengthM: 6 },
  "FB 80 X 10": { thicknessMm: 10, usedAreaSqm: 1.494016, buyQty: 3, widthM: 0.08, lengthM: 6 },
  "FB 90 X 20": { thicknessMm: 20, usedAreaSqm: 15.10479, buyQty: 15, widthM: 0.09, lengthM: 6 },
  "FB 120 X 12": { thicknessMm: 12, usedAreaSqm: 12.636743, buyQty: 9, widthM: 0.12, lengthM: 6 },
  "FB 115 X 10": { thicknessMm: 10, usedAreaSqm: 3.75774, buyQty: 4, widthM: 0.115, lengthM: 6 },
  "FB 170 X 20": { thicknessMm: 20, usedAreaSqm: 13.87064, buyQty: 7, widthM: 0.17, lengthM: 6 },
  "PL 8 MM": { thicknessMm: 8, usedAreaSqm: 62.64, buyQty: 7, widthM: 1.5, lengthM: 6 },
  "FB 40 X 10": { thicknessMm: 10, usedAreaSqm: 0.9472, buyQty: 2, widthM: 0.04, lengthM: 6 },
  "FB 150 X 15": { thicknessMm: 15, usedAreaSqm: 19.0065, buyQty: 11, widthM: 0.15, lengthM: 6 },
  "FB 190 X 20": { thicknessMm: 20, usedAreaSqm: 25.00438, buyQty: 11, widthM: 0.19, lengthM: 6 },
  "FB 100 X 15": { thicknessMm: 15, usedAreaSqm: 0.4123, buyQty: 1, widthM: 0.1, lengthM: 6 },
};
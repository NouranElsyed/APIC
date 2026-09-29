import { describe, expect, it } from "vitest";
import { parsePartsCsv, PARTS_CSV_TEMPLATE } from "./csv-parts";

describe("parsePartsCsv", () => {
  it("parses the template", () => {
    const r = parsePartsCsv(PARTS_CSV_TEMPLATE);
    expect(r.errors).toEqual([]);
    expect(r.pieces).toEqual([
      { name: "Column leg", profile: "IPE120", material: "S235", length: 2450, qty: 4 },
      { name: "Bracket", profile: "FB50x10", material: "S235", length: 600, qty: 12 },
    ]);
  });
  it("handles semicolons, BOM, decimal comma and aliases", () => {
    const r = parsePartsCsv("\uFEFFPart;Section;Length;Qty\nA;L40x4;1200,5;3\n");
    expect(r.pieces).toEqual([{ name: "A", profile: "L40x4", material: "", length: 1200.5, qty: 3 }]);
  });
  it("reports bad rows and missing columns", () => {
    expect(parsePartsCsv("name,qty\nA,1").errors.length).toBe(1);
    const r = parsePartsCsv("length,qty\n0,1\n100,x\n100,2");
    expect(r.pieces.length).toBe(1);
    expect(r.errors.length).toBe(2);
  });
});

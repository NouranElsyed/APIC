import { describe, expect, it } from "vitest";
import { parseTakeoffCsv, csvRowProblem, csvRowToPayload, TAKEOFF_CSV_TEMPLATE } from "./parts-csv";

describe("parseTakeoffCsv", () => {
  it("parses the template (hot rolled + pipe)", () => {
    const r = parseTakeoffCsv(TAKEOFF_CSV_TEMPLATE);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.description, x.partType, x.profile, x.length, x.qty])).toEqual([
      ["Column leg", "HOT_ROLLED", "IPE120", "2450", "4"],
      ["Bracket", "HOT_ROLLED", "FB50x10", "600", "12"],
      ["Pipe support", "PIPE", "", "1200", "2"],
    ]);
    expect(r.rows.every((x) => csvRowProblem(x) === null)).toBe(true);
    expect(r.rows[2].side).toBe("INTERNAL");
    expect(r.rows[2].paintSides).toBe("1");
  });
  it("defaults to hot rolled, uses the label as profile, semicolons and decimal comma", () => {
    const r = parseTakeoffCsv("\uFEFFpart;length;qty;kg/m\nIPE 300;12000,5;6;42,2\n");
    expect(r.rows[0]).toMatchObject({ partType: "HOT_ROLLED", profile: "IPE 300", length: "12000.5", weightPerMeter: "42.2" });
  });
  it("reports bad rows and rejects plates", () => {
    const r = parseTakeoffCsv("type,length,qty\nplate,100,1\nhr,0,1\nhr,100,x\n");
    expect(r.rows).toEqual([]);
    expect(r.errors.length).toBe(3);
  });
  it("flags missing kg/m or pipe data instead of saving garbage", () => {
    const r = parseTakeoffCsv("desc,type,length,qty\nA,hr,1000,1\nB,pipe,1000,1\n");
    expect(csvRowProblem(r.rows[0])).toMatch(/kg\/m/);
    expect(csvRowProblem(r.rows[1])).toMatch(/OD/);
  });
});

describe("csvRowToPayload", () => {
  it("converts mm to metres (length and pipe OD)", () => {
    const [hr, , pipe] = parseTakeoffCsv(TAKEOFF_CSV_TEMPLATE).rows;
    expect(csvRowToPayload(hr, "d1", 3, "mm")).toMatchObject({ partType: "HOT_ROLLED", itemNo: 3, geometry: { length: 2.45, weightPerMeter: 10.4 } });
    expect(csvRowToPayload(pipe, "d1", 5, "mm")).toMatchObject({ partType: "PIPE", thicknessMm: 6, geometry: { od: 0.1143, length: 1.2 } });
  });
});

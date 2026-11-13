import { describe, expect, it } from "vitest";
import { canTransition, isEditable, lineTotal, monthlyTrend, quotationNumber, summarize, totals, addDays, daysBetween } from "./quotation";
import { parseQuotationSheet } from "./sheet";

describe("totals", () => {
  it("splits supply and install and rounds lines to 2 decimals", () => {
    const t = totals([
      { qty: 24500, unitRate: 28.5, type: "SUPPLY" },
      { qty: 1, unitRate: 250000, type: "INSTALL" },
      { qty: 3, unitRate: 0.335, type: "SUPPLY" },
    ]);
    expect(t.supply).toBe(698251.01); // 698250 + 1.01 (1.005 rounds up)
    expect(t.install).toBe(250000);
    expect(t.grand).toBe(948251.01);
    expect(lineTotal({ qty: 4200, unitRate: 32 })).toBe(134400);
  });
  it("is zero for no items", () => expect(totals([])).toEqual({ supply: 0, install: 0, grand: 0 }));
});

describe("status flow", () => {
  it("allows the normal path and blocks shortcuts", () => {
    expect(canTransition("DRAFT", "PENDING")).toBe(true);
    expect(canTransition("DRAFT", "APPROVED")).toBe(false);
    expect(canTransition("UNDER_REVIEW", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "DRAFT")).toBe(false);
    expect(canTransition("REJECTED", "PENDING")).toBe(false);
  });
  it("locks approved and rejected quotations", () => {
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("UNDER_REVIEW")).toBe(true);
    expect(isEditable("APPROVED")).toBe(false);
    expect(isEditable("REJECTED")).toBe(false);
  });
});

describe("summary + trend", () => {
  const list = [
    { status: "APPROVED" as const, total: 100, issueDate: "2026-11-15" },
    { status: "PENDING" as const, total: 50, issueDate: "2026-11-10" },
    { status: "UNDER_REVIEW" as const, total: 25, issueDate: "2026-10-28" },
    { status: "REJECTED" as const, total: 10, issueDate: "2026-06-01" },
    { status: "DRAFT" as const, total: 5, issueDate: "2026-01-01" },
  ];
  it("counts pending as pending + under review", () => {
    const s = summarize(list);
    expect(s).toMatchObject({ total: 5, approved: 1, pending: 2, rejected: 1, drafts: 1, pctApproved: 20, pctPending: 40, approvedValue: 100, totalValue: 190 });
  });
  it("handles an empty list", () => expect(summarize([]).pctApproved).toBe(0));
  it("buckets the last 6 months and ignores older ones", () => {
    const t = monthlyTrend(list, "2026-11-12");
    expect(t.map((x) => x.label)).toEqual(["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
    expect(t.find((x) => x.label === "Nov")!.value).toBe(150);
    expect(t.find((x) => x.label === "Oct")!.value).toBe(25);
    expect(t.find((x) => x.label === "Jun")!.value).toBe(10);
    expect(t.reduce((s, x) => s + x.value, 0)).toBe(185); // the Jan draft is outside the window
  });
  it("crosses a year boundary", () => expect(monthlyTrend([], "2026-02-10", 4).map((x) => x.key)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]));
});

describe("dates + numbers", () => {
  it("adds days and measures validity", () => {
    expect(addDays("2026-11-15", 30)).toBe("2026-12-15");
    expect(daysBetween("2026-11-15", "2026-12-15")).toBe(30);
  });
  it("formats the quotation number", () => expect(quotationNumber(1, 2026)).toBe("QTN-001-2026"));
});

describe("BOQ sheet parser", () => {
  it("reads rows under the header, skips totals and blank rows, maps types", () => {
    const r = parseQuotationSheet([
      ["BOQ"],
      ["#", "Item Description", "Material", "Qty", "Unit", "Unit Rate (EGP)", "Type"],
      [1, "Riser Duct Plate 6 mm", "ST37", "24,500", "kg", 28.5, "Supply"],
      [2, "Erection", "", 1, "Lot", 250000, "Dismantle & Install"],
      [],
      ["", "Subtotal", "", "", "", 999],
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.items).toEqual([
      { description: "Riser Duct Plate 6 mm", material: "ST37", qty: 24500, unit: "kg", unitRate: 28.5, type: "SUPPLY" },
      { description: "Erection", material: null, qty: 1, unit: "Lot", unitRate: 250000, type: "INSTALL" },
    ]);
  });
  it("warns on bad numbers and a missing header", () => {
    expect(parseQuotationSheet([["x"]]).warnings[0]).toMatch(/header/i);
    const r = parseQuotationSheet([["Description", "Qty", "Rate"], ["Plate", "abc", 5], ["Bar", 2, 3]]);
    expect(r.items).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/Plate/);
  });
});

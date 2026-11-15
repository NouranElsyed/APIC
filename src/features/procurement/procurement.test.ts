import { describe, expect, it } from "vitest";
import { applyStockDelta, docNumber, nextSequence, poState, poTotal, receiptLimit, remainingToOrder, stockKey, stockWeightKg, validatePoLines, validateReceipt } from "./procurement";

describe("numbering", () => {
  it("formats and continues from the highest number of the year", () => {
    expect(docNumber("PO", 2026, 7)).toBe("PO-2026-0007");
    expect(nextSequence([], "PO", 2026)).toBe(1);
    expect(nextSequence(["PO-2026-0001", "PO-2026-0009", "PO-2025-0040", "GR-2026-0050", "junk"], "PO", 2026)).toBe(10);
  });
});

describe("remainingToOrder", () => {
  it("subtracts what was ordered and never goes negative", () => {
    expect(remainingToOrder(100, [{ orderedQty: 30 }, { orderedQty: 20 }])).toBe(50);
    expect(remainingToOrder(100, [{ orderedQty: 120 }])).toBe(0);
  });
});

describe("validatePoLines", () => {
  const known = new Set(["a", "b"]);
  it("accepts good lines", () => expect(validatePoLines([{ materialId: "a", qty: 5, unitPrice: 10 }, { materialId: "b", qty: 1 }], known)).toBeNull());
  it("rejects empty, unknown, duplicate, zero and negative", () => {
    expect(validatePoLines([], known)).toMatch(/at least one/);
    expect(validatePoLines([{ materialId: "x", qty: 1 }], known)).toMatch(/not in this project/);
    expect(validatePoLines([{ materialId: "a", qty: 1 }, { materialId: "a", qty: 2 }], known)).toMatch(/twice/);
    expect(validatePoLines([{ materialId: "a", qty: 0 }], known)).toMatch(/greater than zero/);
    expect(validatePoLines([{ materialId: "a", qty: 1, unitPrice: -1 }], known)).toMatch(/negative/);
  });
});

describe("poTotal", () => {
  it("ignores lines without a price", () => expect(poTotal([{ orderedQty: 10, unitPrice: 2.5 }, { orderedQty: 4, unitPrice: null }])).toBe(25));
});

describe("poState", () => {
  it("derives the state from the lines", () => {
    expect(poState([{ orderedQty: 10, receivedQty: 0 }])).toBe("NOT_RECEIVED");
    expect(poState([{ orderedQty: 10, receivedQty: 4 }, { orderedQty: 10, receivedQty: 10 }])).toBe("PARTIAL");
    expect(poState([{ orderedQty: 10, receivedQty: 10 }, { orderedQty: 5, receivedQty: 6 }])).toBe("RECEIVED");
    expect(poState([{ orderedQty: 10, receivedQty: 10 }], true)).toBe("CANCELLED");
  });
});

describe("receiving", () => {
  const orders = new Map([["o1", { orderedQty: 100, receivedQty: 40 }], ["o2", { orderedQty: 10, receivedQty: 0 }]]);
  it("allows 10% over what was ordered", () => {
    expect(receiptLimit(100, 40)).toBe(70);
    expect(validateReceipt([{ orderId: "o1", qty: 70 }], orders)).toBeNull();
    expect(validateReceipt([{ orderId: "o1", qty: 71 }], orders)).toMatch(/More than ordered/);
  });
  it("adds several lines of the same order before checking the limit", () => {
    expect(validateReceipt([{ orderId: "o1", qty: 40 }, { orderId: "o1", qty: 40 }], orders)).toMatch(/More than ordered/);
  });
  it("a rejected line does not count towards the limit", () => {
    expect(validateReceipt([{ orderId: "o1", qty: 500, accepted: false }], orders)).toBeNull();
  });
  it("rejects empty, foreign and non-positive lines", () => {
    expect(validateReceipt([], orders)).toMatch(/at least one/);
    expect(validateReceipt([{ orderId: "zz", qty: 1 }], orders)).toMatch(/does not belong/);
    expect(validateReceipt([{ orderId: "o2", qty: 0 }], orders)).toMatch(/greater than zero/);
  });
});

describe("stock", () => {
  it("treats a rectangle the same either way round and ignores case", () => {
    const a = { kind: "REMNANT", material: "st37", thicknessMm: 10, widthMm: 1200, heightMm: 600, location: " rack A" };
    expect(stockKey(a)).toBe(stockKey({ ...a, material: "ST37", widthMm: 600, heightMm: 1200, location: "RACK A" }));
    expect(stockKey(a)).not.toBe(stockKey({ ...a, thicknessMm: 12 }));
    expect(stockKey(a)).not.toBe(stockKey({ ...a, kind: "SHEET" }));
  });
  it("applies deltas and refuses to go below zero", () => {
    expect(applyStockDelta(5, 3)).toBe(8);
    expect(applyStockDelta(5, -5)).toBe(0);
    expect(() => applyStockDelta(2, -3)).toThrow(/Only 2/);
    expect(() => applyStockDelta(2, 0)).toThrow();
    expect(() => applyStockDelta(2, 1.5)).toThrow();
  });
  it("weighs a sheet", () => expect(stockWeightKg({ thicknessMm: 10, widthMm: 3000, heightMm: 1500 })).toBe(353.25));
});

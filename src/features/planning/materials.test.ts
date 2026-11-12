import { describe, expect, it } from "vitest";
import { byPhase, bySupplier, deriveMaterial, summarize, type MaterialIn, type OrderIn } from "./materials";

const TODAY = "2026-11-12";
const order = (o: Partial<OrderIn> = {}): OrderIn => ({ id: "o" + Math.random(), supplier: "Ezz Steel", poNumber: "PO-1", orderedQty: 100, unitPrice: 30, orderDate: "2026-11-01", expectedDate: "2026-11-30", receivedQty: 0, receivedDate: null, notes: null, ...o });
const mat = (m: Partial<MaterialIn> = {}): MaterialIn => ({ id: "m" + Math.random(), code: null, description: "Plate 6mm", spec: "ST37", unit: "kg", requiredQty: 100, neededBy: "2026-12-20", neededBySource: "manual", wbsId: "w1", phase: "Fabrication", activityId: null, activityCode: null, notes: null, orders: [], ...m });

describe("material status", () => {
  it("not ordered", () => {
    const d = deriveMaterial(mat(), TODAY);
    expect(d).toMatchObject({ status: "NOT_ORDERED", toOrder: 100, orderedQty: 0, percentReceived: 0, urgent: false });
  });
  it("ordered, then partial, then delivered", () => {
    expect(deriveMaterial(mat({ orders: [order()] }), TODAY).status).toBe("ORDERED");
    const partial = deriveMaterial(mat({ orders: [order({ receivedQty: 40 })] }), TODAY);
    expect(partial).toMatchObject({ status: "PARTIAL", percentReceived: 40, inTransit: 60, toOrder: 0 });
    expect(deriveMaterial(mat({ orders: [order({ receivedQty: 100 })] }), TODAY).status).toBe("DELIVERED");
  });
  it("sums several orders (two suppliers)", () => {
    const d = deriveMaterial(mat({ requiredQty: 150, orders: [order({ orderedQty: 100, receivedQty: 100 }), order({ supplier: "Beni Suef Steel", orderedQty: 50, unitPrice: null })] }), TODAY);
    expect(d).toMatchObject({ orderedQty: 150, receivedQty: 100, status: "PARTIAL", toOrder: 0 });
    expect(d.suppliers).toEqual(["Ezz Steel", "Beni Suef Steel"]);
    expect(d.orderedValue).toBe(3000);
  });
  it("late when an expected date has passed with goods outstanding", () => {
    const d = deriveMaterial(mat({ orders: [order({ expectedDate: "2026-11-05", receivedQty: 20 })] }), TODAY);
    expect(d.status).toBe("LATE");
    expect(d.orders[0].late).toBe(true);
    // a fully received order past its date is not late
    expect(deriveMaterial(mat({ orders: [order({ expectedDate: "2026-11-05", receivedQty: 100 })] }), TODAY).status).toBe("DELIVERED");
  });
  it("flags urgent when not fully ordered and needed within 14 days or overdue", () => {
    expect(deriveMaterial(mat({ neededBy: "2026-11-20" }), TODAY)).toMatchObject({ urgent: true, daysToNeeded: 8 });
    expect(deriveMaterial(mat({ neededBy: "2026-11-01" }), TODAY)).toMatchObject({ urgent: true, daysToNeeded: -11 });
    expect(deriveMaterial(mat({ neededBy: "2026-11-20", orders: [order()] }), TODAY).urgent).toBe(false); // fully ordered
    expect(deriveMaterial(mat({ neededBy: "2027-02-01" }), TODAY).urgent).toBe(false);
  });
  it("over-delivery counts as delivered and caps at 100%", () => {
    const d = deriveMaterial(mat({ orders: [order({ orderedQty: 120, receivedQty: 120 })] }), TODAY);
    expect(d).toMatchObject({ status: "DELIVERED", percentReceived: 100, toOrder: 0 });
  });
});

describe("summaries", () => {
  const items = [
    deriveMaterial(mat({ phase: "Engineering" }), TODAY),
    deriveMaterial(mat({ phase: "Fabrication", orders: [order({ receivedQty: 100 })] }), TODAY),
    deriveMaterial(mat({ phase: "Fabrication", neededBy: "2026-11-15", orders: [order({ expectedDate: "2026-11-02" })] }), TODAY),
  ];
  it("counts statuses, delivery progress and the next due item", () => {
    const s = summarize(items);
    expect(s.total).toBe(3);
    expect(s.byStatus).toMatchObject({ NOT_ORDERED: 1, DELIVERED: 1, LATE: 1 });
    expect(s.percentDelivered).toBeCloseTo(33.3, 1);
    expect(s.nextDue?.daysToNeeded).toBe(3);
  });
  it("groups by phase and supplier", () => {
    expect(byPhase(items).find((p) => p.phase === "Fabrication")).toMatchObject({ total: 2, delivered: 1, late: 1 });
    expect(bySupplier(items)).toEqual([{ supplier: "Ezz Steel", orders: 2, items: 2, value: 6000, late: 1, pendingQtyOrders: 1 }]);
  });
});

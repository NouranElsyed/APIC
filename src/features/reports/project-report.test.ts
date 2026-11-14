import { describe, expect, it } from "vitest";
import { costBreakdown, delayText, earnedValue, monthlySpi, scheduleStatus } from "./project-report";
import { isoToDay } from "@/features/planning/calendar";

describe("scheduleStatus", () => {
  it("is Delayed when behind the baseline", () => expect(scheduleStatus({ delayDays: 7, spi: 1.1, hasBaseline: true }).label).toBe("Delayed"));
  it("ignores delay without a baseline", () => expect(scheduleStatus({ delayDays: 7, spi: 1, hasBaseline: false }).label).toBe("On Track"));
  it("uses SPI thresholds", () => {
    expect(scheduleStatus({ delayDays: 0, spi: 0.85, hasBaseline: true }).label).toBe("Delayed");
    expect(scheduleStatus({ delayDays: 0, spi: 0.95, hasBaseline: true }).label).toBe("At Risk");
    expect(scheduleStatus({ delayDays: 0, spi: 1.02, hasBaseline: true }).label).toBe("On Track");
  });
  it("handles a missing schedule", () => expect(scheduleStatus(null).label).toBe("No schedule"));
});

describe("delayText", () => {
  it("formats delay", () => expect(delayText({ delayDays: 7, hasBaseline: true }).value).toBe("+7 Days"));
  it("asks for a baseline", () => expect(delayText({ delayDays: 0, hasBaseline: false }).value).toBe("—"));
});

describe("costBreakdown", () => {
  const r = (status: string, total: number, supply: number, install: number) => ({ status: status as never, currency: "EGP", total, supply, install });
  it("prefers approved quotations", () => {
    const c = costBreakdown([r("APPROVED", 100, 60, 40), r("DRAFT", 50, 50, 0)]);
    expect(c).toMatchObject({ basis: "approved", total: 100, supply: 60, install: 40, quotations: 1 });
  });
  it("falls back to non-rejected quotations", () => expect(costBreakdown([r("DRAFT", 50, 50, 0), r("REJECTED", 90, 90, 0)])).toMatchObject({ basis: "quoted", total: 50 }));
  it("reports none", () => expect(costBreakdown([r("REJECTED", 90, 90, 0)]).basis).toBe("none"));
});

describe("earnedValue", () => {
  it("is budget times progress", () => expect(earnedValue(12_500_000, 70)).toBe(8_750_000));
  it("clamps progress", () => expect(earnedValue(100, 140)).toBe(100));
});

describe("monthlySpi", () => {
  it("computes actual ÷ planned at past month starts", () => {
    const d = (iso: string) => isoToDay(iso);
    const s = {
      dataDay: d("2026-11-10"),
      points: [
        { day: d("2026-09-14"), plan: 0, baseline: null },
        { day: d("2026-10-01"), plan: 20, baseline: null },
        { day: d("2026-11-01"), plan: 40, baseline: null },
        { day: d("2026-11-10"), plan: 44, baseline: null },
        { day: d("2027-12-01"), plan: 100, baseline: null },
      ],
      actual: [{ day: d("2026-09-14"), value: 0 }, { day: d("2026-11-10"), value: 36 }],
    };
    const out = monthlySpi(s, false);
    expect(out.map((p) => p.label)).toEqual(["Oct", "Nov"]);
    expect(out[0].planned).toBe(20);
    expect(out[1].spi).toBeGreaterThan(0.5);
    expect(out[1].spi).toBeLessThan(1);
  });
  it("returns nothing for an empty curve", () => expect(monthlySpi({ points: [], actual: [], dataDay: 0 }, false)).toEqual([]));
});

import { describe, expect, it } from "vitest";
import { classify, parseNestCode, statusOf } from "./requirements";

describe("requirements", () => {
  it("classifies material types", () => {
    expect(classify("Steel plate 8 mm")).toBe("Plate");
    expect(classify("Ø 88.9 × 5 mm pipe")).toBe("Pipe");
    expect(classify("IPE 300")).toBe("Profile");
    expect(classify("FB 100 x 10")).toBe("Flat");
  });
  it("reads nest codes", () => {
    expect(parseNestCode("NEST-8-ST37-6000x2000")).toEqual({ thicknessMm: 8, grade: "ST37", widthMm: 6000, heightMm: 2000 });
    expect(parseNestCode("NEST-8-ANY-6000x2000")?.grade).toBeNull();
    expect(parseNestCode("X-1")).toBeNull();
  });
  it("derives status", () => {
    expect(statusOf(0, 5, 0, 0)).toBe("AVAILABLE");
    expect(statusOf(5, 0, 0, 0)).toBe("TO_ORDER");
    expect(statusOf(5, 3, 0, 0)).toBe("SHORTAGE");
    expect(statusOf(5, 3, 5, 0)).toBe("ORDERED");
  });
});

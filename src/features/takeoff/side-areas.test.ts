import { describe, expect, it } from "vitest";
import { sideAreas } from "./side-areas";

describe("sideAreas", () => {
  it("an internal part counts both faces as internal, an external part both faces as external", () => {
    const r = sideAreas([{ side: "INTERNAL", totalArea: 3 }, { side: "EXTERNAL", totalArea: 5 }]);
    expect(r).toEqual({ internalSqm: 6, externalSqm: 10 });
  });
  it("a part on BOTH sides adds its face area once to each", () => {
    expect(sideAreas([{ side: "BOTH", totalArea: 4 }])).toEqual({ internalSqm: 4, externalSqm: 4 });
  });
  it("a rolled section (no sheet area) uses half of its paint area as the face", () => {
    expect(sideAreas([{ side: "EXTERNAL", totalArea: 0, paintAreaSqm: 6 }])).toEqual({ internalSqm: 0, externalSqm: 6 });
  });
  it("ignores missing numbers", () => {
    expect(sideAreas([{ side: "BOTH", totalArea: null }])).toEqual({ internalSqm: 0, externalSqm: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { SECTIONS, TABS } from "./docs-content";

describe("docs content", () => {
  it("has unique section ids and only known tabs", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tabs = new Set(TABS.map((t) => t.id));
    for (const s of SECTIONS) expect(tabs.has(s.tab)).toBe(true);
  });

  it("covers every tab and every section has content", () => {
    for (const t of TABS) expect(SECTIONS.some((s) => s.tab === t.id)).toBe(true);
    for (const s of SECTIONS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.blocks.length).toBeGreaterThan(0);
    }
  });

  it("table rows match their header width", () => {
    for (const s of SECTIONS)
      for (const b of s.blocks)
        if (b.t === "table") for (const r of b.rows) expect(r.length, `${s.id}: ${r[0]}`).toBe(b.head.length);
  });
});

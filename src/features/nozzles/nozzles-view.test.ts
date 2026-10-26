import * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NozzlesView } from "./nozzles-view";

describe("NozzlesView", () => {
  const html = renderToString(React.createElement(NozzlesView));

  it("starts with a DN250 nozzle and a DN600 manhole, with the catalogue weights", () => {
    expect(html).toContain("49.27"); // DN250: 12.06 + 24.00 (class 150 WN) + 13.20
    expect(html).toContain("87.56"); // DN600 shell manhole: neck + pad
    expect(html).toContain("plate"); // the manhole flange is made from plate
  });

  it("lists the flat parts for nesting, including the manhole ring and cover", () => {
    expect(html).toContain("Flat parts to cut");
    expect(html).toContain("Reinforcing pad DN250");
    expect(html).toContain("Manhole flange ring");
    expect(html).toContain("Manhole cover");
  });

  it("totals: 49.27 + 87.56 = 136.82 kg", () => {
    expect(html).toContain("136.82");
  });
});

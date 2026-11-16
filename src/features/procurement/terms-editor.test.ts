import { describe, expect, it } from "vitest";
import { joinTerms, parseTerms, splitPasted } from "./terms-editor";

describe("terms editor helpers", () => {
  it("splits a pasted bullet list into separate terms", () => {
    const pasted = "* 50% advance payment, 50% on delivery\n* Payment within 30 days from the invoice date\n• Prices are in EGP and exclude VAT\n1. Delivery within 14 days\n- Bank transfer";
    expect(splitPasted(pasted)).toEqual(["50% advance payment, 50% on delivery", "Payment within 30 days from the invoice date", "Prices are in EGP and exclude VAT", "Delivery within 14 days", "Bank transfer"]);
  });
  it("keeps a percentage at the start of a term", () => {
    expect(splitPasted("50% advance\n30% later")).toEqual(["50% advance", "30% later"]);
  });
  it("round-trips terms", () => {
    expect(parseTerms(joinTerms(["a", " ", "b"]))).toEqual(["a", "b"]);
    expect(joinTerms([" "])).toBeNull();
  });
});

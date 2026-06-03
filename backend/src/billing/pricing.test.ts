import { describe, expect, it } from "vitest";

import { calculateTieredInvoice, microsToCentsHalfUp } from "./pricing.js";

describe("microsToCentsHalfUp", () => {
  it("rounds micro-dollar totals to cents with half-up policy", () => {
    expect(microsToCentsHalfUp(4_999)).toBe(0);
    expect(microsToCentsHalfUp(5_000)).toBe(1);
    expect(microsToCentsHalfUp(14_999)).toBe(1);
    expect(microsToCentsHalfUp(15_000)).toBe(2);
  });
});

describe("calculateTieredInvoice", () => {
  it("calculates tiered usage charges", () => {
    const invoice = calculateTieredInvoice(120_000, [
      { minUnits: 0, maxUnits: 10_000, unitPriceMicros: 0 },
      { minUnits: 10_000, maxUnits: 100_000, unitPriceMicros: 1_000 },
      { minUnits: 100_000, maxUnits: null, unitPriceMicros: 500 },
    ]);

    expect(invoice).toEqual({
      totalUnits: 120_000,
      subtotalCents: 10_000,
      lineItems: [
        {
          description: "Usage units 1-10000",
          units: 10_000,
          unitPriceMicros: 0,
          amountCents: 0,
        },
        {
          description: "Usage units 10001-100000",
          units: 90_000,
          unitPriceMicros: 1_000,
          amountCents: 9_000,
        },
        {
          description: "Usage units 100001-above",
          units: 20_000,
          unitPriceMicros: 500,
          amountCents: 1_000,
        },
      ],
    });
  });
});

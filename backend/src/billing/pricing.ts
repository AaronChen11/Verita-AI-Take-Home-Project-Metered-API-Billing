export type PriceTier = {
  minUnits: number;
  maxUnits: number | null;
  unitPriceMicros: number;
};

export type InvoiceLineCalculation = {
  description: string;
  units: number;
  unitPriceMicros: number;
  amountCents: number;
};

export type InvoiceCalculation = {
  totalUnits: number;
  subtotalCents: number;
  lineItems: InvoiceLineCalculation[];
};

const MICRO_DOLLARS_PER_CENT = 10_000;

export function calculateTieredInvoice(totalUnits: number, tiers: readonly PriceTier[]): InvoiceCalculation {
  const sortedTiers = [...tiers].sort((left, right) => left.minUnits - right.minUnits);
  const lineItems = sortedTiers.flatMap((tier) => {
    const tierUnits = calculateTierUnits(totalUnits, tier);

    if (tierUnits <= 0) {
      return [];
    }

    return [
      {
        description: describeTier(tier),
        units: tierUnits,
        unitPriceMicros: tier.unitPriceMicros,
        amountCents: microsToCentsHalfUp(tierUnits * tier.unitPriceMicros),
      },
    ];
  });

  return {
    totalUnits,
    subtotalCents: lineItems.reduce((sum, lineItem) => sum + lineItem.amountCents, 0),
    lineItems,
  };
}

export function microsToCentsHalfUp(micros: number) {
  return Math.floor((micros + MICRO_DOLLARS_PER_CENT / 2) / MICRO_DOLLARS_PER_CENT);
}

function calculateTierUnits(totalUnits: number, tier: PriceTier) {
  if (totalUnits <= tier.minUnits) {
    return 0;
  }

  const tierUpperBound = tier.maxUnits ?? totalUnits;

  return Math.max(0, Math.min(totalUnits, tierUpperBound) - tier.minUnits);
}

function describeTier(tier: PriceTier) {
  const start = tier.minUnits + 1;
  const end = tier.maxUnits ?? "above";

  return `Usage units ${start}-${end}`;
}

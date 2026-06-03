import { calculateTieredInvoice } from "../billing/pricing.js";
import type { AdvisoryLockRunner } from "../db/advisoryLock.js";
import type { BillingPeriod, InvoiceGenerationRepository } from "../repositories/invoices.js";

export const GENERATE_INVOICES_LOCK_KEY = 1002;

export type GenerateInvoicesDependencies = {
  locks: AdvisoryLockRunner;
  invoices: InvoiceGenerationRepository;
};

export type GenerateInvoicesResult = {
  status: "succeeded" | "skipped";
  period: BillingPeriod;
  invoicesCreated: number;
  invoicesSkipped: number;
};

export async function generateInvoicesForPeriod(
  dependencies: GenerateInvoicesDependencies,
  period: BillingPeriod,
): Promise<GenerateInvoicesResult> {
  const result = await dependencies.locks.withLock(GENERATE_INVOICES_LOCK_KEY, async () => {
    const customers = await dependencies.invoices.listCustomerUsageForPeriod(period);
    let invoicesCreated = 0;
    let invoicesSkipped = 0;

    for (const customer of customers) {
      const calculation = calculateTieredInvoice(customer.totalUnits, customer.tiers);
      const invoice = await dependencies.invoices.createDraftInvoiceIfNotExists({
        customerId: customer.customerId,
        period,
        subtotalCents: calculation.subtotalCents,
        lineItems: calculation.lineItems,
      });

      if (invoice.created) {
        invoicesCreated += 1;
      } else {
        invoicesSkipped += 1;
      }
    }

    return {
      status: "succeeded" as const,
      period,
      invoicesCreated,
      invoicesSkipped,
    };
  });

  return (
    result ?? {
      status: "skipped",
      period,
      invoicesCreated: 0,
      invoicesSkipped: 0,
    }
  );
}

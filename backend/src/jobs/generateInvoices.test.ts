import { describe, expect, it } from "vitest";

import { GENERATE_INVOICES_LOCK_KEY, generateInvoicesForPeriod } from "./generateInvoices.js";
import type { AdvisoryLockRunner } from "../db/advisoryLock.js";
import type { InvoiceCreateInput, InvoiceGenerationRepository } from "../repositories/invoices.js";

const period = { start: "2026-06-01", end: "2026-07-01" };

describe("generateInvoicesForPeriod", () => {
  it("generates draft invoices under an advisory lock", async () => {
    const lockKeys: number[] = [];
    const createdInputs: InvoiceCreateInput[] = [];
    const locks: AdvisoryLockRunner = {
      async withLock(lockKey, work) {
        lockKeys.push(lockKey);
        return work();
      },
    };
    const invoices: InvoiceGenerationRepository = {
      async listCustomerUsageForPeriod() {
        return [
          {
            customerId: "customer_1",
            totalUnits: 120_000,
            tiers: [
              { minUnits: 0, maxUnits: 10_000, unitPriceMicros: 0 },
              { minUnits: 10_000, maxUnits: 100_000, unitPriceMicros: 1_000 },
              { minUnits: 100_000, maxUnits: null, unitPriceMicros: 500 },
            ],
          },
        ];
      },
      async createDraftInvoiceIfNotExists(input) {
        createdInputs.push(input);
        return { created: true, invoiceId: "invoice_1" };
      },
    };

    const result = await generateInvoicesForPeriod({ locks, invoices }, period);

    expect(lockKeys).toEqual([GENERATE_INVOICES_LOCK_KEY]);
    expect(result).toEqual({
      status: "succeeded",
      period,
      invoicesCreated: 1,
      invoicesSkipped: 0,
    });
    expect(createdInputs[0]).toMatchObject({
      customerId: "customer_1",
      period,
      subtotalCents: 10_000,
    });
    expect(createdInputs[0]?.lineItems).toHaveLength(3);
  });

  it("counts existing invoices as skipped for idempotent reruns", async () => {
    const locks: AdvisoryLockRunner = {
      async withLock(_lockKey, work) {
        return work();
      },
    };
    const invoices: InvoiceGenerationRepository = {
      async listCustomerUsageForPeriod() {
        return [
          {
            customerId: "customer_1",
            totalUnits: 1,
            tiers: [{ minUnits: 0, maxUnits: null, unitPriceMicros: 0 }],
          },
        ];
      },
      async createDraftInvoiceIfNotExists() {
        return { created: false };
      },
    };

    await expect(generateInvoicesForPeriod({ locks, invoices }, period)).resolves.toEqual({
      status: "succeeded",
      period,
      invoicesCreated: 0,
      invoicesSkipped: 1,
    });
  });

  it("skips safely when the invoice lock is already held", async () => {
    const locks: AdvisoryLockRunner = {
      async withLock() {
        return undefined;
      },
    };
    const invoices: InvoiceGenerationRepository = {
      async listCustomerUsageForPeriod() {
        throw new Error("list should not run");
      },
      async createDraftInvoiceIfNotExists() {
        throw new Error("create should not run");
      },
    };

    await expect(generateInvoicesForPeriod({ locks, invoices }, period)).resolves.toEqual({
      status: "skipped",
      period,
      invoicesCreated: 0,
      invoicesSkipped: 0,
    });
  });
});

import { describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";

import {
  OverrideInvoiceNotFoundError,
  OverrideLineItemNotFoundError,
  OverridePaidInvoiceError,
  PostgresLineItemOverrideRepository,
} from "./lineItemOverrides.js";

type FakeClient = PoolClient & { released: boolean };

const invoiceId = "00000000-0000-4000-8000-000000000010";
const lineItemId = "00000000-0000-4000-8000-000000000011";

describe("PostgresLineItemOverrideRepository", () => {
  it("overrides a line item, recalculates invoice totals, and writes an audit log transactionally", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [
      { rows: [] },
      { rows: [invoiceRow({ status: "issued", subtotal_cents: 10_000, total_cents: 9_500 })] },
      { rows: [lineItemRow({ amount_cents: 10_000, is_overridden: false })] },
      { rows: [lineItemRow({ amount_cents: 8_000, is_overridden: true })] },
      { rows: [invoiceRow({ status: "issued", subtotal_cents: 8_000, total_cents: 7_500 })] },
      { rows: [] },
      { rows: [] },
    ]);
    const repository = new PostgresLineItemOverrideRepository(createPool(client));

    await expect(repository.overrideLineItem(input())).resolves.toEqual({
      lineItem: {
        id: lineItemId,
        amountCents: 8_000,
        isOverridden: true,
      },
      invoice: {
        id: invoiceId,
        status: "issued",
        subtotalCents: 8_000,
        creditsCents: 500,
        totalCents: 7_500,
      },
    });

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "SELECT",
      "SELECT",
      "UPDATE",
      "WITH",
      "INSERT",
      "COMMIT",
    ]);
    expect(queries[1]?.text).toContain("FOR UPDATE");
    expect(queries[2]?.text).toContain("FOR UPDATE");
    expect(queries[3]?.text).toContain("is_overridden = true");
    expect(queries[4]?.text).toContain("GREATEST(line_item_totals.subtotal_cents - credits_cents, 0)");
    expect(queries[5]?.text).toContain("INSERT INTO audit_logs");
    expect(client.released).toBe(true);
  });

  it("rejects paid invoice overrides before mutating line items", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [
      { rows: [] },
      { rows: [invoiceRow({ status: "paid", subtotal_cents: 10_000, total_cents: 9_500 })] },
      { rows: [] },
    ]);
    const repository = new PostgresLineItemOverrideRepository(createPool(client));

    await expect(repository.overrideLineItem(input())).rejects.toBeInstanceOf(OverridePaidInvoiceError);

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual(["BEGIN", "SELECT", "ROLLBACK"]);
    expect(client.released).toBe(true);
  });

  it("rejects void invoice overrides before mutating line items", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [
      { rows: [] },
      { rows: [invoiceRow({ status: "void", subtotal_cents: 10_000, total_cents: 9_500 })] },
      { rows: [] },
    ]);
    const repository = new PostgresLineItemOverrideRepository(createPool(client));

    await expect(repository.overrideLineItem(input())).rejects.toBeInstanceOf(OverrideInvoiceNotFoundError);

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual(["BEGIN", "SELECT", "ROLLBACK"]);
    expect(client.released).toBe(true);
  });

  it("rolls back when the line item is not on the invoice", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [
      { rows: [] },
      { rows: [invoiceRow({ status: "draft", subtotal_cents: 10_000, total_cents: 9_500 })] },
      { rows: [] },
      { rows: [] },
    ]);
    const repository = new PostgresLineItemOverrideRepository(createPool(client));

    await expect(repository.overrideLineItem(input())).rejects.toBeInstanceOf(OverrideLineItemNotFoundError);

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual(["BEGIN", "SELECT", "SELECT", "ROLLBACK"]);
    expect(client.released).toBe(true);
  });
});

function input() {
  return {
    invoiceId,
    lineItemId,
    amountCents: 8_000,
    reason: "Contract correction",
    actor: "ops@example.com",
  };
}

function invoiceRow(
  overrides: Partial<{ status: string; subtotal_cents: number; credits_cents: number; total_cents: number }> = {},
) {
  return {
    id: invoiceId,
    status: overrides.status ?? "issued",
    subtotal_cents: overrides.subtotal_cents ?? 10_000,
    credits_cents: overrides.credits_cents ?? 500,
    total_cents: overrides.total_cents ?? 9_500,
  };
}

function lineItemRow(overrides: Partial<{ amount_cents: number; is_overridden: boolean }> = {}) {
  return {
    id: lineItemId,
    amount_cents: overrides.amount_cents ?? 10_000,
    is_overridden: overrides.is_overridden ?? false,
  };
}

function createPool(client: PoolClient) {
  return {
    async connect() {
      return client;
    },
  } as unknown as Pool;
}

function createClient(queries: Array<{ text: string; values?: unknown[] }>, results: Array<{ rows: unknown[] }>) {
  const client = {
    released: false,
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return results.shift() ?? { rows: [] };
    },
    release() {
      client.released = true;
    },
  } as unknown as FakeClient;

  return client;
}

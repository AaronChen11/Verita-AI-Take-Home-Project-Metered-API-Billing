import { describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";

import { CreditInvoiceNotFoundError, CreditVoidInvoiceError, PostgresCreditRepository } from "./credits.js";

type FakeClient = PoolClient & { released: boolean };

const customerId = "00000000-0000-4000-8000-000000000001";
const invoiceId = "00000000-0000-4000-8000-000000000010";
const creditId = "00000000-0000-4000-8000-000000000030";

describe("PostgresCreditRepository", () => {
  it("inserts a credit, recalculates invoice totals, and writes an audit log transactionally", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [
      { rows: [] },
      { rows: [invoiceRow({ credits_cents: 0, total_cents: 10_000 })] },
      { rows: [{ id: creditId }] },
      { rows: [invoiceRow({ credits_cents: 500, total_cents: 9_500 })] },
      { rows: [] },
      { rows: [] },
    ]);
    const repository = new PostgresCreditRepository(createPool(client));

    await expect(repository.issueCredit(input())).resolves.toEqual({
      creditId,
      duplicate: false,
      invoice: {
        id: invoiceId,
        subtotalCents: 10_000,
        creditsCents: 500,
        totalCents: 9_500,
      },
    });

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "SELECT",
      "INSERT",
      "WITH",
      "INSERT",
      "COMMIT",
    ]);
    expect(queries[1]?.text).toContain("FOR UPDATE");
    expect(queries[2]?.text).toContain("ON CONFLICT (customer_id, idempotency_key) DO NOTHING");
    expect(queries[3]?.text).toContain("COALESCE(SUM(amount_cents), 0)::bigint");
    expect(queries[3]?.text).toContain("GREATEST(subtotal_cents - credit_totals.credits_cents, 0)");
    expect(queries[4]?.text).toContain("INSERT INTO audit_logs");
    expect(client.released).toBe(true);
  });

  it("returns the existing credit and invoice totals for duplicate idempotency keys", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [
      { rows: [] },
      { rows: [invoiceRow({ credits_cents: 500, total_cents: 9_500 })] },
      { rows: [] },
      { rows: [{ id: creditId, invoice_id: invoiceId }] },
      { rows: [invoiceRow({ credits_cents: 500, total_cents: 9_500 })] },
      { rows: [] },
    ]);
    const repository = new PostgresCreditRepository(createPool(client));

    await expect(repository.issueCredit(input())).resolves.toMatchObject({
      creditId,
      duplicate: true,
      invoice: { creditsCents: 500, totalCents: 9_500 },
    });

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "SELECT",
      "INSERT",
      "SELECT",
      "SELECT",
      "ROLLBACK",
    ]);
    expect(queries[3]?.text).toContain("SELECT id, invoice_id");
    expect(client.released).toBe(true);
  });

  it("rolls back when duplicate idempotency lookup finds no existing credit", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [
      { rows: [] },
      { rows: [invoiceRow({ credits_cents: 500, total_cents: 9_500 })] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const repository = new PostgresCreditRepository(createPool(client));

    await expect(repository.issueCredit(input())).rejects.toThrow("Idempotent credit lookup failed");

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "SELECT",
      "INSERT",
      "SELECT",
      "ROLLBACK",
    ]);
    expect(client.released).toBe(true);
  });

  it("rolls back when the invoice is not found for the customer", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [{ rows: [] }, { rows: [] }, { rows: [] }]);
    const repository = new PostgresCreditRepository(createPool(client));

    await expect(repository.issueCredit(input())).rejects.toBeInstanceOf(CreditInvoiceNotFoundError);

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual(["BEGIN", "SELECT", "ROLLBACK"]);
    expect(client.released).toBe(true);
  });

  it("rolls back when issuing a credit against a void invoice", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [{ rows: [] }, { rows: [invoiceRow({ status: "void" })] }, { rows: [] }]);
    const repository = new PostgresCreditRepository(createPool(client));

    await expect(repository.issueCredit(input())).rejects.toBeInstanceOf(CreditVoidInvoiceError);

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual(["BEGIN", "SELECT", "ROLLBACK"]);
    expect(client.released).toBe(true);
  });
});

function input() {
  return {
    customerId,
    invoiceId,
    amountCents: 500,
    reason: "Service issue",
    idempotencyKey: "credit_1",
    actor: "ops@example.com",
  };
}

function invoiceRow(overrides: Partial<{ status: string; credits_cents: number; total_cents: number }> = {}) {
  return {
    id: invoiceId,
    status: overrides.status ?? "issued",
    subtotal_cents: 10_000,
    credits_cents: overrides.credits_cents ?? 0,
    total_cents: overrides.total_cents ?? 10_000,
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

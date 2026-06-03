import { describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";

import { PaymentWebhookInvoiceNotFoundError, PostgresPaymentWebhookRepository } from "./paymentWebhooks.js";

type FakeClient = PoolClient & { released: boolean };

describe("PostgresPaymentWebhookRepository", () => {
  it("records the webhook delivery and marks the invoice paid transactionally", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [
      { rows: [] },
      { rows: [{ id: "delivery_1" }] },
      { rows: [{ id: "00000000-0000-4000-8000-000000000010" }] },
      { rows: [] },
      { rows: [] },
    ]);
    const repository = new PostgresPaymentWebhookRepository(createPool(client));

    await expect(repository.processPaidInvoice(input())).resolves.toEqual({
      duplicate: false,
      invoiceId: "00000000-0000-4000-8000-000000000010",
    });

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "INSERT",
      "UPDATE",
      "UPDATE",
      "COMMIT",
    ]);
    expect(queries[1]?.text).toContain("ON CONFLICT (provider_event_id) DO NOTHING");
    expect(queries[2]?.text).toContain("status = 'paid'");
    expect(queries[2]?.text).toContain("status != 'void'");
    expect(client.released).toBe(true);
  });

  it("treats duplicate provider events as no-op success", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [{ rows: [] }, { rows: [] }, { rows: [] }]);
    const repository = new PostgresPaymentWebhookRepository(createPool(client));

    await expect(repository.processPaidInvoice(input())).resolves.toEqual({
      duplicate: true,
      invoiceId: "00000000-0000-4000-8000-000000000010",
    });

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual(["BEGIN", "INSERT", "ROLLBACK"]);
    expect(client.released).toBe(true);
  });

  it("rolls back when the invoice cannot be marked paid", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [{ rows: [] }, { rows: [{ id: "delivery_1" }] }, { rows: [] }, { rows: [] }]);
    const repository = new PostgresPaymentWebhookRepository(createPool(client));

    await expect(repository.processPaidInvoice(input())).rejects.toBeInstanceOf(PaymentWebhookInvoiceNotFoundError);

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual(["BEGIN", "INSERT", "UPDATE", "ROLLBACK"]);
    expect(client.released).toBe(true);
  });
});

function input() {
  return {
    providerEventId: "evt_1",
    invoiceId: "00000000-0000-4000-8000-000000000010",
    eventType: "invoice.paid",
    payload: { id: "evt_1" },
    paidAt: new Date("2026-06-03T12:00:00Z"),
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

import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";

import {
  createGetInvoiceHandler,
  createListInvoicesHandler,
  encodeInvoiceCursor,
} from "./invoices.js";
import type { InvoiceRouteDependencies } from "./invoices.js";
import type { CustomerInvoiceDetail, CustomerInvoiceSummary, InvoiceListCursor } from "../repositories/invoices.js";

const customerId = "00000000-0000-4000-8000-000000000001";
const invoiceId = "00000000-0000-4000-8000-000000000010";

function createResponse() {
  const output: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      output.status = code;
      return response;
    },
    json(body: unknown) {
      output.body = body;
      return response;
    },
  } as Response;

  return { output, response };
}

function createRequest(options: { query?: Record<string, unknown>; params?: Record<string, string>; customerId?: string }) {
  return {
    query: options.query ?? {},
    params: options.params ?? {},
    customer: {
      customerId: options.customerId ?? customerId,
      apiKeyId: "00000000-0000-4000-8000-000000000002",
    },
  } as unknown as Request;
}

function createDependencies(options?: {
  summaries?: CustomerInvoiceSummary[];
  detail?: CustomerInvoiceDetail;
  detailFound?: boolean;
}) {
  const calls: Array<{ method: string; customerId: string; limit?: number; cursor?: InvoiceListCursor; invoiceId?: string }> =
    [];
  const dependencies: InvoiceRouteDependencies = {
    invoices: {
      async listForCustomer(customer, limit, cursor) {
        calls.push({ method: "list", customerId: customer, limit, cursor });
        return options?.summaries ?? [summary()];
      },
      async findForCustomer(customer, id) {
        calls.push({ method: "find", customerId: customer, invoiceId: id });
        if (options?.detailFound === false) {
          return undefined;
        }

        return options?.detail ?? detail();
      },
    },
  };

  return { dependencies, calls };
}

function summary(overrides: Partial<CustomerInvoiceSummary> = {}): CustomerInvoiceSummary {
  return {
    id: invoiceId,
    periodStart: "2026-06-01",
    periodEnd: "2026-07-01",
    status: "draft",
    subtotalCents: 10_000,
    creditsCents: 0,
    totalCents: 10_000,
    issuedAt: null,
    paidAt: null,
    createdAt: new Date("2026-06-03T12:00:00Z"),
    ...overrides,
  };
}

function detail(): CustomerInvoiceDetail {
  return {
    ...summary({ status: "issued", issuedAt: new Date("2026-06-03T13:00:00Z") }),
    lineItems: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        description: "Usage units 10001-100000",
        units: 90_000,
        unitPriceMicros: 1_000,
        amountCents: 9_000,
        isOverridden: false,
      },
    ],
    credits: [
      {
        id: "00000000-0000-4000-8000-000000000012",
        amountCents: 100,
        reason: "Test credit",
        createdBy: "ops@example.com",
        createdAt: new Date("2026-06-03T14:00:00Z"),
      },
    ],
  };
}

describe("GET /v1/invoices handler", () => {
  it("lists invoices scoped to the authenticated customer", async () => {
    const { dependencies, calls } = createDependencies();
    const handler = createListInvoicesHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ query: {} }), response);

    expect(calls[0]).toMatchObject({ method: "list", customerId, limit: 51 });
    expect(output).toEqual({
      body: {
        data: [
          {
            id: invoiceId,
            period_start: "2026-06-01",
            period_end: "2026-07-01",
            status: "draft",
            subtotal_cents: 10_000,
            credits_cents: 0,
            total_cents: 10_000,
            issued_at: null,
            paid_at: null,
            created_at: "2026-06-03T12:00:00.000Z",
          },
        ],
        next_cursor: null,
      },
    });
  });

  it("returns a next cursor when more invoices exist", async () => {
    const firstInvoice = summary({
      id: "00000000-0000-4000-8000-000000000101",
      createdAt: new Date("2026-06-03T12:00:00Z"),
    });
    const { dependencies } = createDependencies({
      summaries: [
        firstInvoice,
        summary({ id: "00000000-0000-4000-8000-000000000102", createdAt: new Date("2026-06-02T12:00:00Z") }),
      ],
    });
    const handler = createListInvoicesHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ query: { limit: "1" } }), response);

    expect(output.body).toMatchObject({
      next_cursor: encodeInvoiceCursor(firstInvoice),
    });
  });

  it("passes decoded cursor to repository", async () => {
    const cursorInvoice = summary({ id: "00000000-0000-4000-8000-000000000101" });
    const { dependencies, calls } = createDependencies();
    const handler = createListInvoicesHandler(dependencies);
    const { response } = createResponse();

    await handler(createRequest({ query: { cursor: encodeInvoiceCursor(cursorInvoice) } }), response);

    expect(calls[0]?.cursor).toEqual({ createdAt: cursorInvoice.createdAt, id: cursorInvoice.id });
  });
});

describe("GET /v1/invoices/:id handler", () => {
  it("returns invoice detail scoped to the authenticated customer", async () => {
    const { dependencies, calls } = createDependencies();
    const handler = createGetInvoiceHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: { id: invoiceId } }), response);

    expect(calls[0]).toMatchObject({ method: "find", customerId, invoiceId });
    expect(output.body).toMatchObject({
      data: {
        id: invoiceId,
        status: "issued",
        line_items: [
          {
            units: 90_000,
            amount_cents: 9_000,
          },
        ],
        credits: [
          {
            amount_cents: 100,
            created_by: "ops@example.com",
          },
        ],
      },
    });
  });

  it("returns 404 when scoped lookup finds no invoice", async () => {
    const { dependencies } = createDependencies({ detailFound: false });
    const handler = createGetInvoiceHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: { id: invoiceId } }), response);

    expect(output).toEqual({ status: 404, body: { error: "invoice_not_found" } });
  });
});

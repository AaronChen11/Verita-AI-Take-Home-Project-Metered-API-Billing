import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";

import {
  createGetOpsCustomerHandler,
  createIssueCreditHandler,
  createListOpsCustomersHandler,
  createOverrideLineItemHandler,
  encodeOpsCustomerCursor,
} from "./ops.js";
import type { OpsRouteDependencies } from "./ops.js";
import { CreditInvoiceNotFoundError } from "../repositories/credits.js";
import {
  OverrideInvoiceNotFoundError,
  OverrideLineItemNotFoundError,
  OverridePaidInvoiceError,
} from "../repositories/lineItemOverrides.js";
import type { OpsCustomerDetail, OpsCustomerSummary, OpsCustomerListCursor } from "../repositories/opsReads.js";

const customerId = "00000000-0000-4000-8000-000000000001";
const invoiceId = "00000000-0000-4000-8000-000000000010";
const lineItemId = "00000000-0000-4000-8000-000000000011";

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

function createRequest(options: {
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  body?: unknown;
  actor?: string;
}) {
  return {
    query: options.query ?? {},
    params: options.params ?? {},
    body: options.body,
    ops: options.actor === undefined ? undefined : { actor: options.actor },
  } as Request;
}

function createDependencies(options?: {
  customers?: OpsCustomerSummary[];
  detail?: OpsCustomerDetail;
  detailFound?: boolean;
  duplicateCredit?: boolean;
  invoiceNotFound?: boolean;
  lineItemNotFound?: boolean;
  paidInvoice?: boolean;
}) {
  const calls: Array<{
    method: string;
    limit?: number;
    cursor?: OpsCustomerListCursor;
    customerId?: string;
    credit?: unknown;
    override?: unknown;
  }> = [];
  const dependencies: OpsRouteDependencies = {
    credits: {
      async issueCredit(input) {
        calls.push({ method: "credit", credit: input });
        if (options?.invoiceNotFound) {
          throw new CreditInvoiceNotFoundError(input.invoiceId);
        }

        return {
          creditId: "00000000-0000-4000-8000-000000000030",
          duplicate: options?.duplicateCredit ?? false,
          invoice: {
            id: input.invoiceId,
            subtotalCents: 10_000,
            creditsCents: 500,
            totalCents: 9_500,
          },
        };
      },
    },
    lineItemOverrides: {
      async overrideLineItem(input) {
        calls.push({ method: "override", override: input });
        if (options?.paidInvoice) {
          throw new OverridePaidInvoiceError(input.invoiceId);
        }
        if (options?.invoiceNotFound) {
          throw new OverrideInvoiceNotFoundError(input.invoiceId);
        }
        if (options?.lineItemNotFound) {
          throw new OverrideLineItemNotFoundError(input.lineItemId);
        }

        return {
          lineItem: {
            id: input.lineItemId,
            amountCents: input.amountCents,
            isOverridden: true,
          },
          invoice: {
            id: input.invoiceId,
            subtotalCents: 8_000,
            creditsCents: 500,
            totalCents: 7_500,
          },
        };
      },
    },
    opsReads: {
      async listCustomers(limit, cursor) {
        calls.push({ method: "list", limit, cursor });
        return options?.customers ?? [customer()];
      },
      async findCustomerDetail(id) {
        calls.push({ method: "find", customerId: id });
        if (options?.detailFound === false) {
          return undefined;
        }

        return options?.detail ?? detail();
      },
    },
  };

  return { calls, dependencies };
}

function customer(overrides: Partial<OpsCustomerSummary> = {}): OpsCustomerSummary {
  return {
    id: customerId,
    name: "Acme",
    email: "billing@acme.test",
    pricePlanName: "Growth",
    createdAt: new Date("2026-06-03T12:00:00Z"),
    ...overrides,
  };
}

function detail(): OpsCustomerDetail {
  return {
    customer: customer(),
    usage: {
      currentHourUnits: 1_100,
      averageHourlyUnitsLast30Days: 100,
      anomaly: true,
    },
    invoices: [
      {
        id: "00000000-0000-4000-8000-000000000010",
        periodStart: "2026-06-01",
        periodEnd: "2026-07-01",
        status: "issued",
        totalCents: 10_000,
        createdAt: new Date("2026-06-03T13:00:00Z"),
        lineItems: [
          {
            id: "00000000-0000-4000-8000-000000000011",
            amountCents: 10_000,
            description: "Usage",
            isOverridden: false,
          },
        ],
      },
    ],
    auditLogs: [
      {
        id: "00000000-0000-4000-8000-000000000020",
        actor: "ops@example.com",
        action: "credit.created",
        entityType: "customer",
        entityId: customerId,
        reason: "Test credit",
        beforeValue: { totalCents: 10_000 },
        afterValue: { totalCents: 9_500 },
        createdAt: new Date("2026-06-03T14:00:00Z"),
      },
    ],
  };
}

describe("GET /ops/customers handler", () => {
  it("lists customers with pagination", async () => {
    const { calls, dependencies } = createDependencies();
    const handler = createListOpsCustomersHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ query: {} }), response);

    expect(calls[0]).toMatchObject({ method: "list", limit: 51 });
    expect(output.body).toEqual({
      data: [
        {
          id: customerId,
          name: "Acme",
          email: "billing@acme.test",
          price_plan_name: "Growth",
          created_at: "2026-06-03T12:00:00.000Z",
        },
      ],
      next_cursor: null,
    });
  });

  it("returns a stable next cursor when more customers exist", async () => {
    const firstCustomer = customer({ id: "00000000-0000-4000-8000-000000000101" });
    const { dependencies } = createDependencies({
      customers: [firstCustomer, customer({ id: "00000000-0000-4000-8000-000000000102" })],
    });
    const handler = createListOpsCustomersHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ query: { limit: "1" } }), response);

    expect(output.body).toMatchObject({ next_cursor: encodeOpsCustomerCursor(firstCustomer) });
  });

  it("passes decoded cursors to the repository", async () => {
    const cursorCustomer = customer({ id: "00000000-0000-4000-8000-000000000101" });
    const { calls, dependencies } = createDependencies();
    const handler = createListOpsCustomersHandler(dependencies);
    const { response } = createResponse();

    await handler(createRequest({ query: { cursor: encodeOpsCustomerCursor(cursorCustomer) } }), response);

    expect(calls[0]?.cursor).toEqual({ createdAt: cursorCustomer.createdAt, id: cursorCustomer.id });
  });
});

describe("PATCH /ops/invoices/:invoiceId/line-items/:lineItemId handler", () => {
  it("requires an ops actor", async () => {
    const { dependencies } = createDependencies();
    const handler = createOverrideLineItemHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: overrideParams(), body: overrideBody() }), response);

    expect(output).toEqual({ status: 400, body: { error: "missing_ops_actor" } });
  });

  it("overrides a line item and returns recalculated invoice totals", async () => {
    const { calls, dependencies } = createDependencies();
    const handler = createOverrideLineItemHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: overrideParams(), body: overrideBody(), actor: "ops@example.com" }), response);

    expect(calls[0]).toMatchObject({
      method: "override",
      override: {
        invoiceId,
        lineItemId,
        amountCents: 8_000,
        reason: "Contract correction",
        actor: "ops@example.com",
      },
    });
    expect(output).toEqual({
      body: {
        data: {
          line_item: {
            id: lineItemId,
            amount_cents: 8_000,
            is_overridden: true,
          },
          invoice: {
            id: invoiceId,
            subtotal_cents: 8_000,
            credits_cents: 500,
            total_cents: 7_500,
          },
        },
      },
    });
  });

  it("rejects paid invoice overrides", async () => {
    const { dependencies } = createDependencies({ paidInvoice: true });
    const handler = createOverrideLineItemHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: overrideParams(), body: overrideBody(), actor: "ops@example.com" }), response);

    expect(output).toEqual({ status: 409, body: { error: "paid_invoice_cannot_be_overridden" } });
  });

  it("returns 404 when the invoice or line item cannot be found", async () => {
    const { dependencies } = createDependencies({ lineItemNotFound: true });
    const handler = createOverrideLineItemHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: overrideParams(), body: overrideBody(), actor: "ops@example.com" }), response);

    expect(output).toEqual({ status: 404, body: { error: "line_item_not_found" } });
  });

  it("rejects invalid override requests", async () => {
    const { dependencies } = createDependencies();
    const handler = createOverrideLineItemHandler(dependencies);
    const { output, response } = createResponse();

    await handler(
      createRequest({
        params: overrideParams(),
        body: { amount_cents: -1, reason: "" },
        actor: "ops@example.com",
      }),
      response,
    );

    expect(output.status).toBe(400);
    expect(output.body).toMatchObject({ error: "invalid_line_item_override_request" });
  });
});

describe("POST /ops/customers/:id/credits handler", () => {
  it("requires an ops actor", async () => {
    const { dependencies } = createDependencies();
    const handler = createIssueCreditHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: { id: customerId }, body: creditBody() }), response);

    expect(output).toEqual({ status: 400, body: { error: "missing_ops_actor" } });
  });

  it("issues an invoice-bound credit", async () => {
    const { calls, dependencies } = createDependencies();
    const handler = createIssueCreditHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: { id: customerId }, body: creditBody(), actor: "ops@example.com" }), response);

    expect(calls[0]).toMatchObject({
      method: "credit",
      credit: {
        customerId,
        invoiceId,
        amountCents: 500,
        reason: "Service issue",
        idempotencyKey: "credit_1",
        actor: "ops@example.com",
      },
    });
    expect(output).toEqual({
      status: 201,
      body: {
        data: {
          credit_id: "00000000-0000-4000-8000-000000000030",
          duplicate: false,
          invoice: {
            id: invoiceId,
            subtotal_cents: 10_000,
            credits_cents: 500,
            total_cents: 9_500,
          },
        },
      },
    });
  });

  it("returns no-op success for duplicate idempotency keys", async () => {
    const { dependencies } = createDependencies({ duplicateCredit: true });
    const handler = createIssueCreditHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: { id: customerId }, body: creditBody(), actor: "ops@example.com" }), response);

    expect(output).toMatchObject({ status: 200, body: { data: { duplicate: true } } });
  });

  it("returns 404 when the invoice is not scoped to the customer", async () => {
    const { dependencies } = createDependencies({ invoiceNotFound: true });
    const handler = createIssueCreditHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: { id: customerId }, body: creditBody(), actor: "ops@example.com" }), response);

    expect(output).toEqual({ status: 404, body: { error: "invoice_not_found" } });
  });

  it("rejects invalid credit requests", async () => {
    const { dependencies } = createDependencies();
    const handler = createIssueCreditHandler(dependencies);
    const { output, response } = createResponse();

    await handler(
      createRequest({
        params: { id: customerId },
        body: { ...creditBody(), reason: "", amount_cents: 0 },
        actor: "ops@example.com",
      }),
      response,
    );

    expect(output.status).toBe(400);
    expect(output.body).toMatchObject({ error: "invalid_credit_request" });
  });
});

function creditBody() {
  return {
    invoice_id: invoiceId,
    amount_cents: 500,
    reason: "Service issue",
    idempotency_key: "credit_1",
  };
}

function overrideParams() {
  return {
    invoiceId,
    lineItemId,
  };
}

function overrideBody() {
  return {
    amount_cents: 8_000,
    reason: "Contract correction",
  };
}

describe("GET /ops/customers/:id handler", () => {
  it("returns customer detail with usage, invoices, and audit trail", async () => {
    const { calls, dependencies } = createDependencies();
    const handler = createGetOpsCustomerHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: { id: customerId } }), response);

    expect(calls[0]).toEqual({ method: "find", customerId });
    expect(output.body).toMatchObject({
      data: {
        customer: { id: customerId },
        usage: { current_hour_units: 1_100, average_hourly_units_last_30_days: 100, anomaly: true },
        invoices: [{ total_cents: 10_000 }],
        audit_logs: [{ actor: "ops@example.com", reason: "Test credit" }],
      },
    });
  });

  it("returns 404 when a customer is not found", async () => {
    const { dependencies } = createDependencies({ detailFound: false });
    const handler = createGetOpsCustomerHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ params: { id: customerId } }), response);

    expect(output).toEqual({ status: 404, body: { error: "customer_not_found" } });
  });
});

import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";

import { createGetOpsCustomerHandler, createListOpsCustomersHandler, encodeOpsCustomerCursor } from "./ops.js";
import type { OpsRouteDependencies } from "./ops.js";
import type { OpsCustomerDetail, OpsCustomerSummary, OpsCustomerListCursor } from "../repositories/opsReads.js";

const customerId = "00000000-0000-4000-8000-000000000001";

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

function createRequest(options: { query?: Record<string, unknown>; params?: Record<string, string> }) {
  return {
    query: options.query ?? {},
    params: options.params ?? {},
  } as Request;
}

function createDependencies(options?: { customers?: OpsCustomerSummary[]; detail?: OpsCustomerDetail; detailFound?: boolean }) {
  const calls: Array<{ method: string; limit?: number; cursor?: OpsCustomerListCursor; customerId?: string }> = [];
  const dependencies: OpsRouteDependencies = {
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

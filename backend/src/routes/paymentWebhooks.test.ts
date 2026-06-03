import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";

import { createPaymentWebhookHandler } from "./paymentWebhooks.js";
import type { PaymentWebhookRouteDependencies } from "./paymentWebhooks.js";
import { signPaymentWebhookPayload } from "../security/webhookSignatures.js";

const webhookSecret = "test_webhook_secret";
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

function createRequest(rawBody: Buffer, signature = signPaymentWebhookPayload(rawBody, webhookSecret)) {
  return {
    body: rawBody,
    header(name: string) {
      return name.toLowerCase() === "x-payment-signature" ? signature : undefined;
    },
  } as Request;
}

function createDependencies(duplicate = false) {
  const calls: unknown[] = [];
  const dependencies: PaymentWebhookRouteDependencies = {
    webhookSecret,
    payments: {
      async processPaidInvoice(input) {
        calls.push(input);
        return { duplicate, invoiceId: input.invoiceId };
      },
    },
  };

  return { calls, dependencies };
}

describe("POST /webhooks/payments handler", () => {
  it("verifies raw body signature and marks an invoice paid", async () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        id: "evt_1",
        type: "invoice.paid",
        invoice_id: invoiceId,
        paid_at: "2026-06-03T12:00:00Z",
      }),
    );
    const { calls, dependencies } = createDependencies();
    const handler = createPaymentWebhookHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest(rawBody), response);

    expect(calls[0]).toMatchObject({
      providerEventId: "evt_1",
      invoiceId,
      eventType: "invoice.paid",
      paidAt: new Date("2026-06-03T12:00:00Z"),
    });
    expect(output.body).toEqual({ received: true, duplicate: false, invoice_id: invoiceId });
  });

  it("returns no-op success for duplicate provider events", async () => {
    const rawBody = Buffer.from(JSON.stringify({ id: "evt_1", type: "invoice.paid", invoice_id: invoiceId }));
    const { dependencies } = createDependencies(true);
    const handler = createPaymentWebhookHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest(rawBody), response);

    expect(output.body).toEqual({ received: true, duplicate: true, invoice_id: invoiceId });
  });

  it("rejects invalid signatures before parsing or processing", async () => {
    const rawBody = Buffer.from(JSON.stringify({ id: "evt_1", type: "invoice.paid", invoice_id: invoiceId }));
    const { calls, dependencies } = createDependencies();
    const handler = createPaymentWebhookHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest(rawBody, "sha256=bad"), response);

    expect(calls).toEqual([]);
    expect(output).toEqual({ status: 401, body: { error: "invalid_signature" } });
  });

  it("requires the Express raw-body parser output", async () => {
    const { dependencies } = createDependencies();
    const handler = createPaymentWebhookHandler(dependencies);
    const { output, response } = createResponse();

    await handler({ body: { id: "evt_1" }, header: () => undefined } as unknown as Request, response);

    expect(output).toEqual({ status: 400, body: { error: "missing_raw_body" } });
  });
});

import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import type { PaymentWebhookRepository } from "../repositories/paymentWebhooks.js";
import { verifyPaymentWebhookSignature } from "../security/webhookSignatures.js";

const paymentWebhookSchema = z.object({
  id: z.string().min(1),
  type: z.literal("invoice.paid"),
  invoice_id: z.string().uuid(),
  paid_at: z.string().datetime().optional(),
});

export type PaymentWebhookRouteDependencies = {
  payments: PaymentWebhookRepository;
  webhookSecret: string;
};

export function createPaymentWebhookHandler(dependencies: PaymentWebhookRouteDependencies) {
  return async function handlePaymentWebhook(req: Request, res: Response) {
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "missing_raw_body" });
      return;
    }

    const signature = req.header("x-payment-signature");
    if (!verifyPaymentWebhookSignature(req.body, signature, dependencies.webhookSecret)) {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    const parsedJson = parseJson(req.body);
    if (!parsedJson.ok) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }

    const parsedPayload = paymentWebhookSchema.safeParse(parsedJson.value);
    if (!parsedPayload.success) {
      res.status(400).json({ error: "invalid_payment_webhook", details: parsedPayload.error.flatten() });
      return;
    }

    const paidAt = parsedPayload.data.paid_at ? new Date(parsedPayload.data.paid_at) : new Date();
    const result = await dependencies.payments.processPaidInvoice({
      providerEventId: parsedPayload.data.id,
      invoiceId: parsedPayload.data.invoice_id,
      eventType: parsedPayload.data.type,
      payload: parsedJson.value,
      paidAt,
    });

    res.json({
      received: true,
      duplicate: result.duplicate,
      invoice_id: result.invoiceId,
    });
  };
}

export function createPaymentWebhookRouter(dependencies: PaymentWebhookRouteDependencies) {
  const router = Router();

  router.post("/payments", createPaymentWebhookHandler(dependencies));

  return router;
}

function parseJson(rawBody: Buffer): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(rawBody.toString("utf8")) as unknown };
  } catch {
    return { ok: false };
  }
}

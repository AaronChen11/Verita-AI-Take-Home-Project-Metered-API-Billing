import { describe, expect, it } from "vitest";

import { signPaymentWebhookPayload, verifyPaymentWebhookSignature } from "./webhookSignatures.js";

describe("payment webhook signatures", () => {
  it("signs and verifies raw webhook bytes", () => {
    const rawBody = Buffer.from('{"id":"evt_1","spacing":true}');
    const signature = signPaymentWebhookPayload(rawBody, "secret");

    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(verifyPaymentWebhookSignature(rawBody, signature, "secret")).toBe(true);
  });

  it("rejects signatures that do not match the exact raw body", () => {
    const rawBody = Buffer.from('{\n  "id": "evt_1",\n  "spacing": true\n}');
    const normalizedBody = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString("utf8"))));
    const signature = signPaymentWebhookPayload(rawBody, "secret");

    expect(verifyPaymentWebhookSignature(normalizedBody, signature, "secret")).toBe(false);
    expect(verifyPaymentWebhookSignature(rawBody, signature, "wrong-secret")).toBe(false);
    expect(verifyPaymentWebhookSignature(rawBody, undefined, "secret")).toBe(false);
  });
});

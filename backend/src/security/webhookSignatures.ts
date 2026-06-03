import { createHmac } from "node:crypto";

import { constantTimeEqual } from "./constantTime.js";

const SIGNATURE_PREFIX = "sha256=";

export function signPaymentWebhookPayload(rawBody: Buffer, secret: string) {
  return `${SIGNATURE_PREFIX}${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifyPaymentWebhookSignature(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature?.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  return constantTimeEqual(signature, signPaymentWebhookPayload(rawBody, secret));
}

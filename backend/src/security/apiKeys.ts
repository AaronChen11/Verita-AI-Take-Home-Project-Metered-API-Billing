import { createHmac, randomBytes } from "node:crypto";

const API_KEY_PREFIX = "mb_live";
const API_KEY_RANDOM_BYTES = 32;

export function generateApiKey() {
  const secret = randomBytes(API_KEY_RANDOM_BYTES).toString("base64url");
  const token = `${API_KEY_PREFIX}_${secret}`;

  return {
    token,
    keyPrefix: token.slice(0, 14),
  };
}

export function hashApiKey(token: string, pepper: string) {
  // API keys are high-entropy generated secrets, so HMAC is appropriate here.
  return createHmac("sha256", pepper).update(token).digest("hex");
}

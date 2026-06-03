import { describe, expect, it } from "vitest";

import { generateApiKey, hashApiKey } from "./apiKeys.js";

describe("api key security", () => {
  it("generates a raw token with a display prefix", () => {
    const apiKey = generateApiKey();

    expect(apiKey.token.startsWith("mb_live_")).toBe(true);
    expect(apiKey.keyPrefix).toBe(apiKey.token.slice(0, 14));
  });

  it("hashes tokens with the configured pepper", () => {
    const token = "mb_live_example";

    expect(hashApiKey(token, "pepper-a")).toBe(hashApiKey(token, "pepper-a"));
    expect(hashApiKey(token, "pepper-a")).not.toBe(hashApiKey(token, "pepper-b"));
  });
});

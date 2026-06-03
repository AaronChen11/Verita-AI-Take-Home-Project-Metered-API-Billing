import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";

import { createCustomerAuthMiddleware } from "./customerAuth.js";
import { hashApiKey } from "../security/apiKeys.js";

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

describe("customer auth middleware", () => {
  it("attaches tenant context for a valid API key", async () => {
    const token = "mb_live_valid";
    const pepper = "test-pepper";
    const middleware = createCustomerAuthMiddleware(
      {
        async findActiveByHash(keyHash) {
          if (keyHash !== hashApiKey(token, pepper)) {
            return undefined;
          }

          return { id: "key_1", customerId: "customer_1" };
        },
      },
      pepper,
    );
    const request = {
      header(name: string) {
        return name === "authorization" ? `Bearer ${token}` : undefined;
      },
    } as unknown as Request;
    const { response } = createResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await middleware(request, response, next);

    expect(nextCalled).toBe(true);
    expect(request.customer).toEqual({ customerId: "customer_1", apiKeyId: "key_1" });
  });

  it("rejects missing bearer tokens", async () => {
    const middleware = createCustomerAuthMiddleware(
      {
        async findActiveByHash() {
          throw new Error("lookup should not run");
        },
      },
      "pepper",
    );
    const request = {
      header() {
        return undefined;
      },
    } as unknown as Request;
    const { output, response } = createResponse();

    await middleware(request, response, () => undefined);

    expect(output).toEqual({ status: 401, body: { error: "missing_bearer_token" } });
  });
});

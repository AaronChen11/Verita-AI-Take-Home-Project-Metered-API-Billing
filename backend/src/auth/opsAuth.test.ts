import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";

import { createOpsAuthMiddleware, requireOpsActor } from "./opsAuth.js";

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

describe("ops auth middleware", () => {
  it("attaches the ops actor when the shared token is valid", () => {
    const middleware = createOpsAuthMiddleware("secret");
    const request = {
      header(name: string) {
        if (name === "x-ops-token") return "secret";
        if (name === "x-ops-actor") return "ops@example.com";
        return undefined;
      },
    } as unknown as Request;
    const { response } = createResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    middleware(request, response, next);

    expect(nextCalled).toBe(true);
    expect(request.ops).toEqual({ actor: "ops@example.com" });
  });

  it("rejects invalid ops tokens", () => {
    const middleware = createOpsAuthMiddleware("secret");
    const request = {
      header() {
        return "wrong";
      },
    } as unknown as Request;
    const { output, response } = createResponse();

    middleware(request, response, () => undefined);

    expect(output).toEqual({ status: 401, body: { error: "invalid_ops_token" } });
  });

  it("requires an actor for money-moving ops actions", () => {
    const request = { ops: {} } as Request;
    const { output, response } = createResponse();

    requireOpsActor(request, response, () => undefined);

    expect(output).toEqual({ status: 400, body: { error: "missing_ops_actor" } });
  });
});

import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";

import { createApp, healthHandler } from "./app.js";

describe("healthHandler", () => {
  it("returns an ok payload", () => {
    const payloads: Array<{ ok: boolean }> = [];
    const res = {
      json(payload: { ok: boolean }) {
        payloads.push(payload);
      },
    } as Response;

    healthHandler({} as Request, res);

    expect(payloads).toEqual([{ ok: true }]);
  });
});

describe("createApp", () => {
  it("runs customer auth before event routes", async () => {
    const calls: string[] = [];
    const app = createApp({
      customerApi: {
        auth(_req: Request, _res: Response, next: NextFunction) {
          calls.push("auth");
          next();
        },
        events: {
          apiKeys: {
            async findActiveIdsForCustomer() {
              calls.push("ownership");
              return new Set(["00000000-0000-4000-8000-000000000002"]);
            },
          },
          usageEvents: {
            async insertMany() {
              calls.push("insert");
              return 1;
            },
          },
        },
        invoices: {
          invoices: {
            async listForCustomer() {
              return [];
            },
            async findForCustomer() {
              return undefined;
            },
          },
        },
        usage: {
          apiKeys: {
            async findActiveIdsForCustomer() {
              return new Set();
            },
          },
          usageRead: {
            async listBuckets() {
              return [];
            },
          },
        },
      },
    });
    const req = {
      body: {
        events: [
          {
            request_id: "req_1",
            api_key_id: "00000000-0000-4000-8000-000000000002",
            endpoint: "/v1/completions",
            units: 1,
            timestamp: "2026-06-01T12:03:00Z",
          },
        ],
      },
      customer: {
        customerId: "00000000-0000-4000-8000-000000000001",
        apiKeyId: "00000000-0000-4000-8000-000000000002",
      },
      method: "POST",
      url: "/v1/events",
      headers: {},
    } as unknown as Request;
    const res = {
      status() {
        return res;
      },
      json() {
        return res;
      },
      setHeader() {
        return res;
      },
      getHeader() {
        return undefined;
      },
      end() {
        return res;
      },
    } as unknown as Response;

    await app(req, res);

    expect(calls).toEqual(["auth", "ownership", "insert"]);
  });
});

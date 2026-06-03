import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";

import { createPostEventsHandler } from "./events.js";
import type { EventsRouteDependencies } from "./events.js";
import type { UsageEventInsert } from "../repositories/usageEvents.js";

const customerId = "00000000-0000-4000-8000-000000000001";
const apiKeyId = "00000000-0000-4000-8000-000000000002";

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

function createRequest(body: unknown, customer = { customerId, apiKeyId }) {
  return {
    body,
    customer,
  } as unknown as Request;
}

function createDependencies(options?: { ownedApiKeyIds?: string[]; accepted?: number }) {
  const inserted: UsageEventInsert[] = [];
  const dependencies: EventsRouteDependencies = {
    apiKeys: {
      async findActiveIdsForCustomer(_customerId, apiKeyIds) {
        const owned = new Set(options?.ownedApiKeyIds ?? [apiKeyId]);
        return new Set(apiKeyIds.filter((id) => owned.has(id)));
      },
    },
    usageEvents: {
      async insertMany(events) {
        inserted.push(...events);
        return options?.accepted ?? events.length;
      },
    },
  };

  return { dependencies, inserted };
}

function validPayload() {
  return {
    events: [
      {
        request_id: "req_1",
        api_key_id: apiKeyId,
        endpoint: "/v1/completions",
        units: 120,
        timestamp: "2026-06-01T12:03:00Z",
      },
    ],
  };
}

describe("POST /v1/events handler", () => {
  it("accepts a valid tenant-scoped batch", async () => {
    const { dependencies, inserted } = createDependencies();
    const handler = createPostEventsHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest(validPayload()), response);

    expect(output).toEqual({ status: 202, body: { accepted: 1, duplicates: 0 } });
    expect(inserted).toMatchObject([
      {
        requestId: "req_1",
        customerId,
        apiKeyId,
        endpoint: "/v1/completions",
        units: 120,
      },
    ]);
  });

  it("reports duplicates based on inserted row count", async () => {
    const payload = validPayload();
    payload.events.push({
      request_id: "req_2",
      api_key_id: apiKeyId,
      endpoint: "/v1/completions",
      units: 80,
      timestamp: "2026-06-01T12:04:00Z",
    });
    const { dependencies } = createDependencies({ accepted: 1 });
    const handler = createPostEventsHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest(payload), response);

    expect(output).toEqual({ status: 202, body: { accepted: 1, duplicates: 1 } });
  });

  it("rejects batches without customer context", async () => {
    const { dependencies } = createDependencies();
    const handler = createPostEventsHandler(dependencies);
    const { output, response } = createResponse();

    await handler({ body: validPayload() } as Request, response);

    expect(output).toEqual({ status: 401, body: { error: "missing_customer_context" } });
  });

  it("rejects events for another customer's API key", async () => {
    const { dependencies, inserted } = createDependencies({ ownedApiKeyIds: [] });
    const handler = createPostEventsHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest(validPayload()), response);

    expect(output).toEqual({ status: 403, body: { error: "api_key_not_found" } });
    expect(inserted).toEqual([]);
  });

  it("rejects invalid event payloads", async () => {
    const { dependencies } = createDependencies();
    const handler = createPostEventsHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ events: [{ ...validPayload().events[0], units: 0 }] }), response);

    expect(output.status).toBe(400);
    expect(output.body).toMatchObject({ error: "invalid_event_batch" });
  });
});

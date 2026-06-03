import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";

import { createGetUsageHandler, encodeCursor } from "./usage.js";
import type { UsageRouteDependencies } from "./usage.js";
import type { UsageBucket, UsageReadQuery } from "../repositories/usageRead.js";

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

function createRequest(query: Record<string, unknown>, customer = { customerId, apiKeyId }) {
  return {
    query,
    customer,
  } as unknown as Request;
}

function createDependencies(options?: { ownedApiKeyIds?: string[]; buckets?: UsageBucket[] }) {
  const queries: UsageReadQuery[] = [];
  const dependencies: UsageRouteDependencies = {
    apiKeys: {
      async findActiveIdsForCustomer(_customerId, apiKeyIds) {
        const owned = new Set(options?.ownedApiKeyIds ?? [apiKeyId]);
        return new Set(apiKeyIds.filter((id) => owned.has(id)));
      },
    },
    usageRead: {
      async listBuckets(query) {
        queries.push(query);
        return options?.buckets ?? [bucket("2026-06-01T12:00:00Z", "2026-06-01T13:00:00Z", 120)];
      },
    },
  };

  return { dependencies, queries };
}

function bucket(bucketStart: string, bucketEnd: string, totalUnits: number): UsageBucket {
  return {
    bucketStart: new Date(bucketStart),
    bucketEnd: new Date(bucketEnd),
    totalUnits,
  };
}

describe("GET /v1/usage handler", () => {
  it("returns hourly usage buckets by default", async () => {
    const { dependencies, queries } = createDependencies();
    const handler = createGetUsageHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ start: "2026-06-01T00:00:00Z", end: "2026-06-02T00:00:00Z" }), response);

    expect(output).toEqual({
      body: {
        data: [
          {
            bucket_start: "2026-06-01T12:00:00.000Z",
            bucket_end: "2026-06-01T13:00:00.000Z",
            granularity: "hour",
            total_units: 120,
          },
        ],
        next_cursor: null,
      },
    });
    expect(queries[0]).toMatchObject({
      customerId,
      granularity: "hour",
      limit: 101,
    });
  });

  it("supports day granularity and cursor pagination", async () => {
    const secondBucketStart = new Date("2026-06-02T00:00:00Z");
    const { dependencies, queries } = createDependencies({
      buckets: [
        bucket("2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z", 300),
        bucket("2026-06-02T00:00:00Z", "2026-06-03T00:00:00Z", 400),
      ],
    });
    const handler = createGetUsageHandler(dependencies);
    const { output, response } = createResponse();

    await handler(
      createRequest({
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-03T00:00:00Z",
        granularity: "day",
        limit: "1",
        cursor: encodeCursor(secondBucketStart),
      }),
      response,
    );

    expect(output).toEqual({
      body: {
        data: [
          {
            bucket_start: "2026-06-01T00:00:00.000Z",
            bucket_end: "2026-06-02T00:00:00.000Z",
            granularity: "day",
            total_units: 300,
          },
        ],
        next_cursor: "MjAyNi0wNi0wMVQwMDowMDowMC4wMDBa",
      },
    });
    expect(queries[0]?.cursorStart).toEqual(secondBucketStart);
    expect(queries[0]?.limit).toBe(2);
  });

  it("uses the raw event aggregation path when filtering by api_key_id", async () => {
    const { dependencies, queries } = createDependencies();
    const handler = createGetUsageHandler(dependencies);
    const { response } = createResponse();

    await handler(
      createRequest({
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-02T00:00:00Z",
        api_key_id: apiKeyId,
      }),
      response,
    );

    expect(queries[0]?.apiKeyId).toBe(apiKeyId);
  });

  it("rejects another customer's api_key_id filter", async () => {
    const { dependencies } = createDependencies({ ownedApiKeyIds: [] });
    const handler = createGetUsageHandler(dependencies);
    const { output, response } = createResponse();

    await handler(
      createRequest({
        start: "2026-06-01T00:00:00Z",
        end: "2026-06-02T00:00:00Z",
        api_key_id: apiKeyId,
      }),
      response,
    );

    expect(output).toEqual({ status: 404, body: { error: "api_key_not_found" } });
  });

  it("rejects invalid query params", async () => {
    const { dependencies } = createDependencies();
    const handler = createGetUsageHandler(dependencies);
    const { output, response } = createResponse();

    await handler(createRequest({ start: "invalid", end: "2026-06-02T00:00:00Z" }), response);

    expect(output.status).toBe(400);
    expect(output.body).toMatchObject({ error: "invalid_usage_query" });
  });
});

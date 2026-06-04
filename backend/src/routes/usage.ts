import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import type { ApiKeyOwnershipLookup } from "../repositories/apiKeys.js";
import type { UsageBucket, UsageGranularity, UsageReadRepository } from "../repositories/usageRead.js";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

const usageQuerySchema = z.object({
  start: z.string().refine(isValidDate, { message: "Invalid start" }),
  end: z.string().refine(isValidDate, { message: "Invalid end" }),
  api_key_id: z.string().uuid().optional(),
  granularity: z.enum(["hour", "day"]).default("hour"),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().optional(),
});

export type UsageRouteDependencies = {
  apiKeys: ApiKeyOwnershipLookup;
  usageRead: UsageReadRepository;
};

export function createGetUsageHandler(dependencies: UsageRouteDependencies) {
  return async function getUsage(req: Request, res: Response) {
    if (!req.customer) {
      res.status(401).json({ error: "missing_customer_context" });
      return;
    }
    const customer = req.customer;

    const parsed = usageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_usage_query", details: parsed.error.flatten() });
      return;
    }

    const start = new Date(parsed.data.start);
    const end = new Date(parsed.data.end);
    if (end <= start) {
      res.status(400).json({ error: "invalid_date_range" });
      return;
    }

    const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > MAX_RANGE_MS) {
      res.status(400).json({ error: "date_range_too_large", detail: "Maximum range is 90 days" });
      return;
    }

    const cursorStart = decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor && !cursorStart) {
      res.status(400).json({ error: "invalid_cursor" });
      return;
    }

    if (parsed.data.api_key_id) {
      const ownedApiKeyIds = await dependencies.apiKeys.findActiveIdsForCustomer(customer.customerId, [
        parsed.data.api_key_id,
      ]);
      if (!ownedApiKeyIds.has(parsed.data.api_key_id)) {
        res.status(404).json({ error: "api_key_not_found" });
        return;
      }
    }

    const buckets = await dependencies.usageRead.listBuckets({
      customerId: customer.customerId,
      start,
      end,
      granularity: parsed.data.granularity,
      limit: parsed.data.limit + 1,
      cursorStart,
      apiKeyId: parsed.data.api_key_id,
    });
    const page = buckets.slice(0, parsed.data.limit);
    const hasNextPage = buckets.length > parsed.data.limit;

    res.json({
      data: page.map((bucket) => serializeBucket(bucket, parsed.data.granularity)),
      next_cursor: hasNextPage ? encodeCursor(page[page.length - 1]?.bucketStart) : null,
    });
  };
}

export function createUsageRouter(dependencies: UsageRouteDependencies) {
  const router = Router();

  router.get("/usage", createGetUsageHandler(dependencies));

  return router;
}

function serializeBucket(bucket: UsageBucket, granularity: UsageGranularity) {
  return {
    bucket_start: bucket.bucketStart.toISOString(),
    bucket_end: bucket.bucketEnd.toISOString(),
    granularity,
    total_units: bucket.totalUnits,
  };
}

function isValidDate(value: string) {
  return !Number.isNaN(Date.parse(value));
}

export function encodeCursor(bucketStart: Date | undefined) {
  if (!bucketStart) {
    return null;
  }

  return Buffer.from(bucketStart.toISOString(), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined) {
  if (!cursor) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const timestamp = Date.parse(decoded);

    return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
  } catch {
    return undefined;
  }
}

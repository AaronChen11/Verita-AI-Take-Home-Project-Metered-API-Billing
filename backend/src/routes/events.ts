import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import type { ApiKeyOwnershipLookup } from "../repositories/apiKeys.js";
import type { UsageEventRepository } from "../repositories/usageEvents.js";

const usageEventSchema = z.object({
  request_id: z.string().min(1).max(200),
  api_key_id: z.string().uuid(),
  endpoint: z.string().min(1).max(200),
  units: z.number().int().positive(),
  timestamp: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid timestamp",
  }),
});

const eventsPayloadSchema = z.object({
  events: z.array(usageEventSchema).min(1).max(1000),
});

export type EventsRouteDependencies = {
  apiKeys: ApiKeyOwnershipLookup;
  usageEvents: UsageEventRepository;
};

export function createPostEventsHandler(dependencies: EventsRouteDependencies) {
  return async function postEvents(req: Request, res: Response) {
    if (!req.customer) {
      res.status(401).json({ error: "missing_customer_context" });
      return;
    }
    const customer = req.customer;

    const parsed = eventsPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_event_batch", details: parsed.error.flatten() });
      return;
    }

    const apiKeyIds = [...new Set(parsed.data.events.map((event) => event.api_key_id))];
    const ownedApiKeyIds = await dependencies.apiKeys.findActiveIdsForCustomer(customer.customerId, apiKeyIds);

    if (apiKeyIds.some((apiKeyId) => !ownedApiKeyIds.has(apiKeyId))) {
      res.status(403).json({ error: "api_key_not_found" });
      return;
    }

    const accepted = await dependencies.usageEvents.insertMany(
      parsed.data.events.map((event) => ({
        requestId: event.request_id,
        customerId: customer.customerId,
        apiKeyId: event.api_key_id,
        endpoint: event.endpoint,
        units: event.units,
        occurredAt: new Date(event.timestamp),
      })),
    );

    res.status(202).json({
      accepted,
      duplicates: parsed.data.events.length - accepted,
    });
  };
}

export function createEventsRouter(dependencies: EventsRouteDependencies) {
  const router = Router();

  router.post("/events", createPostEventsHandler(dependencies));

  return router;
}

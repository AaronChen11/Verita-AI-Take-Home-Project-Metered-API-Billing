import express from "express";
import type { Request, RequestHandler, Response } from "express";

import type { EventsRouteDependencies } from "./routes/events.js";
import { createEventsRouter } from "./routes/events.js";
import type { InvoiceRouteDependencies } from "./routes/invoices.js";
import { createInvoicesRouter } from "./routes/invoices.js";
import type { UsageRouteDependencies } from "./routes/usage.js";
import { createUsageRouter } from "./routes/usage.js";

export function healthHandler(_req: Request, res: Response) {
  res.json({ ok: true });
}

export type AppDependencies = {
  customerApi?: {
    auth: RequestHandler;
    events: EventsRouteDependencies;
    invoices: InvoiceRouteDependencies;
    usage: UsageRouteDependencies;
  };
};

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.get("/health", healthHandler);

  if (dependencies.customerApi) {
    app.use(
      "/v1",
      dependencies.customerApi.auth,
      createEventsRouter(dependencies.customerApi.events),
      createInvoicesRouter(dependencies.customerApi.invoices),
      createUsageRouter(dependencies.customerApi.usage),
    );
  }

  return app;
}

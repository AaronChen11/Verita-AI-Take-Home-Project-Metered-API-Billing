import cors from "cors";
import express from "express";
import type { Request, RequestHandler, Response } from "express";

import type { EventsRouteDependencies } from "./routes/events.js";
import { createEventsRouter } from "./routes/events.js";
import type { InvoiceRouteDependencies } from "./routes/invoices.js";
import { createInvoicesRouter } from "./routes/invoices.js";
import type { OpsRouteDependencies } from "./routes/ops.js";
import { createOpsRouter } from "./routes/ops.js";
import type { PaymentWebhookRouteDependencies } from "./routes/paymentWebhooks.js";
import { createPaymentWebhookRouter } from "./routes/paymentWebhooks.js";
import type { UsageRouteDependencies } from "./routes/usage.js";
import { createUsageRouter } from "./routes/usage.js";

export function healthHandler(_req: Request, res: Response) {
  res.json({ ok: true });
}

export type AppDependencies = {
  frontendUrl?: string;
  customerApi?: {
    auth: RequestHandler;
    events: EventsRouteDependencies;
    invoices: InvoiceRouteDependencies;
    usage: UsageRouteDependencies;
  };
  paymentWebhooks?: PaymentWebhookRouteDependencies;
  opsApi?: {
    auth: RequestHandler;
    ops: OpsRouteDependencies;
  };
};

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();

  app.use(
    cors({
      origin: dependencies.frontendUrl ?? "http://localhost:5173",
      credentials: true,
    }),
  );

  if (dependencies.paymentWebhooks) {
    app.use(
      "/webhooks",
      express.raw({ limit: "1mb", type: "application/json" }),
      createPaymentWebhookRouter(dependencies.paymentWebhooks),
    );
  }

  app.use(express.json({ limit: "1mb" }));
  app.get("/health", healthHandler);

  if (dependencies.opsApi) {
    app.use("/ops", dependencies.opsApi.auth, createOpsRouter(dependencies.opsApi.ops));
  }

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

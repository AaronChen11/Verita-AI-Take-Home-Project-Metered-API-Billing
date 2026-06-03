import express from "express";
import type { Request, RequestHandler, Response } from "express";

import type { EventsRouteDependencies } from "./routes/events.js";
import { createEventsRouter } from "./routes/events.js";

export function healthHandler(_req: Request, res: Response) {
  res.json({ ok: true });
}

export type AppDependencies = {
  events?: {
    auth: RequestHandler;
    routes: EventsRouteDependencies;
  };
};

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.get("/health", healthHandler);

  if (dependencies.events) {
    app.use("/v1", dependencies.events.auth, createEventsRouter(dependencies.events.routes));
  }

  return app;
}

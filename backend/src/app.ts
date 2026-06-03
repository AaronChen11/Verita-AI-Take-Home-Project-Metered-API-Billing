import express from "express";
import type { Request, Response } from "express";

export function healthHandler(_req: Request, res: Response) {
  res.json({ ok: true });
}

export function createApp() {
  const app = express();

  app.get("/health", healthHandler);

  return app;
}

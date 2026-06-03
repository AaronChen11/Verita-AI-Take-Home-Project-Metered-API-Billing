import type { NextFunction, Request, Response } from "express";

import { constantTimeEqual } from "../security/constantTime.js";

export function createOpsAuthMiddleware(sharedSecret: string) {
  return function opsAuth(req: Request, res: Response, next: NextFunction) {
    const token = req.header("x-ops-token");

    if (!token || !constantTimeEqual(token, sharedSecret)) {
      res.status(401).json({ error: "invalid_ops_token" });
      return;
    }

    req.ops = {
      actor: req.header("x-ops-actor") ?? undefined,
    };

    next();
  };
}

export function requireOpsActor(req: Request, res: Response, next: NextFunction) {
  if (!req.ops?.actor) {
    res.status(400).json({ error: "missing_ops_actor" });
    return;
  }

  next();
}

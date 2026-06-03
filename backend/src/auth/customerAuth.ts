import type { NextFunction, Request, Response } from "express";

import { hashApiKey } from "../security/apiKeys.js";

export type ActiveApiKeyRecord = {
  id: string;
  customerId: string;
};

export type ApiKeyLookup = {
  findActiveByHash(keyHash: string): Promise<ActiveApiKeyRecord | undefined>;
};

function parseBearerToken(headerValue: string | undefined) {
  if (!headerValue) {
    return undefined;
  }

  const [scheme, token] = headerValue.split(" ");
  if (scheme !== "Bearer" || !token) {
    return undefined;
  }

  return token;
}

export function createCustomerAuthMiddleware(apiKeys: ApiKeyLookup, pepper: string) {
  return async function customerAuth(req: Request, res: Response, next: NextFunction) {
    const token = parseBearerToken(req.header("authorization"));

    if (!token) {
      res.status(401).json({ error: "missing_bearer_token" });
      return;
    }

    const apiKey = await apiKeys.findActiveByHash(hashApiKey(token, pepper));

    if (!apiKey) {
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }

    req.customer = {
      customerId: apiKey.customerId,
      apiKeyId: apiKey.id,
    };

    next();
  };
}

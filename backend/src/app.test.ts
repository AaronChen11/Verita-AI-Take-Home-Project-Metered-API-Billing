import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";

import { healthHandler } from "./app.js";

describe("healthHandler", () => {
  it("returns an ok payload", () => {
    const payloads: Array<{ ok: boolean }> = [];
    const res = {
      json(payload: { ok: boolean }) {
        payloads.push(payload);
      },
    } as Response;

    healthHandler({} as Request, res);

    expect(payloads).toEqual([{ ok: true }]);
  });
});

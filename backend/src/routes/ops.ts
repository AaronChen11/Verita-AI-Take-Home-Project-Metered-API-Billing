import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import type { CreditRepository } from "../repositories/credits.js";
import { CreditInvoiceNotFoundError } from "../repositories/credits.js";
import type {
  OpsAuditLogEntry,
  OpsCustomerDetail,
  OpsCustomerListCursor,
  OpsCustomerSummary,
  OpsInvoiceSummary,
  OpsReadRepository,
  OpsUsageSummary,
} from "../repositories/opsReads.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const customerListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().optional(),
});

const customerIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const issueCreditBodySchema = z.object({
  invoice_id: z.string().uuid(),
  amount_cents: z.number().int().positive(),
  reason: z.string().trim().min(1),
  idempotency_key: z.string().trim().min(1),
});

export type OpsRouteDependencies = {
  opsReads: OpsReadRepository;
  credits: CreditRepository;
};

export function createListOpsCustomersHandler(dependencies: OpsRouteDependencies) {
  return async function listOpsCustomers(req: Request, res: Response) {
    const parsed = customerListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_ops_customer_query", details: parsed.error.flatten() });
      return;
    }

    const cursor = decodeOpsCustomerCursor(parsed.data.cursor);
    if (parsed.data.cursor && !cursor) {
      res.status(400).json({ error: "invalid_cursor" });
      return;
    }

    const customers = await dependencies.opsReads.listCustomers(parsed.data.limit + 1, cursor);
    const page = customers.slice(0, parsed.data.limit);
    const hasNextPage = customers.length > parsed.data.limit;

    res.json({
      data: page.map(serializeCustomerSummary),
      next_cursor: hasNextPage ? encodeOpsCustomerCursor(page[page.length - 1]) : null,
    });
  };
}

export function createGetOpsCustomerHandler(dependencies: OpsRouteDependencies) {
  return async function getOpsCustomer(req: Request, res: Response) {
    const params = customerIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "invalid_customer_id" });
      return;
    }

    const detail = await dependencies.opsReads.findCustomerDetail(params.data.id);
    if (!detail) {
      res.status(404).json({ error: "customer_not_found" });
      return;
    }

    res.json({ data: serializeCustomerDetail(detail) });
  };
}

export function createIssueCreditHandler(dependencies: OpsRouteDependencies) {
  return async function issueCredit(req: Request, res: Response) {
    if (!req.ops?.actor) {
      res.status(400).json({ error: "missing_ops_actor" });
      return;
    }

    const params = customerIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "invalid_customer_id" });
      return;
    }

    const parsedBody = issueCreditBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: "invalid_credit_request", details: parsedBody.error.flatten() });
      return;
    }

    try {
      const result = await dependencies.credits.issueCredit({
        customerId: params.data.id,
        invoiceId: parsedBody.data.invoice_id,
        amountCents: parsedBody.data.amount_cents,
        reason: parsedBody.data.reason,
        idempotencyKey: parsedBody.data.idempotency_key,
        actor: req.ops.actor,
      });

      res.status(result.duplicate ? 200 : 201).json({
        data: {
          credit_id: result.creditId,
          duplicate: result.duplicate,
          invoice: serializeInvoiceTotals(result.invoice),
        },
      });
    } catch (error) {
      if (error instanceof CreditInvoiceNotFoundError) {
        res.status(404).json({ error: "invoice_not_found" });
        return;
      }

      throw error;
    }
  };
}

export function createOpsRouter(dependencies: OpsRouteDependencies) {
  const router = Router();

  router.get("/customers", createListOpsCustomersHandler(dependencies));
  router.get("/customers/:id", createGetOpsCustomerHandler(dependencies));
  router.post("/customers/:id/credits", createIssueCreditHandler(dependencies));

  return router;
}

export function encodeOpsCustomerCursor(customer: Pick<OpsCustomerSummary, "createdAt" | "id"> | undefined) {
  if (!customer) {
    return null;
  }

  return Buffer.from(JSON.stringify({ created_at: customer.createdAt.toISOString(), id: customer.id }), "utf8").toString(
    "base64url",
  );
}

export function decodeOpsCustomerCursor(cursor: string | undefined): OpsCustomerListCursor | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      created_at?: unknown;
      id?: unknown;
    };
    if (typeof decoded.created_at !== "string" || typeof decoded.id !== "string") {
      return undefined;
    }

    const timestamp = Date.parse(decoded.created_at);
    if (Number.isNaN(timestamp) || !customerIdParamsSchema.shape.id.safeParse(decoded.id).success) {
      return undefined;
    }

    return { createdAt: new Date(timestamp), id: decoded.id };
  } catch {
    return undefined;
  }
}

function serializeCustomerSummary(customer: OpsCustomerSummary) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    price_plan_name: customer.pricePlanName,
    created_at: customer.createdAt.toISOString(),
  };
}

function serializeCustomerDetail(detail: OpsCustomerDetail) {
  return {
    customer: serializeCustomerSummary(detail.customer),
    usage: serializeUsageSummary(detail.usage),
    invoices: detail.invoices.map(serializeInvoiceSummary),
    audit_logs: detail.auditLogs.map(serializeAuditLogEntry),
  };
}

function serializeUsageSummary(usage: OpsUsageSummary) {
  return {
    current_hour_units: usage.currentHourUnits,
    average_hourly_units_last_30_days: usage.averageHourlyUnitsLast30Days,
    anomaly: usage.anomaly,
  };
}

function serializeInvoiceSummary(invoice: OpsInvoiceSummary) {
  return {
    id: invoice.id,
    period_start: invoice.periodStart,
    period_end: invoice.periodEnd,
    status: invoice.status,
    total_cents: invoice.totalCents,
    created_at: invoice.createdAt.toISOString(),
  };
}

function serializeInvoiceTotals(invoice: { id: string; subtotalCents: number; creditsCents: number; totalCents: number }) {
  return {
    id: invoice.id,
    subtotal_cents: invoice.subtotalCents,
    credits_cents: invoice.creditsCents,
    total_cents: invoice.totalCents,
  };
}

function serializeAuditLogEntry(auditLog: OpsAuditLogEntry) {
  return {
    id: auditLog.id,
    actor: auditLog.actor,
    action: auditLog.action,
    entity_type: auditLog.entityType,
    entity_id: auditLog.entityId,
    reason: auditLog.reason,
    created_at: auditLog.createdAt.toISOString(),
  };
}

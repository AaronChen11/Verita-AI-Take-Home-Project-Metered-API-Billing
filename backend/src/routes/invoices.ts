import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import type {
  CustomerInvoiceDetail,
  CustomerInvoiceReadRepository,
  CustomerInvoiceSummary,
  InvoiceListCursor,
} from "../repositories/invoices.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const invoiceListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().optional(),
});

const invoiceIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type InvoiceRouteDependencies = {
  invoices: CustomerInvoiceReadRepository;
};

export function createListInvoicesHandler(dependencies: InvoiceRouteDependencies) {
  return async function listInvoices(req: Request, res: Response) {
    if (!req.customer) {
      res.status(401).json({ error: "missing_customer_context" });
      return;
    }

    const parsed = invoiceListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_invoice_query", details: parsed.error.flatten() });
      return;
    }

    const cursor = decodeInvoiceCursor(parsed.data.cursor);
    if (parsed.data.cursor && !cursor) {
      res.status(400).json({ error: "invalid_cursor" });
      return;
    }

    const invoices = await dependencies.invoices.listForCustomer(
      req.customer.customerId,
      parsed.data.limit + 1,
      cursor,
    );
    const page = invoices.slice(0, parsed.data.limit);
    const hasNextPage = invoices.length > parsed.data.limit;

    res.json({
      data: page.map(serializeInvoiceSummary),
      next_cursor: hasNextPage ? encodeInvoiceCursor(page[page.length - 1]) : null,
    });
  };
}

export function createGetInvoiceHandler(dependencies: InvoiceRouteDependencies) {
  return async function getInvoice(req: Request, res: Response) {
    if (!req.customer) {
      res.status(401).json({ error: "missing_customer_context" });
      return;
    }

    const params = invoiceIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "invalid_invoice_id" });
      return;
    }

    const invoice = await dependencies.invoices.findForCustomer(req.customer.customerId, params.data.id);
    if (!invoice) {
      res.status(404).json({ error: "invoice_not_found" });
      return;
    }

    res.json({ data: serializeInvoiceDetail(invoice) });
  };
}

export function createInvoicesRouter(dependencies: InvoiceRouteDependencies) {
  const router = Router();

  router.get("/invoices", createListInvoicesHandler(dependencies));
  router.get("/invoices/:id", createGetInvoiceHandler(dependencies));

  return router;
}

export function encodeInvoiceCursor(invoice: Pick<CustomerInvoiceSummary, "createdAt" | "id"> | undefined) {
  if (!invoice) {
    return null;
  }

  return Buffer.from(JSON.stringify({ created_at: invoice.createdAt.toISOString(), id: invoice.id }), "utf8").toString(
    "base64url",
  );
}

export function decodeInvoiceCursor(cursor: string | undefined): InvoiceListCursor | undefined {
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
    if (Number.isNaN(timestamp) || !invoiceIdParamsSchema.shape.id.safeParse(decoded.id).success) {
      return undefined;
    }

    return { createdAt: new Date(timestamp), id: decoded.id };
  } catch {
    return undefined;
  }
}

function serializeInvoiceSummary(invoice: CustomerInvoiceSummary) {
  return {
    id: invoice.id,
    period_start: invoice.periodStart,
    period_end: invoice.periodEnd,
    status: invoice.status,
    subtotal_cents: invoice.subtotalCents,
    credits_cents: invoice.creditsCents,
    total_cents: invoice.totalCents,
    issued_at: invoice.issuedAt?.toISOString() ?? null,
    paid_at: invoice.paidAt?.toISOString() ?? null,
    created_at: invoice.createdAt.toISOString(),
  };
}

function serializeInvoiceDetail(invoice: CustomerInvoiceDetail) {
  return {
    ...serializeInvoiceSummary(invoice),
    line_items: invoice.lineItems.map((lineItem) => ({
      id: lineItem.id,
      description: lineItem.description,
      units: lineItem.units,
      unit_price_micros: lineItem.unitPriceMicros,
      amount_cents: lineItem.amountCents,
      is_overridden: lineItem.isOverridden,
    })),
    credits: invoice.credits.map((credit) => ({
      id: credit.id,
      amount_cents: credit.amountCents,
      reason: credit.reason,
      created_by: credit.createdBy,
      created_at: credit.createdAt.toISOString(),
    })),
  };
}

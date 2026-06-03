import type { Pool, PoolClient } from "pg";

export type OverrideLineItemInput = {
  invoiceId: string;
  lineItemId: string;
  amountCents: number;
  reason: string;
  actor: string;
};

export type OverrideLineItemResult = {
  lineItem: {
    id: string;
    amountCents: number;
    isOverridden: boolean;
  };
  invoice: {
    id: string;
    subtotalCents: number;
    creditsCents: number;
    totalCents: number;
  };
};

export type LineItemOverrideRepository = {
  overrideLineItem(input: OverrideLineItemInput): Promise<OverrideLineItemResult>;
};

export class OverrideInvoiceNotFoundError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice not found for line-item override: ${invoiceId}`);
  }
}

export class OverrideLineItemNotFoundError extends Error {
  constructor(lineItemId: string) {
    super(`Line item not found for override: ${lineItemId}`);
  }
}

export class OverridePaidInvoiceError extends Error {
  constructor(invoiceId: string) {
    super(`Paid invoice cannot be directly overridden: ${invoiceId}`);
  }
}

export class PostgresLineItemOverrideRepository implements LineItemOverrideRepository {
  constructor(private readonly pool: Pool) {}

  async overrideLineItem(input: OverrideLineItemInput) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const invoiceBefore = await lockInvoice(client, input.invoiceId);
      if (invoiceBefore.status === "paid") {
        throw new OverridePaidInvoiceError(input.invoiceId);
      }
      if (invoiceBefore.status === "void") {
        throw new OverrideInvoiceNotFoundError(input.invoiceId);
      }

      const lineItemBefore = await lockLineItem(client, input.invoiceId, input.lineItemId);
      const lineItemAfter = await updateLineItem(client, input);
      const invoiceAfter = await recalculateInvoiceTotals(client, input.invoiceId);
      await insertAuditLog(client, {
        actor: input.actor,
        action: "line_item.overridden",
        entityType: "invoice_line_item",
        entityId: input.lineItemId,
        beforeValue: { invoice: invoiceBefore, lineItem: lineItemBefore },
        afterValue: { invoice: invoiceAfter, lineItem: lineItemAfter },
        reason: input.reason,
      });
      await client.query("COMMIT");

      return {
        lineItem: {
          id: lineItemAfter.id,
          amountCents: lineItemAfter.amountCents,
          isOverridden: lineItemAfter.isOverridden,
        },
        invoice: invoiceAfter,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

type InvoiceSnapshot = {
  id: string;
  status: string;
  subtotalCents: number;
  creditsCents: number;
  totalCents: number;
};

type InvoiceRow = {
  id: string;
  status: string;
  subtotal_cents: number;
  credits_cents: number;
  total_cents: number;
};

type LineItemSnapshot = {
  id: string;
  amountCents: number;
  isOverridden: boolean;
};

type LineItemRow = {
  id: string;
  amount_cents: number;
  is_overridden: boolean;
};

async function lockInvoice(client: PoolClient, invoiceId: string) {
  const result = await client.query<InvoiceRow>(
    `
      SELECT id, status, subtotal_cents, credits_cents, total_cents
      FROM invoices
      WHERE id = $1
      FOR UPDATE
    `,
    [invoiceId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new OverrideInvoiceNotFoundError(invoiceId);
  }

  return toInvoiceSnapshot(row);
}

async function lockLineItem(client: PoolClient, invoiceId: string, lineItemId: string) {
  const result = await client.query<LineItemRow>(
    `
      SELECT id, amount_cents, is_overridden
      FROM invoice_line_items
      WHERE id = $1
        AND invoice_id = $2
      FOR UPDATE
    `,
    [lineItemId, invoiceId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new OverrideLineItemNotFoundError(lineItemId);
  }

  return toLineItemSnapshot(row);
}

async function updateLineItem(client: PoolClient, input: OverrideLineItemInput) {
  const result = await client.query<LineItemRow>(
    `
      UPDATE invoice_line_items
      SET
        amount_cents = $3,
        is_overridden = true,
        overridden_at = now(),
        override_reason = $4,
        overridden_by = $5
      WHERE id = $1
        AND invoice_id = $2
      RETURNING id, amount_cents, is_overridden
    `,
    [input.lineItemId, input.invoiceId, input.amountCents, input.reason, input.actor],
  );
  const row = result.rows[0];

  if (!row) {
    throw new OverrideLineItemNotFoundError(input.lineItemId);
  }

  return toLineItemSnapshot(row);
}

async function recalculateInvoiceTotals(client: PoolClient, invoiceId: string) {
  const result = await client.query<InvoiceRow>(
    `
      WITH line_item_totals AS (
        SELECT COALESCE(SUM(amount_cents), 0)::integer AS subtotal_cents
        FROM invoice_line_items
        WHERE invoice_id = $1
      )
      UPDATE invoices
      SET
        subtotal_cents = line_item_totals.subtotal_cents,
        total_cents = GREATEST(line_item_totals.subtotal_cents - credits_cents, 0)
      FROM line_item_totals
      WHERE invoices.id = $1
      RETURNING invoices.id, invoices.status, invoices.subtotal_cents, invoices.credits_cents, invoices.total_cents
    `,
    [invoiceId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new OverrideInvoiceNotFoundError(invoiceId);
  }

  return toInvoiceSnapshot(row);
}

async function insertAuditLog(
  client: PoolClient,
  input: {
    actor: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeValue: unknown;
    afterValue: unknown;
    reason: string;
  },
) {
  await client.query(
    `
      INSERT INTO audit_logs (
        actor,
        action,
        entity_type,
        entity_id,
        before_value,
        after_value,
        reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      input.actor,
      input.action,
      input.entityType,
      input.entityId,
      input.beforeValue,
      input.afterValue,
      input.reason,
    ],
  );
}

function toInvoiceSnapshot(row: InvoiceRow): InvoiceSnapshot {
  return {
    id: row.id,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    creditsCents: row.credits_cents,
    totalCents: row.total_cents,
  };
}

function toLineItemSnapshot(row: LineItemRow): LineItemSnapshot {
  return {
    id: row.id,
    amountCents: row.amount_cents,
    isOverridden: row.is_overridden,
  };
}

import type { Pool, PoolClient } from "pg";

export type IssueCreditInput = {
  customerId: string;
  invoiceId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
  actor: string;
};

export type IssueCreditResult = {
  creditId: string;
  duplicate: boolean;
  invoice: {
    id: string;
    subtotalCents: number;
    creditsCents: number;
    totalCents: number;
  };
};

export type CreditRepository = {
  issueCredit(input: IssueCreditInput): Promise<IssueCreditResult>;
};

export class CreditInvoiceNotFoundError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice not found for credit: ${invoiceId}`);
  }
}

export class CreditVoidInvoiceError extends Error {
  constructor(invoiceId: string) {
    super(`Void invoice cannot receive credits: ${invoiceId}`);
  }
}

export class PostgresCreditRepository implements CreditRepository {
  constructor(private readonly pool: Pool) {}

  async issueCredit(input: IssueCreditInput) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const invoiceBefore = await lockInvoice(client, input.customerId, input.invoiceId);
      const credit = await insertCredit(client, input);

      if (!credit.created) {
        const existingInvoice = await getInvoiceTotals(client, credit.invoiceId);
        await client.query("ROLLBACK");
        return {
          creditId: credit.id,
          duplicate: true,
          invoice: existingInvoice,
        };
      }

      const invoiceAfter = await recalculateInvoiceTotals(client, input.invoiceId);
      await insertAuditLog(client, {
        actor: input.actor,
        action: "credit.created",
        entityType: "invoice",
        entityId: input.invoiceId,
        beforeValue: invoiceBefore,
        afterValue: { ...invoiceAfter, creditId: credit.id, amountCents: input.amountCents },
        reason: input.reason,
      });
      await client.query("COMMIT");

      return {
        creditId: credit.id,
        duplicate: false,
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

type InvoiceTotals = {
  id: string;
  subtotalCents: number;
  creditsCents: number;
  totalCents: number;
};

type InvoiceTotalsRow = {
  id: string;
  status?: string;
  subtotal_cents: number;
  credits_cents: number;
  total_cents: number;
};

type CreditInsertResult = {
  id: string;
  invoiceId: string;
  created: boolean;
};

async function lockInvoice(client: PoolClient, customerId: string, invoiceId: string) {
  const result = await client.query<InvoiceTotalsRow>(
    `
      SELECT id, status, subtotal_cents, credits_cents, total_cents
      FROM invoices
      WHERE id = $1
        AND customer_id = $2
      FOR UPDATE
    `,
    [invoiceId, customerId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new CreditInvoiceNotFoundError(invoiceId);
  }
  if (row.status === "void") {
    throw new CreditVoidInvoiceError(invoiceId);
  }

  return toInvoiceTotals(row);
}

async function insertCredit(client: PoolClient, input: IssueCreditInput): Promise<CreditInsertResult> {
  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO credits (
        customer_id,
        invoice_id,
        amount_cents,
        reason,
        idempotency_key,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (customer_id, idempotency_key) DO NOTHING
      RETURNING id
    `,
    [input.customerId, input.invoiceId, input.amountCents, input.reason, input.idempotencyKey, input.actor],
  );
  const insertedCredit = inserted.rows[0];

  if (insertedCredit) {
    return { id: insertedCredit.id, invoiceId: input.invoiceId, created: true };
  }

  const existing = await client.query<{ id: string; invoice_id: string }>(
    `
      SELECT id, invoice_id
      FROM credits
      WHERE customer_id = $1
        AND idempotency_key = $2
      LIMIT 1
    `,
    [input.customerId, input.idempotencyKey],
  );
  const existingCredit = existing.rows[0];

  if (!existingCredit) {
    throw new Error(`Idempotent credit lookup failed: no row found for key ${input.idempotencyKey}`);
  }

  return { id: existingCredit.id, invoiceId: existingCredit.invoice_id, created: false };
}

async function getInvoiceTotals(client: PoolClient, invoiceId: string) {
  const result = await client.query<InvoiceTotalsRow>(
    `
      SELECT id, subtotal_cents, credits_cents, total_cents
      FROM invoices
      WHERE id = $1
      LIMIT 1
    `,
    [invoiceId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new CreditInvoiceNotFoundError(invoiceId);
  }

  return toInvoiceTotals(row);
}

async function recalculateInvoiceTotals(client: PoolClient, invoiceId: string) {
  const result = await client.query<InvoiceTotalsRow>(
    `
      WITH credit_totals AS (
        SELECT COALESCE(SUM(amount_cents), 0)::bigint AS credits_cents
        FROM credits
        WHERE invoice_id = $1
      )
      UPDATE invoices
      SET
        credits_cents = credit_totals.credits_cents,
        total_cents = GREATEST(subtotal_cents - credit_totals.credits_cents, 0)
      FROM credit_totals
      WHERE invoices.id = $1
      RETURNING invoices.id, invoices.subtotal_cents, invoices.credits_cents, invoices.total_cents
    `,
    [invoiceId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new CreditInvoiceNotFoundError(invoiceId);
  }

  return toInvoiceTotals(row);
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

function toInvoiceTotals(row: InvoiceTotalsRow): InvoiceTotals {
  return {
    id: row.id,
    subtotalCents: row.subtotal_cents,
    creditsCents: row.credits_cents,
    totalCents: row.total_cents,
  };
}

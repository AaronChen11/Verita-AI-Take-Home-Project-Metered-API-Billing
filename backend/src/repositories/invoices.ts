import type { Pool, PoolClient } from "pg";

import type { InvoiceLineCalculation, PriceTier } from "../billing/pricing.js";

export type BillingPeriod = {
  start: string;
  end: string;
};

export type CustomerUsageForInvoice = {
  customerId: string;
  totalUnits: number;
  tiers: PriceTier[];
};

export type InvoiceCreateInput = {
  customerId: string;
  period: BillingPeriod;
  subtotalCents: number;
  lineItems: InvoiceLineCalculation[];
};

export type InvoiceCreateResult = {
  created: boolean;
  invoiceId?: string;
};

export type InvoiceGenerationRepository = {
  listCustomerUsageForPeriod(period: BillingPeriod): Promise<CustomerUsageForInvoice[]>;
  createDraftInvoiceIfNotExists(input: InvoiceCreateInput): Promise<InvoiceCreateResult>;
};

export type CustomerInvoiceSummary = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  subtotalCents: number;
  creditsCents: number;
  totalCents: number;
  issuedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
};

export type CustomerInvoiceLineItem = {
  id: string;
  description: string;
  units: number;
  unitPriceMicros: number;
  amountCents: number;
  isOverridden: boolean;
};

export type CustomerInvoiceCredit = {
  id: string;
  amountCents: number;
  reason: string;
  createdBy: string;
  createdAt: Date;
};

export type CustomerInvoiceDetail = CustomerInvoiceSummary & {
  lineItems: CustomerInvoiceLineItem[];
  credits: CustomerInvoiceCredit[];
};

export type InvoiceListCursor = {
  createdAt: Date;
  id: string;
};

export type CustomerInvoiceReadRepository = {
  listForCustomer(customerId: string, limit: number, cursor?: InvoiceListCursor): Promise<CustomerInvoiceSummary[]>;
  findForCustomer(customerId: string, invoiceId: string): Promise<CustomerInvoiceDetail | undefined>;
};

export class PostgresInvoiceRepository implements InvoiceGenerationRepository, CustomerInvoiceReadRepository {
  constructor(private readonly pool: Pool) {}

  async listForCustomer(customerId: string, limit: number, cursor?: InvoiceListCursor) {
    const cursorFilter = cursor ? "AND (created_at, id) < ($3, $4)" : "";
    const values = cursor ? [customerId, limit, cursor.createdAt, cursor.id] : [customerId, limit];
    const result = await this.pool.query<InvoiceRow>(
      `
        SELECT
          id,
          period_start,
          period_end,
          status,
          subtotal_cents,
          credits_cents,
          total_cents,
          issued_at,
          paid_at,
          created_at
        FROM invoices
        WHERE customer_id = $1
          ${cursorFilter}
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `,
      values,
    );

    return result.rows.map(toInvoiceSummary);
  }

  async findForCustomer(customerId: string, invoiceId: string) {
    const invoiceResult = await this.pool.query<InvoiceRow>(
      `
        SELECT
          id,
          period_start,
          period_end,
          status,
          subtotal_cents,
          credits_cents,
          total_cents,
          issued_at,
          paid_at,
          created_at
        FROM invoices
        WHERE customer_id = $1
          AND id = $2
        LIMIT 1
      `,
      [customerId, invoiceId],
    );
    const invoice = invoiceResult.rows[0];

    if (!invoice) {
      return undefined;
    }

    const [lineItemsResult, creditsResult] = await Promise.all([
      this.pool.query<InvoiceLineItemRow>(
        `
          SELECT
            id,
            description,
            units,
            unit_price_micros,
            amount_cents,
            is_overridden
          FROM invoice_line_items
          WHERE invoice_id = $1
          ORDER BY created_at ASC, id ASC
        `,
        [invoiceId],
      ),
      this.pool.query<InvoiceCreditRow>(
        `
          SELECT
            id,
            amount_cents,
            reason,
            created_by,
            created_at
          FROM credits
          WHERE invoice_id = $1
          ORDER BY created_at ASC, id ASC
        `,
        [invoiceId],
      ),
    ]);

    return {
      ...toInvoiceSummary(invoice),
      lineItems: lineItemsResult.rows.map(toInvoiceLineItem),
      credits: creditsResult.rows.map(toInvoiceCredit),
    };
  }

  async listCustomerUsageForPeriod(period: BillingPeriod) {
    const result = await this.pool.query<CustomerUsageRow>(
      `
        WITH period_usage AS (
          SELECT
            customer_id,
            SUM(total_units)::integer AS total_units
          FROM usage_windows
          WHERE window_start >= $1
            AND window_start < $2
          GROUP BY customer_id
        ),
        plan_tiers AS (
          SELECT
            price_plan_id,
            jsonb_agg(
              jsonb_build_object(
                'minUnits', min_units,
                'maxUnits', max_units,
                'unitPriceMicros', unit_price_micros
              )
              ORDER BY min_units
            ) AS tiers
          FROM price_tiers
          GROUP BY price_plan_id
        )
        SELECT
          customers.id AS customer_id,
          COALESCE(period_usage.total_units, 0)::integer AS total_units,
          plan_tiers.tiers AS tiers
        FROM customers
        JOIN plan_tiers
          ON plan_tiers.price_plan_id = customers.price_plan_id
        LEFT JOIN period_usage
          ON period_usage.customer_id = customers.id
        ORDER BY customers.id
      `,
      [period.start, period.end],
    );

    return result.rows.map((row) => ({
      customerId: row.customer_id,
      totalUnits: row.total_units,
      tiers: row.tiers.map((tier) => ({
        minUnits: Number(tier.minUnits),
        maxUnits: tier.maxUnits === null ? null : Number(tier.maxUnits),
        unitPriceMicros: Number(tier.unitPriceMicros),
      })),
    }));
  }

  async createDraftInvoiceIfNotExists(input: InvoiceCreateInput) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const invoice = await insertInvoice(client, input);

      if (!invoice) {
        await client.query("ROLLBACK");
        return { created: false };
      }

      await insertLineItems(client, invoice.id, input.lineItems);
      await client.query("COMMIT");

      return { created: true, invoiceId: invoice.id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

type CustomerUsageRow = {
  customer_id: string;
  total_units: number;
  tiers: Array<{
    minUnits: number | string;
    maxUnits: number | string | null;
    unitPriceMicros: number | string;
  }>;
};

type InvoiceRow = {
  id: string;
  period_start: Date | string;
  period_end: Date | string;
  status: string;
  subtotal_cents: number;
  credits_cents: number;
  total_cents: number;
  issued_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
};

type InvoiceLineItemRow = {
  id: string;
  description: string;
  units: number;
  unit_price_micros: number | string;
  amount_cents: number;
  is_overridden: boolean;
};

type InvoiceCreditRow = {
  id: string;
  amount_cents: number;
  reason: string;
  created_by: string;
  created_at: Date;
};

function toInvoiceSummary(row: InvoiceRow): CustomerInvoiceSummary {
  return {
    id: row.id,
    periodStart: toDateOnly(row.period_start),
    periodEnd: toDateOnly(row.period_end),
    status: row.status,
    subtotalCents: row.subtotal_cents,
    creditsCents: row.credits_cents,
    totalCents: row.total_cents,
    issuedAt: row.issued_at,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

function toInvoiceLineItem(row: InvoiceLineItemRow): CustomerInvoiceLineItem {
  return {
    id: row.id,
    description: row.description,
    units: row.units,
    unitPriceMicros: Number(row.unit_price_micros),
    amountCents: row.amount_cents,
    isOverridden: row.is_overridden,
  };
}

function toInvoiceCredit(row: InvoiceCreditRow): CustomerInvoiceCredit {
  return {
    id: row.id,
    amountCents: row.amount_cents,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toDateOnly(value: Date | string) {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

async function insertInvoice(client: PoolClient, input: InvoiceCreateInput) {
  const totalCents = input.subtotalCents;
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO invoices (
        customer_id,
        period_start,
        period_end,
        status,
        subtotal_cents,
        credits_cents,
        total_cents
      )
      VALUES ($1, $2, $3, 'draft', $4, 0, $5)
      ON CONFLICT (customer_id, period_start, period_end) DO NOTHING
      RETURNING id
    `,
    [input.customerId, input.period.start, input.period.end, input.subtotalCents, totalCents],
  );

  return result.rows[0];
}

async function insertLineItems(client: PoolClient, invoiceId: string, lineItems: readonly InvoiceLineCalculation[]) {
  if (lineItems.length === 0) {
    return;
  }

  const values: unknown[] = [];
  const rows = lineItems.map((lineItem, index) => {
    const offset = index * 5;
    values.push(invoiceId, lineItem.description, lineItem.units, lineItem.unitPriceMicros, lineItem.amountCents);

    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
  });

  await client.query(
    `
      INSERT INTO invoice_line_items (
        invoice_id,
        description,
        units,
        unit_price_micros,
        amount_cents
      )
      VALUES ${rows.join(", ")}
    `,
    values,
  );
}

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

export class PostgresInvoiceRepository implements InvoiceGenerationRepository {
  constructor(private readonly pool: Pool) {}

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

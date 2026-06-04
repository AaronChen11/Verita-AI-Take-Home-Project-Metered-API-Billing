import type { Pool } from "pg";

export type OpsCustomerListCursor = {
  createdAt: Date;
  id: string;
};

export type OpsCustomerSummary = {
  id: string;
  name: string;
  email: string;
  pricePlanName: string;
  createdAt: Date;
};

export type OpsUsageSummary = {
  currentHourUnits: number;
  averageHourlyUnitsLast30Days: number;
  anomaly: boolean;
};

export type OpsInvoiceSummary = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalCents: number;
  createdAt: Date;
  lineItems: OpsInvoiceLineItem[];
};

export type OpsInvoiceLineItem = {
  id: string;
  description: string;
  amountCents: number;
  isOverridden: boolean;
};

export type OpsAuditLogEntry = {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  beforeValue: unknown;
  afterValue: unknown;
  createdAt: Date;
};

export type OpsCustomerDetail = {
  customer: OpsCustomerSummary;
  usage: OpsUsageSummary;
  invoices: OpsInvoiceSummary[];
  auditLogs: OpsAuditLogEntry[];
};

export type OpsReadRepository = {
  listCustomers(limit: number, cursor?: OpsCustomerListCursor): Promise<OpsCustomerSummary[]>;
  findCustomerDetail(customerId: string): Promise<OpsCustomerDetail | undefined>;
};

export class PostgresOpsReadRepository implements OpsReadRepository {
  constructor(private readonly pool: Pool) {}

  async listCustomers(limit: number, cursor?: OpsCustomerListCursor) {
    const cursorFilter = cursor ? "AND (customers.created_at, customers.id) < ($2, $3)" : "";
    const values = cursor ? [limit, cursor.createdAt, cursor.id] : [limit];
    const result = await this.pool.query<OpsCustomerRow>(
      `
        SELECT
          customers.id,
          customers.name,
          customers.email,
          price_plans.name AS price_plan_name,
          customers.created_at
        FROM customers
        JOIN price_plans
          ON price_plans.id = customers.price_plan_id
        WHERE true
          ${cursorFilter}
        ORDER BY customers.created_at DESC, customers.id DESC
        LIMIT $1
      `,
      values,
    );

    return result.rows.map(toOpsCustomerSummary);
  }

  async findCustomerDetail(customerId: string) {
    const customerResult = await this.pool.query<OpsCustomerRow>(
      `
        SELECT
          customers.id,
          customers.name,
          customers.email,
          price_plans.name AS price_plan_name,
          customers.created_at
        FROM customers
        JOIN price_plans
          ON price_plans.id = customers.price_plan_id
        WHERE customers.id = $1
        LIMIT 1
      `,
      [customerId],
    );
    const customer = customerResult.rows[0];

    if (!customer) {
      return undefined;
    }

    const [usageResult, invoicesResult, auditLogsResult] = await Promise.all([
      this.pool.query<OpsUsageSummaryRow>(
        `
          WITH current_hour AS (
            SELECT COALESCE(SUM(total_units), 0)::integer AS units
            FROM usage_windows
            WHERE customer_id = $1
              AND window_start = date_trunc('hour', now())
          ),
          historical_hours AS (
            SELECT COALESCE(AVG(total_units), 0)::numeric AS average_units
            FROM usage_windows
            WHERE customer_id = $1
              AND window_start >= now() - interval '30 days'
              AND window_start < date_trunc('hour', now())
          )
          SELECT
            current_hour.units AS current_hour_units,
            historical_hours.average_units AS average_hourly_units_last_30_days
          FROM current_hour, historical_hours
        `,
        [customerId],
      ),
      this.pool.query<OpsInvoiceRow>(
        `
          SELECT
            invoices.id,
            invoices.period_start,
            invoices.period_end,
            invoices.status,
            invoices.total_cents,
            invoices.created_at,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'id', invoice_line_items.id,
                  'description', invoice_line_items.description,
                  'amount_cents', invoice_line_items.amount_cents,
                  'is_overridden', invoice_line_items.is_overridden
                )
                ORDER BY invoice_line_items.created_at, invoice_line_items.id
              ) FILTER (WHERE invoice_line_items.id IS NOT NULL),
              '[]'::jsonb
            ) AS line_items
          FROM invoices
          LEFT JOIN invoice_line_items
            ON invoice_line_items.invoice_id = invoices.id
          WHERE invoices.customer_id = $1
          GROUP BY invoices.id
          ORDER BY invoices.created_at DESC, invoices.id DESC
          LIMIT 10
        `,
        [customerId],
      ),
      this.pool.query<OpsAuditLogRow>(
        `
          SELECT
            audit_logs.id,
            audit_logs.actor,
            audit_logs.action,
            audit_logs.entity_type,
            audit_logs.entity_id,
            audit_logs.reason,
            audit_logs.before_value,
            audit_logs.after_value,
            audit_logs.created_at
          FROM audit_logs
          WHERE audit_logs.entity_id = $1
             OR audit_logs.entity_id IN (
               SELECT invoices.id
               FROM invoices
               WHERE invoices.customer_id = $1
             )
             OR audit_logs.entity_id IN (
               SELECT invoice_line_items.id
               FROM invoice_line_items
               JOIN invoices
                 ON invoices.id = invoice_line_items.invoice_id
               WHERE invoices.customer_id = $1
             )
          ORDER BY audit_logs.created_at DESC, audit_logs.id DESC
          LIMIT 20
        `,
        [customerId],
      ),
    ]);

    return {
      customer: toOpsCustomerSummary(customer),
      usage: toOpsUsageSummary(usageResult.rows[0]),
      invoices: invoicesResult.rows.map(toOpsInvoiceSummary),
      auditLogs: auditLogsResult.rows.map(toOpsAuditLogEntry),
    };
  }
}

type OpsCustomerRow = {
  id: string;
  name: string;
  email: string;
  price_plan_name: string;
  created_at: Date;
};

type OpsUsageSummaryRow = {
  current_hour_units: number | string;
  average_hourly_units_last_30_days: number | string;
};

type OpsInvoiceRow = {
  id: string;
  period_start: Date | string;
  period_end: Date | string;
  status: string;
  total_cents: number;
  created_at: Date;
  line_items: OpsInvoiceLineItemRow[] | string;
};

type OpsAuditLogRow = {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  before_value: unknown;
  after_value: unknown;
  created_at: Date;
};

type OpsInvoiceLineItemRow = {
  id: string;
  description: string;
  amount_cents: number;
  is_overridden: boolean;
};

function toOpsCustomerSummary(row: OpsCustomerRow): OpsCustomerSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    pricePlanName: row.price_plan_name,
    createdAt: row.created_at,
  };
}

function toOpsUsageSummary(row: OpsUsageSummaryRow | undefined): OpsUsageSummary {
  const currentHourUnits = Number(row?.current_hour_units ?? 0);
  const averageHourlyUnitsLast30Days = Number(row?.average_hourly_units_last_30_days ?? 0);

  return {
    currentHourUnits,
    averageHourlyUnitsLast30Days,
    anomaly: averageHourlyUnitsLast30Days > 0 && currentHourUnits > averageHourlyUnitsLast30Days * 10,
  };
}

function toOpsInvoiceSummary(row: OpsInvoiceRow): OpsInvoiceSummary {
  return {
    id: row.id,
    periodStart: toDateOnly(row.period_start),
    periodEnd: toDateOnly(row.period_end),
    status: row.status,
    totalCents: row.total_cents,
    createdAt: row.created_at,
    lineItems: parseLineItems(row.line_items),
  };
}

function toOpsAuditLogEntry(row: OpsAuditLogRow): OpsAuditLogEntry {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    reason: row.reason,
    beforeValue: row.before_value,
    afterValue: row.after_value,
    createdAt: row.created_at,
  };
}

function parseLineItems(value: OpsInvoiceLineItemRow[] | string): OpsInvoiceLineItem[] {
  const rows = typeof value === "string" ? (JSON.parse(value) as OpsInvoiceLineItemRow[]) : value;

  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    amountCents: row.amount_cents,
    isOverridden: row.is_overridden,
  }));
}

function toDateOnly(value: Date | string) {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

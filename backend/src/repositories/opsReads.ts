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
};

export type OpsAuditLogEntry = {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
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
    const limitParam = cursor ? "$1" : "$1";
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
        LIMIT ${limitParam}
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
            id,
            period_start,
            period_end,
            status,
            total_cents,
            created_at
          FROM invoices
          WHERE customer_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 10
        `,
        [customerId],
      ),
      this.pool.query<OpsAuditLogRow>(
        `
          SELECT
            id,
            actor,
            action,
            entity_type,
            entity_id,
            reason,
            created_at
          FROM audit_logs
          WHERE entity_id = $1
          ORDER BY created_at DESC, id DESC
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
};

type OpsAuditLogRow = {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  created_at: Date;
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
    createdAt: row.created_at,
  };
}

function toDateOnly(value: Date | string) {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

export type UsageGranularity = 'hour' | 'day'

export type UsageBucket = {
  bucket_start: string
  bucket_end: string
  granularity: UsageGranularity
  total_units: number
}

export type InvoiceSummary = {
  id: string
  period_start: string
  period_end: string
  status: string
  subtotal_cents: number
  credits_cents: number
  total_cents: number
  issued_at: string | null
  paid_at: string | null
  created_at: string
}

export type InvoiceDetail = InvoiceSummary & {
  line_items: Array<{
    id: string
    description: string
    units: number
    unit_price_micros: number
    amount_cents: number
    is_overridden: boolean
  }>
  credits: Array<{
    id: string
    amount_cents: number
    reason: string
    created_by: string
    created_at: string
  }>
}

export type OpsCustomerSummary = {
  id: string
  name: string
  email: string
  price_plan_name: string
  created_at: string
}

export type OpsCustomerDetail = {
  customer: OpsCustomerSummary
  usage: {
    current_hour_units: number
    average_hourly_units_last_30_days: number
    anomaly: boolean
  }
  invoices: Array<{
    id: string
    period_start: string
    period_end: string
    status: string
    total_cents: number
    created_at: string
    line_items: Array<{
      id: string
      description: string
      amount_cents: number
      is_overridden: boolean
    }>
  }>
  audit_logs: Array<{
    id: string
    actor: string
    action: string
    entity_type: string
    entity_id: string
    reason: string
    before_value: unknown
    after_value: unknown
    created_at: string
  }>
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

export async function fetchUsage(token: string, granularity: UsageGranularity) {
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(end.getUTCDate() - 7)

  return apiGet<{ data: UsageBucket[]; next_cursor: string | null }>(
    `/v1/usage?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(
      end.toISOString(),
    )}&granularity=${granularity}&limit=168`,
    token,
  )
}

export async function fetchInvoices(token: string) {
  return apiGet<{ data: InvoiceSummary[]; next_cursor: string | null }>('/v1/invoices?limit=12', token)
}

export async function fetchInvoiceDetail(token: string, invoiceId: string) {
  return apiGet<{ data: InvoiceDetail }>(`/v1/invoices/${invoiceId}`, token)
}

export async function fetchOpsCustomers(opsToken: string) {
  return opsGet<{ data: OpsCustomerSummary[]; next_cursor: string | null }>('/ops/customers?limit=50', opsToken)
}

export async function fetchOpsCustomerDetail(opsToken: string, customerId: string) {
  return opsGet<{ data: OpsCustomerDetail }>(`/ops/customers/${customerId}`, opsToken)
}

export async function issueOpsCredit(
  opsToken: string,
  actor: string,
  customerId: string,
  input: { invoiceId: string; amountCents: number; reason: string; idempotencyKey: string },
) {
  return opsJson<{ data: { credit_id: string; duplicate: boolean; invoice: InvoiceTotals } }>(
    `/ops/customers/${customerId}/credits`,
    opsToken,
    actor,
    'POST',
    {
      invoice_id: input.invoiceId,
      amount_cents: input.amountCents,
      reason: input.reason,
      idempotency_key: input.idempotencyKey,
    },
  )
}

export async function overrideOpsLineItem(
  opsToken: string,
  actor: string,
  input: { invoiceId: string; lineItemId: string; amountCents: number; reason: string },
) {
  return opsJson<{ data: { line_item: { id: string; amount_cents: number; is_overridden: boolean }; invoice: InvoiceTotals } }>(
    `/ops/invoices/${input.invoiceId}/line-items/${input.lineItemId}`,
    opsToken,
    actor,
    'PATCH',
    {
      amount_cents: input.amountCents,
      reason: input.reason,
    },
  )
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined)
    const message = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : response.statusText
    throw new Error(message)
  }

  return (await response.json()) as T
}

async function opsGet<T>(path: string, opsToken: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'X-Ops-Token': opsToken,
    },
  })

  return parseResponse<T>(response)
}

async function opsJson<T>(
  path: string,
  opsToken: string,
  actor: string,
  method: 'PATCH' | 'POST',
  body: unknown,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'X-Ops-Actor': actor,
      'X-Ops-Token': opsToken,
    },
    method,
  })

  return parseResponse<T>(response)
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined)
    const message = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : response.statusText
    throw new Error(message)
  }

  return (await response.json()) as T
}

export function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    style: 'currency',
  }).format(cents / 100)
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

type InvoiceTotals = {
  id: string
  subtotal_cents: number
  credits_cents: number
  total_cents: number
}

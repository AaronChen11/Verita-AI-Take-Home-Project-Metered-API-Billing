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

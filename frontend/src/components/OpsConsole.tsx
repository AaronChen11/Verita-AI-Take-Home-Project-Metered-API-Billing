import { useEffect, useState } from 'react'

import {
  fetchOpsCustomerDetail,
  fetchOpsCustomers,
  formatDate,
  formatMoney,
  formatUnitPrice,
  issueOpsCredit,
  overrideOpsLineItem,
} from '../lib/api'
import type { OpsCustomerDetail, OpsCustomerSummary } from '../lib/api'

type OpsConsoleProps = {
  actor: string
  opsToken: string
}

export function OpsConsole({ actor, opsToken }: OpsConsoleProps) {
  const [customers, setCustomers] = useState<OpsCustomerSummary[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [detail, setDetail] = useState<OpsCustomerDetail | null>(null)
  const [anomalyMap, setAnomalyMap] = useState<Map<string, boolean>>(new Map())
  const [creditForm, setCreditForm] = useState({ amountCents: '500', invoiceId: '', reason: '', idempotencyKey: '' })
  const [overrideForm, setOverrideForm] = useState({ amountCents: '', invoiceId: '', lineItemId: '', reason: '' })
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadCustomers() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetchOpsCustomers(opsToken)
        if (cancelled) return

        setCustomers(response.data)
        setSelectedCustomerId((current) =>
          current && response.data.some((customer) => customer.id === current) ? current : (response.data[0]?.id ?? null),
        )
        if (response.data.length === 0) {
          setDetail(null)
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load ops customers')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadCustomers()

    return () => {
      cancelled = true
    }
  }, [opsToken])

  useEffect(() => {
    if (selectedCustomerId === null) {
      return
    }
    const customerId: string = selectedCustomerId
    let cancelled = false

    async function loadCustomerDetail() {
      setIsLoadingDetail(true)
      setError(null)
      try {
        const response = await fetchOpsCustomerDetail(opsToken, customerId)
        if (cancelled) return

        setDetail(response.data)
        setAnomalyMap((prev) => new Map(prev).set(customerId, response.data.usage.anomaly))
        setCreditForm((current) => ({
          ...current,
          invoiceId: current.invoiceId || response.data.invoices[0]?.id || '',
          idempotencyKey: current.idempotencyKey || `credit-${Date.now()}`,
        }))
        setOverrideForm((current) => ({
          ...current,
          invoiceId: current.invoiceId || response.data.invoices.find((invoice) => invoice.status !== 'paid')?.id || '',
        }))
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load customer detail')
        }
      } finally {
        if (!cancelled) setIsLoadingDetail(false)
      }
    }

    void loadCustomerDetail()

    return () => {
      cancelled = true
    }
  }, [opsToken, selectedCustomerId])

  async function refreshDetail() {
    if (!selectedCustomerId) return
    const response = await fetchOpsCustomerDetail(opsToken, selectedCustomerId)
    setDetail(response.data)
  }

  async function submitCredit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedCustomerId) return
    if (
      !window.confirm(
        `Issue credit of ${formatMoney(Number(creditForm.amountCents))} to invoice ${creditForm.invoiceId}?\n\nReason: ${creditForm.reason}`,
      )
    ) {
      return
    }
    setMessage(null)
    setError(null)
    try {
      const response = await issueOpsCredit(opsToken, actor, selectedCustomerId, {
        amountCents: Number(creditForm.amountCents),
        idempotencyKey: creditForm.idempotencyKey,
        invoiceId: creditForm.invoiceId,
        reason: creditForm.reason,
      })
      setMessage(`Credit ${response.data.credit_id} applied. New total: ${formatMoney(response.data.invoice.total_cents)}.`)
      await refreshDetail()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Credit failed')
    }
  }

  async function submitOverride(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !window.confirm(
        `Override line item ${overrideForm.lineItemId} to ${formatMoney(Number(overrideForm.amountCents))}?\n\nReason: ${overrideForm.reason}`,
      )
    ) {
      return
    }
    setMessage(null)
    setError(null)
    try {
      const response = await overrideOpsLineItem(opsToken, actor, {
        amountCents: Number(overrideForm.amountCents),
        invoiceId: overrideForm.invoiceId,
        lineItemId: overrideForm.lineItemId,
        reason: overrideForm.reason,
      })
      setMessage(`Line item overridden. Invoice total is now ${formatMoney(response.data.invoice.total_cents)}.`)
      await refreshDetail()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Override failed')
    }
  }

  const anomalyCount = [...anomalyMap.values()].filter(Boolean).length
  const reviewedCount = anomalyMap.size

  const heroStatus = anomalyCount > 0
    ? `${anomalyCount} customer${anomalyCount > 1 ? 's' : ''} showing abnormal usage — review before billing.`
    : reviewedCount > 0
      ? 'All reviewed customers within normal usage range.'
      : 'Select a customer to begin inspection.'

  return (
    <main className="dashboard-shell ops-shell">
      <section className="hero-card ops-hero">
        <div className="hero-cycle">
          <p className="eyebrow">— Ops console · {actor}</p>

          <div className="cycle-amount-row">
            <span className="cycle-amount">{customers.length}</span>
            <span className="cycle-meta">customers</span>
          </div>

          <div className="ops-hero-stats">
            <div className="ops-hero-stat">
              <span className="ops-hero-stat-value">{reviewedCount}</span>
              <span className="ops-hero-stat-label">reviewed</span>
            </div>
            <div className={`ops-hero-stat${anomalyCount > 0 ? ' ops-hero-stat-warning' : ''}`}>
              <span className="ops-hero-stat-value">{anomalyCount}</span>
              <span className="ops-hero-stat-label">{anomalyCount === 1 ? 'anomaly' : 'anomalies'}</span>
            </div>
          </div>

          <p className="cycle-status">{heroStatus}</p>
        </div>
      </section>

      {error ? <div className="banner error">{error}</div> : null}
      {message ? <div className="banner success">{message}</div> : null}
      {isLoading ? <div className="banner">Loading ops state...</div> : null}

      <section className="ops-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">— Customers</p>
              <h2>Tenant list</h2>
            </div>
            <span className="pill">{customers.length}</span>
          </div>
          <div className="invoice-rows">
            {customers.map((customer) => (
              <button
                className={customer.id === selectedCustomerId ? 'invoice-row selected' : 'invoice-row'}
                key={customer.id}
                onClick={() => {
                  setSelectedCustomerId(customer.id)
                }}
                type="button"
              >
                <span>{customer.name}</span>
                <strong>{customer.price_plan_name}</strong>
                <em>{customer.email}</em>
              </button>
            ))}
          </div>
        </div>

        <div className={`panel${isLoadingDetail ? ' panel-refreshing' : ''}`}>
          <p className="eyebrow">— Usage signal</p>
          {!detail ? (
            <p className="muted">Select a customer to view operational signals.</p>
          ) : (
            <div className="ops-metrics">
              <div>
                <span>Current hour</span>
                <strong>{detail.usage.current_hour_units.toLocaleString()}</strong>
              </div>
              <div>
                <span>30-day avg hour</span>
                <strong>{Math.round(detail.usage.average_hourly_units_last_30_days).toLocaleString()}</strong>
              </div>
              <div className={detail.usage.anomaly ? 'danger-metric' : ''}>
                <span>Anomaly</span>
                <strong>{detail.usage.anomaly ? '10x+' : 'Normal'}</strong>
              </div>
            </div>
          )}
        </div>
      </section>

      {detail ? (
        <section className="ops-grid">
          <div className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">— Invoices</p>
                <h2>{detail.customer.name}</h2>
                <p className="muted">Invoices are generated from hourly usage windows by the invoice generation job.</p>
              </div>
            </div>
            <div className="invoice-rows">
              {detail.invoices.map((invoice) => (
                <div className="invoice-row" key={invoice.id}>
                  <span>
                    {formatDate(invoice.period_start)} - {formatDate(invoice.period_end)}
                    <code>{invoice.id}</code>
                  </span>
                  <strong>{formatMoney(invoice.total_cents)}</strong>
                  <em>{invoice.status}</em>
                  <div className="invoice-line-items">
                    {invoice.line_items.length === 0 ? <small>No line items</small> : null}
                    {invoice.line_items.map((lineItem) => (
                      <button
                        key={lineItem.id}
                        onClick={() => {
                          setCreditForm((current) => ({ ...current, invoiceId: invoice.id }))
                          setOverrideForm((current) => ({
                            ...current,
                            amountCents: current.amountCents || String(lineItem.amount_cents),
                            invoiceId: invoice.id,
                            lineItemId: lineItem.id,
                          }))
                        }}
                        type="button"
                      >
                        <span>
                          {lineItem.description}
                          <small>
                            {lineItem.units.toLocaleString()} units × {formatUnitPrice(lineItem.unit_price_micros)}
                          </small>
                        </span>
                        <code>{lineItem.id}</code>
                        <strong>{formatMoney(lineItem.amount_cents)}</strong>
                        {lineItem.is_overridden ? <em>overridden</em> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel ops-actions">
            <form onSubmit={submitCredit}>
              <p className="eyebrow">— Credit</p>
              <input aria-label="Credit invoice id" onChange={(event) => setCreditForm({ ...creditForm, invoiceId: event.target.value })} placeholder="invoice_id" value={creditForm.invoiceId} />
              <input aria-label="Credit amount cents" onChange={(event) => setCreditForm({ ...creditForm, amountCents: event.target.value })} placeholder="amount_cents" type="number" value={creditForm.amountCents} />
              <input aria-label="Credit reason" onChange={(event) => setCreditForm({ ...creditForm, reason: event.target.value })} placeholder="reason" value={creditForm.reason} />
              <input aria-label="Credit idempotency key" onChange={(event) => setCreditForm({ ...creditForm, idempotencyKey: event.target.value })} placeholder="idempotency_key" value={creditForm.idempotencyKey} />
              <button type="submit">Issue credit</button>
            </form>

            <form onSubmit={submitOverride}>
              <p className="eyebrow">— Line-item override</p>
              <input aria-label="Override invoice id" onChange={(event) => setOverrideForm({ ...overrideForm, invoiceId: event.target.value })} placeholder="invoice_id" value={overrideForm.invoiceId} />
              <input aria-label="Override line item id" onChange={(event) => setOverrideForm({ ...overrideForm, lineItemId: event.target.value })} placeholder="line_item_id" value={overrideForm.lineItemId} />
              <input aria-label="Override amount cents" onChange={(event) => setOverrideForm({ ...overrideForm, amountCents: event.target.value })} placeholder="amount_cents" type="number" value={overrideForm.amountCents} />
              <input aria-label="Override reason" onChange={(event) => setOverrideForm({ ...overrideForm, reason: event.target.value })} placeholder="reason" value={overrideForm.reason} />
              <button type="submit">Override line item</button>
              <p className="muted">Paid invoices are rejected; use credits for post-payment corrections.</p>
            </form>
          </div>
        </section>
      ) : null}

      {detail ? (
        <section className="panel">
          <p className="eyebrow">— Audit trail</p>
          <div className="audit-list">
            {detail.audit_logs.length === 0 ? <p className="muted">No audit entries yet.</p> : null}
            {detail.audit_logs.map((entry) => (
              <div className="audit-row" key={entry.id}>
                <strong>{entry.action}</strong>
                <span>{entry.actor}</span>
                <span>{entry.reason}</span>
                <em>{formatDate(entry.created_at)}</em>
                <details>
                  <summary>before / after</summary>
                  <pre>{JSON.stringify({ before: entry.before_value, after: entry.after_value }, null, 2)}</pre>
                </details>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}

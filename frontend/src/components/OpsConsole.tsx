import { useEffect, useMemo, useState } from 'react'

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
import './OpsConsole.css'

type OpsConsoleProps = {
  actor: string
  opsToken: string
}

function shortId(id: string) {
  if (id.length <= 16) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

function formatPeriod(value: string | null) {
  if (!value) return 'current period'

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export function OpsConsole({ actor, opsToken }: OpsConsoleProps) {
  const [customers, setCustomers] = useState<OpsCustomerSummary[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [detail, setDetail] = useState<OpsCustomerDetail | null>(null)
  const [detailCache, setDetailCache] = useState<Map<string, OpsCustomerDetail>>(new Map())
  const [anomalyMap, setAnomalyMap] = useState<Map<string, boolean>>(new Map())
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null)
  const [adjustmentTab, setAdjustmentTab] = useState<'credit' | 'override'>('credit')
  const [pickedLineItemId, setPickedLineItemId] = useState<string | null>(null)
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
    if (customers.length === 0) return
    let cancelled = false

    async function loadPortfolioDetails() {
      const results = await Promise.allSettled(
        customers.map(async (customer) => fetchOpsCustomerDetail(opsToken, customer.id)),
      )
      if (cancelled) return

      const nextCache = new Map<string, OpsCustomerDetail>()
      const nextAnomalyMap = new Map<string, boolean>()
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return
        const customerId = customers[index]?.id
        if (!customerId) return

        nextCache.set(customerId, result.value.data)
        nextAnomalyMap.set(customerId, result.value.data.usage.anomaly)
      })

      setDetailCache(nextCache)
      setAnomalyMap(nextAnomalyMap)
      setDetail((current) => {
        if (!current) return current
        return nextCache.get(current.customer.id) ?? current
      })
    }

    void loadPortfolioDetails()

    return () => {
      cancelled = true
    }
  }, [customers, opsToken])

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
        setDetailCache((prev) => new Map(prev).set(customerId, response.data))
        setAnomalyMap((prev) => new Map(prev).set(customerId, response.data.usage.anomaly))
        setOpenInvoiceId((current) =>
          current && response.data.invoices.some((invoice) => invoice.id === current)
            ? current
            : (response.data.invoices[0]?.id ?? null),
        )
        setPickedLineItemId(null)
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
    setDetailCache((prev) => new Map(prev).set(selectedCustomerId, response.data))
    setAnomalyMap((prev) => new Map(prev).set(selectedCustomerId, response.data.usage.anomaly))
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

  function pickLineItem(invoiceId: string, lineItem: OpsCustomerDetail['invoices'][number]['line_items'][number]) {
    setPickedLineItemId(lineItem.id)
    setAdjustmentTab('override')
    setCreditForm((current) => ({ ...current, invoiceId }))
    setOverrideForm((current) => ({
      ...current,
      amountCents: String(lineItem.amount_cents),
      invoiceId,
      lineItemId: lineItem.id,
    }))
  }

  const portfolio = useMemo(() => {
    let outstandingCents = 0
    let drafts = 0
    let anomalies = 0
    let latestIssuedPeriodStart: string | null = null
    let latestPeriodStart: string | null = null

    for (const cachedDetail of detailCache.values()) {
      if (cachedDetail.usage.anomaly) anomalies += 1
      cachedDetail.invoices.forEach((invoice) => {
        if (invoice.status === 'issued') {
          outstandingCents += invoice.total_cents
          if (!latestIssuedPeriodStart || invoice.period_start > latestIssuedPeriodStart) {
            latestIssuedPeriodStart = invoice.period_start
          }
        }
        if (invoice.status === 'draft') drafts += 1
        if (invoice.status !== 'void' && (!latestPeriodStart || invoice.period_start > latestPeriodStart)) {
          latestPeriodStart = invoice.period_start
        }
      })
    }

    return { anomalies, drafts, latestPeriodStart: latestIssuedPeriodStart ?? latestPeriodStart, outstandingCents }
  }, [detailCache])

  const heroStatusParts = [
    portfolio.drafts > 0
      ? `${portfolio.drafts} draft${portfolio.drafts === 1 ? '' : 's'} awaiting issue`
      : null,
    portfolio.anomalies > 0
      ? `${portfolio.anomalies} anomal${portfolio.anomalies === 1 ? 'y' : 'ies'} to review`
      : null,
  ].filter(Boolean)
  const heroStatus =
    heroStatusParts.length > 0
      ? `${heroStatusParts.join(' · ')} before billing close.`
      : 'All loaded customers clear before billing close.'

  return (
    <main className="dashboard-shell ops-shell opsv2">
      <h1 className="sr-only">Billing operations console</h1>
      <section className="opsv2-top">
        <p className="eyebrow">— Ops console · Billing period · {formatPeriod(portfolio.latestPeriodStart)}</p>
        <div className="opsv2-top-title">
          <span className="opsv2-count">{formatMoney(portfolio.outstandingCents)}</span>
          <span className="opsv2-count-label">outstanding · issued unpaid</span>
        </div>
        <div className="opsv2-inline-stats">
          <span className="opsv2-inline-stat">
            <strong>{customers.length}</strong>Customers
          </span>
          <span className="opsv2-inline-stat">
            <strong>{portfolio.drafts}</strong>
            {portfolio.drafts === 1 ? 'Draft to issue' : 'Drafts to issue'}
          </span>
          <span className={portfolio.anomalies > 0 ? 'opsv2-inline-stat warn' : 'opsv2-inline-stat'}>
            <strong>{portfolio.anomalies}</strong>
            {portfolio.anomalies === 1 ? 'Anomaly' : 'Anomalies'}
          </span>
        </div>
        <p className="opsv2-status">{heroStatus}</p>
      </section>

      {error ? <div className="banner error">{error}</div> : null}
      {message ? <div className="banner success">{message}</div> : null}
      {isLoading ? <div className="banner">Loading ops state...</div> : null}

      <section className="opsv2-body">
        <section className="opsv2-side" aria-label="Customers">
          <div className="opsv2-side-head">
            <p className="eyebrow">— Customers</p>
            <span className="opsv2-side-count">{customers.length}</span>
          </div>
          {customers.map((customer) => {
            const isAnomaly = anomalyMap.get(customer.id) ?? false
            return (
              <button
                className={customer.id === selectedCustomerId ? 'opsv2-tenant active' : 'opsv2-tenant'}
                key={customer.id}
                onClick={() => setSelectedCustomerId(customer.id)}
                type="button"
              >
                <span className={isAnomaly ? 'opsv2-dot anomaly' : 'opsv2-dot'} title={isAnomaly ? 'Anomaly' : 'Normal'} />
                <span className="opsv2-tinfo">
                  <span className="opsv2-tname">{customer.name}</span>
                  <span className="opsv2-temail">{customer.email}</span>
                </span>
                <span className="opsv2-plan">{customer.price_plan_name}</span>
              </button>
            )
          })}
        </section>

        <div className={`opsv2-detail${isLoadingDetail ? ' panel-refreshing' : ''}`}>
          {!detail ? (
            <section className="opsv2-section">
              <p className="muted">Select a customer to view operational signals.</p>
            </section>
          ) : (
            <>
              <div className="opsv2-detail-head">
                <h2>{detail.customer.name}</h2>
                <span className="opsv2-plan">{detail.customer.price_plan_name}</span>
              </div>

              <div className="opsv2-kpis">
                <div className="opsv2-kpi">
                  <div className="k-label">Current hour</div>
                  <div className="k-value">{detail.usage.current_hour_units.toLocaleString()}</div>
                </div>
                <div className="opsv2-kpi">
                  <div className="k-label">30-day avg / hr</div>
                  <div className="k-value">{Math.round(detail.usage.average_hourly_units_last_30_days).toLocaleString()}</div>
                </div>
                <div className={detail.usage.anomaly ? 'opsv2-kpi alert' : 'opsv2-kpi'}>
                  <div className="k-label">Anomaly</div>
                  <div className="k-value">{detail.usage.anomaly ? '10x+' : 'Normal'}</div>
                </div>
              </div>

              <section className="opsv2-section">
                <div className="opsv2-section-head">
                  <div>
                    <p className="eyebrow">— Invoices</p>
                    <p className="muted">Invoices are generated from hourly usage windows by the invoice generation job.</p>
                  </div>
                </div>
                {detail.invoices.length === 0 ? <p className="opsv2-empty">No invoices for this customer.</p> : null}
                {detail.invoices.map((invoice) => {
                  const isOpen = openInvoiceId === invoice.id
                  return (
                    <div key={invoice.id}>
                      <button
                        className="opsv2-inv-row"
                        onClick={() => setOpenInvoiceId(isOpen ? null : invoice.id)}
                        type="button"
                      >
                        <span>
                          <span className="opsv2-inv-period">
                            {formatDate(invoice.period_start)} - {formatDate(invoice.period_end)}
                          </span>
                          <span className="opsv2-inv-id">{shortId(invoice.id)}</span>
                        </span>
                        <em className="pill" data-status={invoice.status}>{invoice.status}</em>
                        <span className="opsv2-inv-total">{formatMoney(invoice.total_cents)}</span>
                        <span className="opsv2-chev">{isOpen ? '-' : '+'}</span>
                      </button>
                      {isOpen ? (
                        <div className="opsv2-li-list">
                          {invoice.line_items.length === 0 ? <p className="opsv2-empty">No line items</p> : null}
                          {invoice.line_items.map((lineItem) => (
                            <button
                              className={pickedLineItemId === lineItem.id ? 'opsv2-li picked' : 'opsv2-li'}
                              key={lineItem.id}
                              onClick={() => pickLineItem(invoice.id, lineItem)}
                              type="button"
                            >
                              <span>
                                <span className="opsv2-li-desc">
                                  {lineItem.description}
                                  {lineItem.is_overridden ? <span className="opsv2-li-tag">overridden</span> : null}
                                </span>
                                <span className="opsv2-li-id">{shortId(lineItem.id)}</span>
                                <span className="opsv2-li-units">
                                  {lineItem.units.toLocaleString()} units x {formatUnitPrice(lineItem.unit_price_micros)}
                                </span>
                              </span>
                              <span className="opsv2-li-amt">{formatMoney(lineItem.amount_cents)}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </section>

              <section className="opsv2-section">
                <div className="opsv2-section-head">
                  <p className="eyebrow">— Adjustments</p>
                </div>
                <div className="opsv2-adjust-tabs">
                  <button
                    className={adjustmentTab === 'credit' ? 'opsv2-atab active' : 'opsv2-atab'}
                    onClick={() => setAdjustmentTab('credit')}
                    type="button"
                  >
                    Credit
                  </button>
                  <button
                    className={adjustmentTab === 'override' ? 'opsv2-atab active' : 'opsv2-atab'}
                    onClick={() => setAdjustmentTab('override')}
                    type="button"
                  >
                    Override
                  </button>
                </div>

                {adjustmentTab === 'credit' ? (
                  <form className="opsv2-form" onSubmit={submitCredit}>
                    <div className="opsv2-form-grid">
                      <label className="opsv2-field">
                        <span>Invoice</span>
                        <input aria-label="Credit invoice id" onChange={(event) => setCreditForm({ ...creditForm, invoiceId: event.target.value })} placeholder="invoice_id" value={creditForm.invoiceId} />
                      </label>
                      <label className="opsv2-field">
                        <span>Amount (cents)</span>
                        <input aria-label="Credit amount cents" onChange={(event) => setCreditForm({ ...creditForm, amountCents: event.target.value })} placeholder="500" type="number" value={creditForm.amountCents} />
                      </label>
                    </div>
                    <label className="opsv2-field">
                      <span>Reason</span>
                      <input aria-label="Credit reason" onChange={(event) => setCreditForm({ ...creditForm, reason: event.target.value })} placeholder="Goodwill - incident credit" value={creditForm.reason} />
                    </label>
                    <label className="opsv2-field">
                      <span>Idempotency key</span>
                      <input aria-label="Credit idempotency key" onChange={(event) => setCreditForm({ ...creditForm, idempotencyKey: event.target.value })} placeholder="credit-..." value={creditForm.idempotencyKey} />
                    </label>
                    <button className="opsv2-submit" type="submit">Issue credit</button>
                  </form>
                ) : (
                  <form className="opsv2-form" onSubmit={submitOverride}>
                    <div className="opsv2-form-grid">
                      <label className="opsv2-field">
                        <span>Invoice</span>
                        <input aria-label="Override invoice id" onChange={(event) => setOverrideForm({ ...overrideForm, invoiceId: event.target.value })} placeholder="invoice_id" value={overrideForm.invoiceId} />
                      </label>
                      <label className="opsv2-field">
                        <span>Line item</span>
                        <input aria-label="Override line item id" onChange={(event) => setOverrideForm({ ...overrideForm, lineItemId: event.target.value })} placeholder="line_item_id" value={overrideForm.lineItemId} />
                      </label>
                    </div>
                    <label className="opsv2-field">
                      <span>New amount (cents)</span>
                      <input aria-label="Override amount cents" onChange={(event) => setOverrideForm({ ...overrideForm, amountCents: event.target.value })} placeholder="amount_cents" type="number" value={overrideForm.amountCents} />
                    </label>
                    <label className="opsv2-field">
                      <span>Reason</span>
                      <input aria-label="Override reason" onChange={(event) => setOverrideForm({ ...overrideForm, reason: event.target.value })} placeholder="Corrected after reconciliation" value={overrideForm.reason} />
                    </label>
                    <button className="opsv2-submit" type="submit">Override line item</button>
                    <p className="opsv2-form-note">Tip: click a line item above to auto-fill these fields. Paid invoices are rejected; use credits for post-payment corrections.</p>
                  </form>
                )}
              </section>

              <section className="opsv2-section">
                <div className="opsv2-section-head">
                  <p className="eyebrow">— Audit trail</p>
                </div>
                {detail.audit_logs.length === 0 ? <p className="opsv2-empty">No audit entries yet.</p> : null}
                <div className="opsv2-timeline">
                  {detail.audit_logs.map((entry) => (
                    <div className="opsv2-tl-item" key={entry.id}>
                      <div className="opsv2-tl-rail">
                        <span className="opsv2-tl-tick" />
                        <span className="opsv2-tl-line" />
                      </div>
                      <div className="opsv2-tl-body">
                        <div className="opsv2-tl-head">
                          <span>
                            <span className="opsv2-tl-action">{entry.action}</span>
                            <span className="opsv2-tl-actor"> · {entry.actor}</span>
                          </span>
                          <span className="opsv2-tl-date">{formatDate(entry.created_at)}</span>
                        </div>
                        <p className="opsv2-tl-reason">{entry.reason}</p>
                        <details>
                          <summary>before / after</summary>
                          <pre>{JSON.stringify({ before: entry.before_value, after: entry.after_value }, null, 2)}</pre>
                        </details>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  )
}

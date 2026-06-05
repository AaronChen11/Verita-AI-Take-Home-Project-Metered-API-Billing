import { useEffect, useState, useTransition } from 'react'

import { fetchInvoiceDetail, fetchInvoices, fetchUsage, formatMoney } from '../lib/api'
import type { InvoiceDetail, InvoiceSummary, UsageBucket, UsageGranularity } from '../lib/api'
import { InvoicePanel } from './InvoicePanel'
import { UsageChart } from './UsageChart'

type CustomerDashboardProps = {
  token: string
}

const STAGES = ['Usage', 'Aggregated', 'Invoiced', 'Paid'] as const

function shouldMockEmptyInvoices() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock_empty_invoices') === '1'
}

function getCurrentStage(invoice: InvoiceSummary | undefined): number {
  if (!invoice) return 0
  if (invoice.status === 'paid') return 4
  if (invoice.status === 'issued') return 3
  if (invoice.status === 'draft') return 2
  return 1
}

function getStatusCopy(invoice: InvoiceSummary | undefined, totalUnits: number): string {
  if (!invoice) {
    return totalUnits > 0
      ? 'Usage collected · invoice generates at end of period.'
      : 'No usage recorded yet this period.'
  }
  const copy: Record<string, string> = {
    draft: 'Draft invoice generated · will be issued at month end.',
    issued: 'Invoice issued · payment pending.',
    paid: 'Paid · this period is closed.',
    void: 'Invoice voided · contact support.',
  }
  return copy[invoice.status] ?? 'Invoice in unknown state.'
}

function formatPeriod(dateStr: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(dateStr + 'T00:00:00'),
  )
}

export function CustomerDashboard({ token }: CustomerDashboardProps) {
  const [granularity, setGranularity] = useState<UsageGranularity>('hour')
  const [usage, setUsage] = useState<UsageBucket[]>([])
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([])
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      setIsLoading(true)
      setError(null)
      try {
        const [usageResponse, invoiceResponse] = await Promise.all([
          fetchUsage(token, granularity),
          fetchInvoices(token),
        ])
        if (cancelled) return

        const invoiceData = shouldMockEmptyInvoices() ? [] : invoiceResponse.data

        setUsage(usageResponse.data)
        setInvoices(invoiceData)
        setSelectedInvoiceId((current) =>
          current && invoiceData.some((inv) => inv.id === current)
            ? current
            : (invoiceData[0]?.id ?? null),
        )
        if (invoiceData.length === 0) setSelectedInvoice(null)
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load dashboard')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadDashboard()
    return () => { cancelled = true }
  }, [granularity, token])

  useEffect(() => {
    if (selectedInvoiceId === null) return
    const invoiceId = selectedInvoiceId
    let cancelled = false

    async function loadInvoice() {
      try {
        const response = await fetchInvoiceDetail(token, invoiceId)
        if (!cancelled) setSelectedInvoice(response.data)
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load invoice')
        }
      }
    }

    void loadInvoice()
    return () => { cancelled = true }
  }, [selectedInvoiceId, token])

  function handleGranularityChange(next: UsageGranularity) {
    startTransition(() => setGranularity(next))
  }

  function handleSelectInvoice(invoiceId: string) {
    setSelectedInvoiceId(invoiceId)
    setSelectedInvoice(null)
  }

  const latestInvoice = invoices[0]
  const totalUnits = usage.reduce((sum, b) => sum + b.total_units, 0)
  const currentStage = getCurrentStage(latestInvoice)
  const periodLabel = latestInvoice
    ? formatPeriod(latestInvoice.period_start)
    : new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date())

  return (
    <main className="dashboard-shell">
      <section className="hero-card">
        <div className="hero-cycle">
          <p className="eyebrow">— Current period · {periodLabel}</p>

          <div className="cycle-amount-row">
            <span className="cycle-amount">{formatMoney(latestInvoice?.total_cents ?? 0)}</span>
            <span className="cycle-meta">{totalUnits.toLocaleString()} units</span>
          </div>

          <div className="cycle-progress-wrap">
            <div className="cycle-bar">
              {STAGES.map((_, i) => (
                <div
                  key={i}
                  className={[
                    'cycle-segment',
                    i < currentStage ? 'done' : '',
                    i === currentStage - 1 ? 'last-done' : '',
                  ].join(' ')}
                />
              ))}
            </div>
            <div className="cycle-stages">
              {STAGES.map((stage, i) => (
                <span
                  key={stage}
                  className={i < currentStage ? 'stage-done' : 'stage-pending'}
                >
                  {stage}{i < currentStage ? ' ✓' : ''}
                </span>
              ))}
            </div>
          </div>

          <p className="cycle-status">{getStatusCopy(latestInvoice, totalUnits)}</p>
        </div>

        <div className="hero-controls">
          <button
            className={granularity === 'hour' ? 'toggle active' : 'toggle'}
            onClick={() => handleGranularityChange('hour')}
            type="button"
          >
            Hour
          </button>
          <button
            className={granularity === 'day' ? 'toggle active' : 'toggle'}
            onClick={() => handleGranularityChange('day')}
            type="button"
          >
            Day
          </button>
        </div>
      </section>

      {error ? <div className="banner error">{error}</div> : null}
      {isLoading || isPending ? <div className="banner">Loading latest billing state...</div> : null}

      <UsageChart buckets={usage} granularity={granularity} />
      <InvoicePanel
        invoices={invoices}
        onSelectInvoice={handleSelectInvoice}
        selectedInvoice={selectedInvoice}
        selectedInvoiceId={selectedInvoiceId}
      />
    </main>
  )
}

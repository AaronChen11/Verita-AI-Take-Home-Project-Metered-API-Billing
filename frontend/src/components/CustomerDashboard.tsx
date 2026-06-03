import { useEffect, useState, useTransition } from 'react'

import { fetchInvoiceDetail, fetchInvoices, fetchUsage } from '../lib/api'
import type { InvoiceDetail, InvoiceSummary, UsageBucket, UsageGranularity } from '../lib/api'
import { InvoicePanel } from './InvoicePanel'
import { UsageChart } from './UsageChart'

type CustomerDashboardProps = {
  token: string
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
        const [usageResponse, invoiceResponse] = await Promise.all([fetchUsage(token, granularity), fetchInvoices(token)])
        if (cancelled) return

        setUsage(usageResponse.data)
        setInvoices(invoiceResponse.data)
        setSelectedInvoiceId((current) =>
          current && invoiceResponse.data.some((invoice) => invoice.id === current)
            ? current
            : (invoiceResponse.data[0]?.id ?? null),
        )
        if (invoiceResponse.data.length === 0) {
          setSelectedInvoice(null)
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load dashboard')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadDashboard()

    return () => {
      cancelled = true
    }
  }, [granularity, token])

  useEffect(() => {
    if (selectedInvoiceId === null) {
      return
    }
    const invoiceId: string = selectedInvoiceId

    let cancelled = false

    async function loadInvoice() {
      try {
        const response = await fetchInvoiceDetail(token, invoiceId)
        if (!cancelled) {
          setSelectedInvoice(response.data)
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load invoice')
        }
      }
    }

    void loadInvoice()

    return () => {
      cancelled = true
    }
  }, [selectedInvoiceId, token])

  function handleGranularityChange(nextGranularity: UsageGranularity) {
    startTransition(() => {
      setGranularity(nextGranularity)
    })
  }

  function handleSelectInvoice(invoiceId: string) {
    setSelectedInvoiceId(invoiceId)
    setSelectedInvoice(null)
  }

  return (
    <main className="dashboard-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Customer dashboard</p>
          <h1>Metered usage without billing drift.</h1>
          <p className="hero-copy">
            Review recent usage, inspect invoices, and verify credits from the same API state used for billing.
          </p>
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

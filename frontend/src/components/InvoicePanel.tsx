import type { InvoiceDetail, InvoiceSummary } from '../lib/api'
import { formatDate, formatMoney, formatUnitPrice } from '../lib/api'

type InvoicePanelProps = {
  invoices: InvoiceSummary[]
  selectedInvoice: InvoiceDetail | null
  selectedInvoiceId: string | null
  onSelectInvoice: (invoiceId: string) => void
}

export function InvoicePanel({ invoices, selectedInvoice, selectedInvoiceId, onSelectInvoice }: InvoicePanelProps) {
  return (
    <section className="invoice-grid">
      <div className="panel invoice-list">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">— Invoices</p>
            <h2>Recent statements</h2>
          </div>
          <span className="pill">{invoices.length}</span>
        </div>

        {invoices.length === 0 ? (
          <div className="empty-command">
            <p>No invoices yet. Run usage aggregation, then generate invoices.</p>
            <code>npm run aggregate:usage && npm run generate:invoices</code>
          </div>
        ) : (
          <div className="invoice-rows">
            {invoices.map((invoice) => (
              <button
                className={invoice.id === selectedInvoiceId ? 'invoice-row selected' : 'invoice-row'}
                key={invoice.id}
                onClick={() => onSelectInvoice(invoice.id)}
                type="button"
              >
                <span>
                  {formatDate(invoice.period_start)} - {formatDate(invoice.period_end)}
                </span>
                <strong>{formatMoney(invoice.total_cents)}</strong>
                <em data-status={invoice.status}>{invoice.status}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="panel invoice-detail">
        <p className="eyebrow">— Invoice detail</p>
        {!selectedInvoice ? (
          <p className="muted">Select an invoice to inspect line items and credits.</p>
        ) : (
          <>
            <div className="invoice-total">
              <em data-status={selectedInvoice.status}>{selectedInvoice.status}</em>
              <strong>{formatMoney(selectedInvoice.total_cents)}</strong>
            </div>

            <div className="line-items">
              {selectedInvoice.line_items.map((lineItem) => (
                <div className="line-item" key={lineItem.id}>
                  <span>
                    {lineItem.description}
                    <small>
                      {lineItem.units.toLocaleString()} units × {formatUnitPrice(lineItem.unit_price_micros)}
                    </small>
                  </span>
                  <strong>{formatMoney(lineItem.amount_cents)}</strong>
                  {lineItem.is_overridden ? <em>overridden</em> : null}
                </div>
              ))}
            </div>

            <div className="totals">
              <span>Subtotal {formatMoney(selectedInvoice.subtotal_cents)}</span>
            </div>

            {selectedInvoice.credits_cents > 0 ? (
              <div className="credit-applied">
                <span>Credits applied</span>
                <strong>− {formatMoney(selectedInvoice.credits_cents)}</strong>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

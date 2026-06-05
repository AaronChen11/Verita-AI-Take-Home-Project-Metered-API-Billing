import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchInvoiceDetail,
  formatMoney,
  formatUnitPrice,
  issueOpsCredit,
  validateCustomerToken,
  validateOpsCredentials,
} from './api'

function mockJsonResponse(payload: unknown, init?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
      ...init,
    }),
  )
}

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends customer bearer tokens on customer API requests', async () => {
    const fetchMock = vi.fn(() => mockJsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await validateCustomerToken('mb_live_demo')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/invoices?limit=1', {
      headers: {
        Authorization: 'Bearer mb_live_demo',
      },
    })
  })

  it('sends ops token on read-only ops requests', async () => {
    const fetchMock = vi.fn(() => mockJsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await validateOpsCredentials('ops-secret')

    expect(fetchMock).toHaveBeenCalledWith('/api/ops/customers?limit=1', {
      headers: {
        'X-Ops-Token': 'ops-secret',
      },
    })
  })

  it('sends ops actor and idempotency payload for credit creation', async () => {
    const fetchMock = vi.fn(() => mockJsonResponse({ data: { credit_id: 'cred_1', duplicate: false } }))
    vi.stubGlobal('fetch', fetchMock)

    await issueOpsCredit('ops-secret', 'aaron@example.com', 'cus_1', {
      amountCents: 250,
      idempotencyKey: 'manual-credit-001',
      invoiceId: 'inv_1',
      reason: 'Manual credit test',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ops/customers/cus_1/credits',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          'X-Ops-Actor': 'aaron@example.com',
          'X-Ops-Token': 'ops-secret',
        },
        method: 'POST',
      }),
    )

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(requestInit.body))).toEqual({
      amount_cents: 250,
      idempotency_key: 'manual-credit-001',
      invoice_id: 'inv_1',
      reason: 'Manual credit test',
    })
  })

  it('surfaces API error payloads instead of generic status text', async () => {
    const fetchMock = vi.fn(() => mockJsonResponse({ error: 'invoice_not_found' }, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchInvoiceDetail('mb_live_demo', 'missing-invoice')).rejects.toThrow('invoice_not_found')
  })
})

describe('formatters', () => {
  it('formats money in cents', () => {
    expect(formatMoney(11_500)).toBe('$115.00')
  })

  it('formats micros unit pricing without trailing zeros', () => {
    expect(formatUnitPrice(1_500)).toBe('$0.0015/unit')
    expect(formatUnitPrice(0)).toBe('$0/unit')
  })
})

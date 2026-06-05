import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const customer = {
  created_at: '2026-06-01T00:00:00.000Z',
  email: 'billing@acme.test',
  id: '00000000-0000-4000-8000-000000000101',
  name: 'Acme AI',
  price_plan_name: 'Demo Growth',
}

const invoice = {
  created_at: '2026-06-01T00:00:00.000Z',
  credits_cents: 500,
  id: '00000000-0000-4000-8000-000000000202',
  issued_at: '2026-06-02T00:00:00.000Z',
  paid_at: null,
  period_end: '2026-06-01',
  period_start: '2026-05-01',
  status: 'issued',
  subtotal_cents: 12_000,
  total_cents: 11_500,
}

const invoiceDetail = {
  ...invoice,
  credits: [
    {
      amount_cents: 500,
      created_at: '2026-06-02T00:00:00.000Z',
      created_by: 'seed-script',
      id: 'credit_001',
      reason: 'Demo courtesy credit',
    },
  ],
  line_items: [
    {
      amount_cents: 12_000,
      description: 'Demo issued invoice usage',
      id: '00000000-0000-4000-8000-000000000212',
      is_overridden: false,
      unit_price_micros: 1000,
      units: 120_000,
    },
  ],
}

const opsDetail = {
  audit_logs: [
    {
      action: 'credit.created',
      actor: 'seed-script',
      after_value: { credits_cents: 500, total_cents: 11_500 },
      before_value: { credits_cents: 0, total_cents: 12_000 },
      created_at: '2026-06-02T00:00:00.000Z',
      entity_id: invoice.id,
      entity_type: 'invoice',
      id: 'audit_001',
      reason: 'Demo courtesy credit',
    },
  ],
  customer,
  invoices: [
    {
      created_at: invoice.created_at,
      id: invoice.id,
      line_items: invoiceDetail.line_items,
      period_end: invoice.period_end,
      period_start: invoice.period_start,
      status: invoice.status,
      total_cents: invoice.total_cents,
    },
  ],
  usage: {
    anomaly: true,
    average_hourly_units_last_30_days: 100,
    current_hour_units: 1200,
  },
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())

    if (url.pathname === '/api/v1/usage') {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          data: [
            {
              bucket_end: '2026-06-03T13:00:00.000Z',
              bucket_start: '2026-06-03T12:00:00.000Z',
              granularity: 'hour',
              total_units: 120,
            },
          ],
          next_cursor: null,
        },
      })
      return
    }

    if (url.pathname === '/api/v1/invoices') {
      await route.fulfill({ contentType: 'application/json', json: { data: [invoice], next_cursor: null } })
      return
    }

    if (url.pathname === `/api/v1/invoices/${invoice.id}`) {
      await route.fulfill({ contentType: 'application/json', json: { data: invoiceDetail } })
      return
    }

    if (url.pathname === '/api/ops/customers') {
      await route.fulfill({ contentType: 'application/json', json: { data: [customer], next_cursor: null } })
      return
    }

    if (url.pathname === `/api/ops/customers/${customer.id}`) {
      await route.fulfill({ contentType: 'application/json', json: { data: opsDetail } })
      return
    }

    await route.fulfill({ contentType: 'application/json', json: { error: 'not_mocked' }, status: 404 })
  })
})

test('login page has no critical accessibility violations', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Continue.' })).toBeVisible()

  const results = await new AxeBuilder({ page }).analyze()

  expect(results.violations).toEqual([])
})

test('customer dashboard has no critical accessibility violations', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('metered-demo-api-key', 'mb_live_accessibility')
  })

  await page.goto('/')
  await expect(page.getByText('Current period')).toBeVisible()

  const results = await new AxeBuilder({ page }).analyze()

  expect(results.violations).toEqual([])
})

test('ops console has no critical accessibility violations', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('metered-demo-ops-actor', 'accessibility@example.com')
    localStorage.setItem('metered-demo-ops-token', 'local-ops-secret')
  })

  await page.goto('/ops')
  await expect(page.getByRole('heading', { name: 'Acme AI' })).toBeVisible()

  const results = await new AxeBuilder({ page }).analyze()

  expect(results.violations).toEqual([])
})

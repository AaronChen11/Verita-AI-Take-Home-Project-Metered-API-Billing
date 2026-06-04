import { useState } from 'react'

import { CustomerDashboard } from './components/CustomerDashboard'
import { OpsConsole } from './components/OpsConsole'
import { UsageChart } from './components/UsageChart'
import { useStoredOpsCredentials } from './hooks/useStoredOpsCredentials'
import { useStoredToken } from './hooks/useStoredToken'
import type { UsageBucket } from './lib/api'
import './App.css'

// Realistic mock data: 48 hourly buckets over 2 days with organic variation
function buildMockBuckets(): UsageBucket[] {
  const base = new Date('2026-06-02T00:00:00Z')
  const pattern = [
    120, 90, 70, 55, 48, 60, 140, 320, 580, 740, 820, 890,
    960, 1020, 1100, 1080, 970, 860, 780, 700, 640, 520, 380, 220,
    160, 110, 80, 65, 52, 70, 180, 410, 650, 800, 910, 980,
    1050, 1140, 1220, 1190, 1080, 940, 850, 760, 680, 570, 420, 260,
  ]

  return pattern.map((units, i) => {
    const start = new Date(base.getTime() + i * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    return {
      bucket_start: start.toISOString(),
      bucket_end: end.toISOString(),
      granularity: 'hour' as const,
      total_units: units,
    }
  })
}

const MOCK_BUCKETS = buildMockBuckets()

function App() {
  const [token, setToken] = useStoredToken()
  const { opsActor, opsToken, setOpsActor, setOpsToken } = useStoredOpsCredentials()
  const [view, setView] = useState<'customer' | 'ops'>('customer')
  const trimmedToken = token.trim()
  const trimmedOpsToken = opsToken.trim()
  const trimmedOpsActor = opsActor.trim()

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <span className="mark">Metered</span>
        </div>
        <div className="view-switcher">
          <button className={view === 'customer' ? 'toggle active' : 'toggle'} onClick={() => setView('customer')} type="button">
            Customer
          </button>
          <button className={view === 'ops' ? 'toggle active' : 'toggle'} onClick={() => setView('ops')} type="button">
            Ops
          </button>
        </div>
      </header>

      {view === 'customer' ? (
        <section className="token-card">
          <div>
            <p className="eyebrow">— Demo API key</p>
            <h2>Connect as a customer</h2>
            <p className="muted">Paste the raw demo API key printed by `npm run seed`.</p>
          </div>
          <input
            aria-label="Customer API key"
            onChange={(event) => setToken(event.target.value)}
            placeholder="mb_live_..."
            type="password"
            value={token}
          />
        </section>
      ) : (
        <section className="token-card ops-token-card">
          <div>
            <p className="eyebrow">— Ops access</p>
            <h2>Shared token + actor</h2>
            <p className="muted">Use OPS_SHARED_SECRET and a real actor string for audited actions.</p>
          </div>
          <input
            aria-label="Ops token"
            onChange={(event) => setOpsToken(event.target.value)}
            placeholder="OPS_SHARED_SECRET"
            type="password"
            value={opsToken}
          />
          <input
            aria-label="Ops actor"
            onChange={(event) => setOpsActor(event.target.value)}
            placeholder="ops@example.com"
            value={opsActor}
          />
        </section>
      )}

      {view === 'customer' && trimmedToken ? (
        <CustomerDashboard token={trimmedToken} />
      ) : view === 'ops' && trimmedOpsToken && trimmedOpsActor ? (
        <OpsConsole actor={trimmedOpsActor} opsToken={trimmedOpsToken} />
      ) : (
        <section className="empty-state">
          <p className="eyebrow">— Waiting for credentials</p>
          <h1>{view === 'customer' ? 'Run seed, paste the token, inspect billing state.' : 'Enter ops token and actor to audit customer billing.'}</h1>
          {view === 'customer' ? <UsageChart buckets={MOCK_BUCKETS} granularity="hour" /> : null}
        </section>
      )}
    </div>
  )
}

export default App

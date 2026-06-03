import { useState } from 'react'

import { CustomerDashboard } from './components/CustomerDashboard'
import { OpsConsole } from './components/OpsConsole'
import { useStoredOpsCredentials } from './hooks/useStoredOpsCredentials'
import { useStoredToken } from './hooks/useStoredToken'
import './App.css'

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
          <span className="mark">MB</span>
          <strong>Metered Billing</strong>
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
            <p className="eyebrow">Demo API key</p>
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
            <p className="eyebrow">Ops access</p>
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
          <p className="eyebrow">Waiting for credentials</p>
          <h1>{view === 'customer' ? 'Run seed, paste the token, inspect billing state.' : 'Enter ops token and actor to audit customer billing.'}</h1>
        </section>
      )}
    </div>
  )
}

export default App

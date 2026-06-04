import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useStoredOpsCredentials } from '../hooks/useStoredOpsCredentials'
import { useStoredToken } from '../hooks/useStoredToken'
import { validateCustomerToken, validateOpsCredentials } from '../lib/api'

type Mode = 'customer' | 'ops'

export function LoginPage() {
  const navigate = useNavigate()
  const [, setToken] = useStoredToken()
  const { setOpsToken, setOpsActor } = useStoredOpsCredentials()

  const [mode, setMode] = useState<Mode>('customer')
  const [customerKey, setCustomerKey] = useState('')
  const [opsToken, setOpsTokenInput] = useState('')
  const [opsActor, setOpsActorInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
  }

  async function submitCustomer(e: FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    try {
      await validateCustomerToken(customerKey.trim())
      setToken(customerKey.trim())
      navigate('/')
    } catch {
      setError('Invalid API key. Check the key printed by npm run seed.')
    } finally {
      setIsLoading(false)
    }
  }

  async function submitOps(e: FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    try {
      await validateOpsCredentials(opsToken.trim())
      setOpsToken(opsToken.trim())
      setOpsActor(opsActor.trim())
      navigate('/ops')
    } catch {
      setError('Invalid ops token. Check OPS_SHARED_SECRET in your .env file.')
    } finally {
      setIsLoading(false)
    }
  }

  const modeCopy = mode === 'customer'
    ? 'Authenticate with the raw demo API key printed by the seed script.'
    : 'Authorize ops access with the shared secret and an auditable actor.'

  return (
    <div className="login-page">
      <header className="login-nav">
        <span className="mark">Metered</span>
        <span className="login-nav-tagline">Metered API Billing</span>
      </header>

      <main className="login-shell">
        <section className="login-left" aria-labelledby="login-welcome-title">
          <div className="login-brand">
            <p className="eyebrow">— Welcome back</p>
            <h1 id="login-welcome-title">
              A billing system that
              <br />
              <em>remembers every unit.</em>
            </h1>
            <p className="login-desc">
              Sign in to inspect usage, invoices, credits, and operational audit trails from the same state used for billing.
            </p>
          </div>

          <div className="login-apply">
            <h2>New to the demo?</h2>
            <p>Run seed once. We'll match you to the customer or ops view from the credentials you enter.</p>
            <code>npm run seed</code>
          </div>
        </section>

        <section className="login-right" aria-labelledby="login-auth-title">
          <div className="login-card">
            <p className="eyebrow">— Sign in</p>
            <h2 id="login-auth-title">Continue.</h2>
            <p className="login-mode-copy">{modeCopy}</p>

            <div className="login-tabs" aria-label="Authentication mode">
              <button
                className={mode === 'customer' ? 'login-tab active' : 'login-tab'}
                onClick={() => switchMode('customer')}
                type="button"
              >
                Customer
              </button>
              <button
                className={mode === 'ops' ? 'login-tab active' : 'login-tab'}
                onClick={() => switchMode('ops')}
                type="button"
              >
                Ops
              </button>
            </div>

            <div className="login-divider">
              <span>{mode === 'customer' ? 'api key' : 'authorization'}</span>
            </div>

            {mode === 'customer' ? (
              <form className="login-form" onSubmit={submitCustomer}>
                <div className="login-field">
                  <label className="eyebrow" htmlFor="api-key">— API key</label>
                  <input
                    autoComplete="off"
                    autoFocus
                    id="api-key"
                    onChange={(e) => setCustomerKey(e.target.value)}
                    placeholder="mb_live_..."
                    type="password"
                    value={customerKey}
                  />
                  <p className="login-hint">Printed by <code>npm run seed</code> on first run.</p>
                </div>

                {error ? <p className="login-error">{error}</p> : null}

                <button
                  className="login-submit"
                  disabled={!customerKey.trim() || isLoading}
                  type="submit"
                >
                  {isLoading ? 'Connecting...' : 'Sign in →'}
                </button>
              </form>
            ) : (
              <form className="login-form" onSubmit={submitOps}>
                <div className="login-field">
                  <label className="eyebrow" htmlFor="ops-token">— Ops token</label>
                  <input
                    autoComplete="off"
                    autoFocus
                    id="ops-token"
                    onChange={(e) => setOpsTokenInput(e.target.value)}
                    placeholder="OPS_SHARED_SECRET"
                    type="password"
                    value={opsToken}
                  />
                </div>

                <div className="login-field">
                  <label className="eyebrow" htmlFor="ops-actor">— Actor</label>
                  <input
                    autoComplete="off"
                    id="ops-actor"
                    onChange={(e) => setOpsActorInput(e.target.value)}
                    placeholder="ops@example.com"
                    value={opsActor}
                  />
                  <p className="login-hint">Used for audit log attribution on money-moving actions.</p>
                </div>

                {error ? <p className="login-error">{error}</p> : null}

                <button
                  className="login-submit"
                  disabled={!opsToken.trim() || !opsActor.trim() || isLoading}
                  type="submit"
                >
                  {isLoading ? 'Connecting...' : 'Sign in →'}
                </button>
              </form>
            )}
          </div>
        </section>
      </main>

      <footer className="login-footer">
        <span>Metered</span>
        <span className="login-footer-copy">Usage-based billing · built to be exact.</span>
      </footer>
    </div>
  )
}

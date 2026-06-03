import { CustomerDashboard } from './components/CustomerDashboard'
import { useStoredToken } from './hooks/useStoredToken'
import './App.css'

function App() {
  const [token, setToken] = useStoredToken()
  const trimmedToken = token.trim()

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <span className="mark">MB</span>
          <strong>Metered Billing</strong>
        </div>
        <span className="environment">Local demo</span>
      </header>

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

      {trimmedToken ? (
        <CustomerDashboard token={trimmedToken} />
      ) : (
        <section className="empty-state">
          <p className="eyebrow">Waiting for credentials</p>
          <h1>Run seed, paste the token, inspect billing state.</h1>
        </section>
      )}
    </div>
  )
}

export default App

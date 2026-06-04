import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'

import { CustomerDashboard } from './components/CustomerDashboard'
import { OpsConsole } from './components/OpsConsole'
import { useStoredOpsCredentials } from './hooks/useStoredOpsCredentials'
import { useStoredToken } from './hooks/useStoredToken'
import { LoginPage } from './pages/LoginPage'
import './App.css'

function Topbar({ view }: { view: 'customer' | 'ops' }) {
  const navigate = useNavigate()
  const [, setToken] = useStoredToken()
  const { setOpsToken, setOpsActor } = useStoredOpsCredentials()

  function disconnect() {
    setToken('')
    setOpsToken('')
    setOpsActor('')
    navigate('/login')
  }

  return (
    <header className="topbar">
      <span className="mark">Metered</span>
      <div className="topbar-right">
        <span className="topbar-view">{view === 'customer' ? 'Customer' : 'Ops'}</span>
        <button className="topbar-disconnect" onClick={disconnect} type="button">
          Disconnect
        </button>
      </div>
    </header>
  )
}

function CustomerRoute() {
  const [token] = useStoredToken()
  if (!token.trim()) return <Navigate to="/login" replace />

  return (
    <div className="app">
      <Topbar view="customer" />
      <CustomerDashboard token={token.trim()} />
    </div>
  )
}

function OpsRoute() {
  const { opsToken, opsActor } = useStoredOpsCredentials()
  if (!opsToken.trim() || !opsActor.trim()) return <Navigate to="/login" replace />

  return (
    <div className="app">
      <Topbar view="ops" />
      <OpsConsole actor={opsActor.trim()} opsToken={opsToken.trim()} />
    </div>
  )
}

function LoginRoute() {
  const [token] = useStoredToken()
  const { opsToken, opsActor } = useStoredOpsCredentials()
  if (token.trim()) return <Navigate to="/" replace />
  if (opsToken.trim() && opsActor.trim()) return <Navigate to="/ops" replace />
  return <LoginPage />
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/" element={<CustomerRoute />} />
        <Route path="/ops" element={<OpsRoute />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

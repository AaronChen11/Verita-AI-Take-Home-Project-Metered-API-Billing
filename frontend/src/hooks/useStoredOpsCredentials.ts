import { useEffect, useState } from 'react'

const TOKEN_KEY = 'metered-demo-ops-token'
const ACTOR_KEY = 'metered-demo-ops-actor'

export function useStoredOpsCredentials() {
  const [opsToken, setOpsToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [opsActor, setOpsActor] = useState(() => localStorage.getItem(ACTOR_KEY) ?? '')

  useEffect(() => {
    if (opsToken) {
      localStorage.setItem(TOKEN_KEY, opsToken)
      return
    }

    localStorage.removeItem(TOKEN_KEY)
  }, [opsToken])

  useEffect(() => {
    if (opsActor) {
      localStorage.setItem(ACTOR_KEY, opsActor)
      return
    }

    localStorage.removeItem(ACTOR_KEY)
  }, [opsActor])

  return { opsActor, opsToken, setOpsActor, setOpsToken }
}

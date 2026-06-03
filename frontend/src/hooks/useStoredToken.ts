import { useEffect, useState } from 'react'

const STORAGE_KEY = 'metered-demo-api-key'

export function useStoredToken() {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '')

  useEffect(() => {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token)
      return
    }

    localStorage.removeItem(STORAGE_KEY)
  }, [token])

  return [token, setToken] as const
}

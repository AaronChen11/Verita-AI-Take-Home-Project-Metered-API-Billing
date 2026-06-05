import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useStoredOpsCredentials } from './useStoredOpsCredentials'

describe('useStoredOpsCredentials', () => {
  it('reads ops token and actor from localStorage', () => {
    localStorage.setItem('metered-demo-ops-token', 'ops-secret')
    localStorage.setItem('metered-demo-ops-actor', 'aaron@example.com')

    const { result } = renderHook(() => useStoredOpsCredentials())

    expect(result.current.opsToken).toBe('ops-secret')
    expect(result.current.opsActor).toBe('aaron@example.com')
  })

  it('persists updates and clears blank credentials', () => {
    const { result } = renderHook(() => useStoredOpsCredentials())

    act(() => {
      result.current.setOpsToken('ops-new')
      result.current.setOpsActor('ops@example.com')
    })

    expect(localStorage.getItem('metered-demo-ops-token')).toBe('ops-new')
    expect(localStorage.getItem('metered-demo-ops-actor')).toBe('ops@example.com')

    act(() => {
      result.current.setOpsToken('')
      result.current.setOpsActor('')
    })

    expect(localStorage.getItem('metered-demo-ops-token')).toBeNull()
    expect(localStorage.getItem('metered-demo-ops-actor')).toBeNull()
  })
})

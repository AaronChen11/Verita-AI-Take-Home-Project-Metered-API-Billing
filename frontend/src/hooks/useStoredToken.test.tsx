import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useStoredToken } from './useStoredToken'

describe('useStoredToken', () => {
  it('reads the customer API key from localStorage', () => {
    localStorage.setItem('metered-demo-api-key', 'mb_live_demo')

    const { result } = renderHook(() => useStoredToken())

    expect(result.current[0]).toBe('mb_live_demo')
  })

  it('persists updates and removes empty values', () => {
    const { result } = renderHook(() => useStoredToken())

    act(() => {
      result.current[1]('mb_live_new')
    })

    expect(localStorage.getItem('metered-demo-api-key')).toBe('mb_live_new')

    act(() => {
      result.current[1]('')
    })

    expect(localStorage.getItem('metered-demo-api-key')).toBeNull()
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ReasonInput } from './ReasonInput'

describe('ReasonInput', () => {
  it('shows credit suggestions on focus and filters by substring', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ReasonInput actionType="credit" aria-label="Credit reason" onChange={onChange} value="" />,
    )

    fireEvent.focus(screen.getByRole('combobox', { name: 'Credit reason' }))

    expect(screen.getByRole('option', { name: 'Goodwill credit' })).toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(5)

    rerender(<ReasonInput actionType="credit" aria-label="Credit reason" onChange={onChange} value="outage" />)
    fireEvent.focus(screen.getByRole('combobox', { name: 'Credit reason' }))

    expect(screen.getByRole('option', { name: 'Service outage compensation' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Goodwill credit' })).toBeNull()
  })

  it('selects a suggestion with the mouse', () => {
    const onChange = vi.fn()
    render(<ReasonInput actionType="override" aria-label="Override reason" onChange={onChange} value="" />)

    fireEvent.focus(screen.getByRole('combobox', { name: 'Override reason' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Pricing error' }))

    expect(onChange).toHaveBeenCalledWith('Pricing error')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('supports keyboard highlight, enter selection, and escape close', () => {
    const onChange = vi.fn()
    render(<ReasonInput actionType="credit" aria-label="Credit reason" onChange={onChange} value="" />)
    const input = screen.getByRole('combobox', { name: 'Credit reason' })

    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Goodwill credit' }).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('Goodwill credit')
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

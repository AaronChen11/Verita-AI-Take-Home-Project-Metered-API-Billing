import { useId, useMemo, useRef, useState } from 'react'

import { REASON_SUGGESTIONS } from '../lib/reasonSuggestions'
import type { ReasonActionType } from '../lib/reasonSuggestions'
import './ReasonInput.css'

type ReasonInputProps = {
  actionType: ReasonActionType
  'aria-label': string
  onChange: (value: string) => void
  placeholder?: string
  value: string
}

const MAX_SUGGESTIONS = 5

export function ReasonInput({ actionType, onChange, value, ...inputProps }: ReasonInputProps) {
  const inputId = useId()
  const listboxId = `${inputId}-listbox`
  const closeTimer = useRef<number | undefined>(undefined)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)

  const suggestions = useMemo(() => {
    const query = value.trim().toLowerCase()
    const source = REASON_SUGGESTIONS[actionType]
    const filtered = query.length === 0 ? source : source.filter((suggestion) => suggestion.toLowerCase().includes(query))

    return filtered.slice(0, MAX_SUGGESTIONS)
  }, [actionType, value])

  const visible = isOpen && suggestions.length > 0
  const activeId = visible && highlightedIndex !== null ? optionId(inputId, highlightedIndex) : undefined

  function open() {
    window.clearTimeout(closeTimer.current)
    setIsOpen(true)
  }

  function close() {
    setIsOpen(false)
    setHighlightedIndex(null)
  }

  function selectSuggestion(suggestion: string) {
    onChange(suggestion)
    close()
  }

  return (
    <div className="reason-combobox">
      <input
        {...inputProps}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={visible}
        onBlur={() => {
          closeTimer.current = window.setTimeout(close, 150)
        }}
        onChange={(event) => {
          onChange(event.target.value)
          setHighlightedIndex(null)
          setIsOpen(true)
        }}
        onFocus={open}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
            return
          }

          if (event.key === 'Tab') {
            close()
            return
          }

          if (!visible && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            setIsOpen(true)
            return
          }

          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setHighlightedIndex((current) => {
              if (current === null) return 0
              return Math.min(current + 1, suggestions.length - 1)
            })
            return
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlightedIndex((current) => {
              if (current === null || current === 0) return null
              return current - 1
            })
            return
          }

          if (event.key === 'Enter' && highlightedIndex !== null) {
            event.preventDefault()
            selectSuggestion(suggestions[highlightedIndex])
          }
        }}
        role="combobox"
        value={value}
      />
      {visible ? (
        <ul className="reason-listbox" id={listboxId} role="listbox">
          {suggestions.map((suggestion, index) => (
            <li
              aria-selected={highlightedIndex === index}
              className="reason-option"
              id={optionId(inputId, index)}
              key={suggestion}
              onMouseDown={(event) => {
                event.preventDefault()
                selectSuggestion(suggestion)
              }}
              role="option"
            >
              <HighlightedSuggestion query={value} suggestion={suggestion} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function optionId(inputId: string, index: number) {
  return `${inputId}-option-${index}`
}

function HighlightedSuggestion({ query, suggestion }: { query: string; suggestion: string }) {
  const trimmed = query.trim()
  if (!trimmed) return suggestion

  const start = suggestion.toLowerCase().indexOf(trimmed.toLowerCase())
  if (start === -1) return suggestion

  const end = start + trimmed.length

  return (
    <>
      {suggestion.slice(0, start)}
      <strong>{suggestion.slice(start, end)}</strong>
      {suggestion.slice(end)}
    </>
  )
}

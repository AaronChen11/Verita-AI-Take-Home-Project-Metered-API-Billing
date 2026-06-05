export const REASON_SUGGESTIONS = {
  credit: [
    'Goodwill credit',
    'Service outage compensation',
    'Billing error correction',
    'Contract adjustment',
    'Promotional credit',
    'Technical issue refund',
  ],
  override: [
    'Contract pricing correction',
    'Pricing error',
    'Sales discount applied',
    'Audit adjustment',
  ],
} satisfies Record<'credit' | 'override', string[]>

export type ReasonActionType = keyof typeof REASON_SUGGESTIONS

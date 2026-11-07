export type FindingType = 'email' | 'phone' | 'card' | 'api_key' | 'national_id'

export interface Finding {
  type: FindingType
  start: number
  end: number
  text: string
  confidence: 'high' | 'ambiguous'
  review?: { label: 'sensitive' | 'not_sensitive'; reason: string }
  reviewError?: string
  reviewHalt?: 'budget_exhausted' | 'circuit_open'
}

export const TYPE_LABELS: Record<FindingType, string> = {
  email: 'Email',
  phone: 'Phone',
  card: 'Card number',
  api_key: 'API key',
  national_id: 'ID number',
}

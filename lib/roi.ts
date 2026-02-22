export interface ActionValue {
  actionType: 'member_reengaged' | 'member_won_back' | 'lead_converted' | 'payment_recovered' | 'equipment_alert' | 'other'
  estimatedValue: number
  basis: string
  confidence: 'high' | 'medium' | 'low'
}

const DEFAULT_VALUES = {
  member_reengaged: 130,    // 1 month avg membership
  member_won_back: 390,     // 3 months (acquisition cost avoided)
  lead_converted: 260,      // 2 months LTV
  payment_recovered: 0,     // set from actual amount
  equipment_alert: 0,
  other: 0,
}

export function estimateActionValue(
  actionType: ActionValue['actionType'],
  membershipValue: number = 130,
  actualAmount?: number
): ActionValue {
  const base = membershipValue / 130  // scale from default

  switch (actionType) {
    case 'member_reengaged':
      return {
        actionType,
        estimatedValue: Math.round(DEFAULT_VALUES.member_reengaged * base),
        basis: `1 month avg membership ($${membershipValue})`,
        confidence: 'medium',
      }
    case 'member_won_back':
      return {
        actionType,
        estimatedValue: Math.round(DEFAULT_VALUES.member_won_back * base),
        basis: `3 months avg membership — acquisition cost avoided`,
        confidence: 'medium',
      }
    case 'lead_converted':
      return {
        actionType,
        estimatedValue: Math.round(DEFAULT_VALUES.lead_converted * base),
        basis: `2 months estimated LTV ($${membershipValue}/mo)`,
        confidence: 'medium',
      }
    case 'payment_recovered':
      return {
        actionType,
        estimatedValue: actualAmount ?? 0,
        basis: 'Actual payment amount',
        confidence: 'high',
      }
    case 'equipment_alert':
      return {
        actionType,
        estimatedValue: 0,
        basis: 'No direct revenue impact',
        confidence: 'low',
      }
    default:
      return {
        actionType,
        estimatedValue: 0,
        basis: 'No direct revenue impact',
        confidence: 'low',
      }
  }
}

export function calcROI(valueRetained: number, agentCost: number): number {
  if (agentCost === 0) return 0
  return Math.round(valueRetained / agentCost)
}

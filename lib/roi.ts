export interface ActionValue {
  actionType: 'member_reengaged' | 'member_won_back' | 'lead_converted' | 'payment_recovered' | 'equipment_alert' | 'other'
  estimatedValue: number
  basis: string
  confidence: 'high' | 'medium' | 'low'
}

const DEFAULT_MEMBERSHIP_VALUE = 150

export function estimateActionValue(
  actionType: ActionValue['actionType'],
  membershipValue?: number,
  actualAmount?: number
): ActionValue {
  const mv = membershipValue ?? DEFAULT_MEMBERSHIP_VALUE

  switch (actionType) {
    case 'member_reengaged':
      return {
        actionType,
        estimatedValue: mv,
        basis: `1 month membership ($${mv})`,
        confidence: 'medium',
      }
    case 'member_won_back':
      return {
        actionType,
        estimatedValue: mv * 3,
        basis: `3 months avg membership — acquisition cost avoided`,
        confidence: 'medium',
      }
    case 'lead_converted':
      return {
        actionType,
        estimatedValue: mv * 2,
        basis: `2 months estimated LTV ($${mv}/mo)`,
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

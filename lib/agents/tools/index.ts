/**
 * Tool system entry point.
 *
 * Importing this module registers all built-in tool groups.
 * Connector adapters can register additional tools after import.
 */

export { registerToolGroup, registerTool, getToolsForGroups, getToolByName, toAnthropicTools, _clearRegistry } from './registry'
export type { AgentTool, ToolGroup, ToolContext, AutonomyMode, SessionStatus, SessionEvent, SessionConfig, ResumeInput, AgentSession, PendingApproval, WorkingSet, SessionContext, SessionOutput, SessionCreatedBy, NudgeSchedule } from './types'

import { registerToolGroup } from './registry'
import { dataToolGroup } from './data-tools'
import { actionToolGroup } from './action-tools'
import { outputToolGroup } from './output-tools'
import { learningToolGroup } from './learning-tools'

// Register built-in groups on first import
let _registered = false
export function ensureToolsRegistered(): void {
  if (_registered) return
  registerToolGroup(dataToolGroup)
  registerToolGroup(actionToolGroup)
  registerToolGroup(outputToolGroup)
  registerToolGroup(learningToolGroup)
  _registered = true
}

/** Reset registration state (for tests) */
export function _resetRegistration(): void {
  _registered = false
}

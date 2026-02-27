/**
 * Tool registry — open map of tool groups.
 *
 * Tool groups are loaded lazily and can be extended by connectors.
 * Adding a new tool = write the function + register it here.
 */

import type { AgentTool, ToolGroup } from './types'

// ── Registry (mutable map — connectors can register at startup) ──────────

const groups = new Map<string, ToolGroup>()

/**
 * Register a tool group. Replaces any existing group with the same name.
 */
export function registerToolGroup(group: ToolGroup): void {
  groups.set(group.name, group)
}

/**
 * Register a single tool into an existing group (or create the group).
 * Used by connector adapters to add tools at startup.
 */
export function registerTool(groupName: string, tool: AgentTool): void {
  const existing = groups.get(groupName)
  if (existing) {
    // Replace if same name exists, otherwise append
    const idx = existing.tools.findIndex(t => t.name === tool.name)
    if (idx >= 0) {
      existing.tools[idx] = tool
    } else {
      existing.tools.push(tool)
    }
  } else {
    groups.set(groupName, { name: groupName, tools: [tool] })
  }
}

/**
 * Get all tools from the requested groups.
 * Unknown group names are silently skipped.
 */
export function getToolsForGroups(groupNames: string[]): AgentTool[] {
  const tools: AgentTool[] = []
  for (const name of groupNames) {
    const group = groups.get(name)
    if (group) {
      tools.push(...group.tools)
    }
  }
  return tools
}

/**
 * Look up a single tool by name across all groups.
 */
export function getToolByName(name: string): AgentTool | null {
  for (const group of groups.values()) {
    const tool = group.tools.find(t => t.name === name)
    if (tool) return tool
  }
  return null
}

/**
 * Convert AgentTools to Anthropic tool format for the API call.
 */
export function toAnthropicTools(tools: AgentTool[]): Array<{
  name: string
  description: string
  input_schema: AgentTool['input_schema']
}> {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))
}

/**
 * Get all registered group names.
 */
export function getRegisteredGroups(): string[] {
  return Array.from(groups.keys())
}

/**
 * Clear all registrations (for tests).
 */
export function _clearRegistry(): void {
  groups.clear()
}

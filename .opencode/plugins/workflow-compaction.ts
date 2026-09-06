import type { Plugin } from "@opencode-ai/plugin"

/**
 * Injects workflow state into the compaction prompt so auto-compaction
 * does not lose track of the current SuperAgents workflow phase.
 */
export const WorkflowCompaction: Plugin = async ({ directory }) => {
  return {
    "experimental.session.compacting": async (_input, output) => {
      output.context.push(`## Workflow State (MANDATORY to preserve)

The session may be running a SuperAgents workflow. The file \`.opencode/scratchpad.md\` in the project directory (${directory}) is the authoritative record of workflow state: current feature, phase, gate status, plan path, worktree path, task checklist, and the current architect task_id.

In the continuation summary you MUST include:
1. The current workflow phase and gate status exactly as recorded in .opencode/scratchpad.md
2. The task number currently being executed (e.g. "Task 3 of 9") and which tasks are done
3. Absolute paths: plan file, spec file, active worktree
4. Any pending NEEDS_APPROVAL gate and what decision is awaited
5. The instruction: "Read .opencode/scratchpad.md before proceeding and resume from the recorded state."`)
    },
  }
}

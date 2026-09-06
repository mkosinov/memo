import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Return the current agent's session/task ID (ses_...). Call this FIRST in any subtask so the orchestrator can resume the session if it is interrupted.",
  args: {},
  async execute(_args, context) {
    return `task_id: ${context.sessionID}`
  },
})

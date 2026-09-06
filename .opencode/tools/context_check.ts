import { tool } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"

const HANDOFF_THRESHOLD = 150_000
const DB_PATH = `${process.env.HOME}/.local/share/opencode/opencode.db`

export default tool({
  description:
    "Check current session context size (input tokens of the last LLM call). " +
    "Call BEFORE every subagent dispatch. If status is HANDOFF_RECOMMENDED, stop dispatching " +
    "and end your phase report with Status: HANDOFF so the orchestrator can resume in a fresh session.",
  args: {},
  async execute(_args, context) {
    try {
      const db = new Database(DB_PATH, { readonly: true })
      const row = db
        .query(
          `SELECT json_extract(data, '$.tokens.input') AS input
           FROM message
           WHERE session_id = ? AND json_extract(data, '$.tokens.input') > 0
           ORDER BY time_created DESC
           LIMIT 1`,
        )
        .get(context.sessionID) as { input: number } | null
      db.close()

      if (!row || row.input == null) {
        return `status: OK\ninput_tokens: unknown (no recorded calls yet — treat as small)\nthreshold: ${HANDOFF_THRESHOLD}`
      }

      const status = row.input >= HANDOFF_THRESHOLD ? "HANDOFF_RECOMMENDED" : "OK"
      return [
        `status: ${status}`,
        `input_tokens: ${row.input}`,
        `threshold: ${HANDOFF_THRESHOLD}`,
        status === "HANDOFF_RECOMMENDED"
          ? "action: do NOT dispatch. End your phase report with Status: HANDOFF, Resume From: <next task>, and Scratchpad Delta."
          : "action: proceed with dispatch.",
      ].join("\n")
    } catch (err) {
      // Never block the workflow on a measurement failure.
      return `status: OK\ninput_tokens: unavailable (${String(err)})\nthreshold: ${HANDOFF_THRESHOLD}\naction: measurement failed — proceed with dispatch.`
    }
  },
})

# Codex project setup

Memo's repository-wide instructions live in the root `AGENTS.md`, which Codex reads when working from this repository. A file at `.codex/AGENTS.md` would be scoped to work inside `.codex/`; it is not a substitute for the root instruction file.

## Files

- `config.toml` contains project-level Codex settings and custom agent role declarations. Codex loads this project configuration only when the repository is trusted.
- `agents/plan-reviewer.toml` defines the read-only plan-reviewer role declared by `config.toml`.
- Project skills are stored in the sibling `.agents/skills/<skill-name>/SKILL.md` tree. The GitHub board skill points to the shared Memo board rules and script.

Keep Codex-specific configuration here, portable workflow skills under `.agents/skills/`, and shared repository rules in the root `AGENTS.md`.

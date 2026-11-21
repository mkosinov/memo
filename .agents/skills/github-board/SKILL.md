---
name: github-board
description: Read or update Memo's GitHub Project board. Use when the user asks about board cards or statuses, selects an issue, or a workflow changes an issue's stage.
---

Follow the board rules in the repository's root `AGENTS.md` and the complete shared procedure in `.zcode/skills/github-board/SKILL.md`.

All board reads and writes go through the repository script:

```bash
python3 .zcode/scripts/gh_board.py show all
python3 .zcode/scripts/gh_board.py show <issue-number>
```

Use `show all` to inspect the board, then filter its output when the user asks for a particular status. Never issue handwritten GraphQL requests for the board. For any status update, priority question, gate, ownership field, or issue creation, follow the shared procedure before acting. Priority is user-managed and agents only read it.

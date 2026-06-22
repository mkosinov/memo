# Fast Track Protocol (FTP)

## When to Use
After accepting a PR, when quick code edits are needed without procedural overhead.

## Commands
- `/FTP_START <description>` — Initiate a fast-track code edit (code only, no tests/docs/review)
- `/FTP_END` — All edits complete; trigger the full procedural package

## Phase 1: Fast Track (Code Only)
The Architect launches `frontend-coder` or `backend-coder` with the following constraint:
- **ONLY update the code according to the description.**
- No other actions are permitted under any circumstances.
- Edit only the specified code.
- DO NOT update tests.
- DO NOT update documentation.
- DO NOT run linters / formatters.
- DO NOT perform code-quality review.

Multiple `/FTP_START` commands can be issued sequentially or in parallel if edits are independent.

## Phase 2: Procedural
The `/FTP_END` command triggers the complete procedural package:
1. `code-quality-reviewer` — Review the final code.
2. `spec-reviewer` — Verify compliance with the specification (if applicable).
3. **Tests** — Run the project's test suite.
4. `docser` — Update documentation based on the changes.
5. Commit / finalize PR.

## Example Session
```
/FTP_START Change Submit button color to primary
/FTP_START Add 16px margin below the heading
/FTP_END → code-quality + spec-review → tests → docser → commit
```

## Forbidden in Phase 1
- Running `code-quality-reviewer`, `spec-reviewer`, or `docser`
- Modifying tests
- Updating README / API docs
- Running pre-commit hooks

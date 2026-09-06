---
name: skill-creator
description: >
  Create, modify, and improve OpenCode skills. Use when the user asks to create a new skill from scratch,
  edit or optimize an existing skill, run evaluations to test a skill, or improve a skill's description
  for better triggering accuracy. Also use when the user says "turn this into a skill", "make a skill for X",
  "improve this skill", or wants to benchmark/iterate on skill performance.
---

# Skill Creator (OpenCode Adaptation)

A skill for creating new skills and iteratively improving them, adapted for OpenCode environment.

At a high level, the process of creating a skill goes like this:

- Decide what you want the skill to do and roughly how it should do it
- Write a draft of the skill
- Run test prompts using the skill
- Evaluate results qualitatively (and quantitatively if possible)
- Rewrite the skill based on feedback
- Repeat until satisfied

> **Note:** This is adapted from Anthropic's Claude Code skill-creator. OpenCode doesn't have subagents or `claude -p` CLI, so some features (parallel test execution, blind A/B comparison, automated description optimization via `run_loop.py`) are not available. The core workflow — draft → test → review → improve — works fully.

---

## Creating a Skill

### Capture Intent

Start by understanding the user's intent. If the conversation already contains a workflow the user wants to capture, extract from the conversation history: tools used, sequence of steps, corrections, input/output formats.

1. **What** should this skill enable the agent to do?
2. **When** should it trigger? (what user phrases/contexts)
3. **What's the expected output format?**
4. **Should we set up test cases?** Skills with objectively verifiable outputs (file transforms, data extraction, fixed workflows) benefit from tests. Subjective skills (writing style, design) often don't need them.

### Interview and Research

Ask about edge cases, input/output formats, example files, success criteria, dependencies. Check available MCP servers for research if useful.

### Write the SKILL.md

Based on the interview, fill in these components:

- **`name`**: Skill identifier (kebab-case)
- **`description`**: When to trigger, what it does. This is the primary triggering mechanism. Make descriptions slightly "pushy" — include both what the skill does AND specific contexts for when to use it.
- **`compatibility`**: Required tools, dependencies (optional)
- **The rest of the skill**: Markdown instructions following OpenCode format

**OpenCode Skill Structure:**
```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
├── scripts/   - Executable code for repetitive tasks
├── references/ - Docs loaded into context as needed
└── assets/    - Files used in output (templates, icons, fonts)
```

### Writing Patterns

- Keep SKILL.md under 500 lines; if approaching this limit, add hierarchy with pointers.
- Use imperative form in instructions.
- Include examples with Input/Output format.
- Reference files clearly from SKILL.md with guidance on when to read them.
- Explain **why** things are important instead of heavy-handed MUSTs.

### Test Cases

After writing the skill draft, come up with 2-3 realistic test prompts. Share them with the user, then test manually by invoking the skill with each prompt.

---

## Running and Evaluating Test Cases

Unlike the Claude Code version, OpenCode doesn't support parallel subagent spawning. Run test cases **sequentially** by invoking the skill with each test prompt and evaluating the output.

### Step 1: Test with the skill

For each test case, invoke the skill using the `skill` tool, then present the prompt to the agent with the skill loaded. Save outputs for comparison.

### Step 2: Evaluate

Grade each run qualitatively:
- Did the skill produce the expected output?
- Were the instructions followed correctly?
- What could be improved?

### Step 3: Iterate

Apply improvements to the skill, retest, and repeat until the user is satisfied.

---

## Improving the Skill

1. **Generalize from feedback** — don't overfit to specific test cases. The skill should work across many different prompts.
2. **Keep the prompt lean** — remove things that aren't pulling their weight.
3. **Explain the why** — explain reasoning so the model understands why things are important.
4. **Look for repeated work** — if test cases all independently do similar work, bundle it into scripts/.

---

## Description Optimization

The description in SKILL.md frontmatter is the primary trigger. To optimize it:

1. **Analyze** what types of user requests should trigger this skill
2. **Identify** near-misses (requests that share keywords but shouldn't trigger)
3. **Rewrite** the description to be more precise and "pushy"
4. **Test** with the user by describing scenarios and asking if the description would catch them

The automated optimization loop (`run_loop.py`) requires the `claude` CLI which is not available in OpenCode. Manual optimization with user feedback works well.

---

## OpenCode Compatibility Notes

| Feature | Available? | Notes |
|---------|-----------|-------|
| Draft skill | ✅ Yes | Write SKILL.md directly |
| Test prompts | ✅ Yes | Invoke skill + run prompt manually |
| Iterate | ✅ Yes | Edit SKILL.md, retest |
| Quantitative evals | ⚠️ Partial | Run scripts manually from `scripts/` |
| Subagents | ❌ No | Run tests sequentially |
| `claude -p` CLI | ❌ No | Use manual description optimization |
| Eval viewer | ⚠️ Partial | `eval-viewer/generate_review.py` works with `--static` |
| Blind comparison | ❌ No | Not supported without subagents |
| Package skill | ✅ Yes | `python -m scripts.package_skill` works |

---

## Bundled Resources

- **`scripts/`** — Python scripts for aggregation, packaging, validation
- **`references/schemas.md`** — JSON schemas for evals, grading, benchmarks
- **`agents/`** — Subagent instruction templates (for reference — not directly usable without subagent support)
- **`assets/eval_review.html`** — Template for reviewing eval queries
- **`eval-viewer/`** — HTML viewer for test results (`generate_review.py`)

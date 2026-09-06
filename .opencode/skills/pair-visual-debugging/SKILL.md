---
name: pair-visual-debugging
description: Use when debugging UI bugs or verifying visual changes in a running dev environment. NEVER use console.log debugging — use Playwright screenshots + DOM dumps against the partner's already-running dev.sh. NEVER kill or restart dev processes without explicit partner consent.
---

# Pair Visual Debugging

## Core Protocol

**The partner (user) owns `dev.sh`.** You are a guest in their browser session.

### Rule 1: Never Touch Dev Processes
- **DO NOT** kill, restart, or interfere with `dev.sh` or any Next.js/turbo processes the partner started
- **DO NOT** start your own dev server unless partner explicitly says "start your own"
- If you need a different port or config — ask the partner to restart with the right params
- `pkill`, `kill`, `npx next dev` are FORBIDDEN without explicit partner OK

### Rule 2: Never Use console.log for Visual Debugging
- `console.log` in component code can cause `ReferenceError` (TDZ), crash the component, and waste time
- It also pollutes the partner's browser console and requires a full page reload
- Instead, use **Playwright screenshots + DOM dumps** against the partner's running server

### Rule 3: Visual Check via Playwright (Preferred)
Use the script at `scripts/screenshot.js`. It:
1. Connects to the partner's running dev server (`localhost:3001` for admin, `localhost:3000` for web)
2. Takes a screenshot saved to `/tmp/pair-debug-screenshot.png`
3. Dumps the first matching card/component HTML to stdout
4. Returns both artifacts to you

Run it:
```bash
cd /root/workspace/memo && node .opencode/skills/pair-visual-debugging/scripts/screenshot.js
```

Read the screenshot via the `Read` tool (it reads images). Compare DOM output to expected structure.

### Rule 4: When Partner Reports a Bug
1. First, **read the DOM** via Playwright — don't ask the partner to open DevTools
2. If the DOM is empty or missing expected elements, trace the data flow:
   - API response format (`ActivityResponse`)
   - Transformer/mapper layer (`transformActivity`)
   - Enrichment layer (`toScheduleItems`)
   - Index layer (`toScheduleIndex`)
   - Component render props
3. Only if the bug is **confirmed in code** (not a rendering glitch) — dispatch `frontend-coder` with full analysis
4. After fix, **verify via Playwright** — do not ask partner to check

### Rule 5: When Partner Says "Look at the Site"
1. Check which port: `localhost:3000` (web/public) or `localhost:3001` (admin)
2. Run `scripts/screenshot.js` targeting the correct port
3. Read the screenshot + DOM dump
4. Report what you see

## Script: `scripts/screenshot.js`

Reads `process.argv` for optional port (default: `3001`).
- `node scripts/screenshot.js 3000` → web
- `node scripts/screenshot.js 3001` → admin (default)

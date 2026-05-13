# AGENTS.md

## Purpose

This repo helps Codex draft weekly MyTime entries using two inputs:

1. MyTime state from the local CLI/MCP server in `src/`
2. Work evidence from connected tools: Outlook Calendar, Outlook Email, Teams, Slack, SharePoint, and other connected context

The local code does not read Microsoft 365 or Slack APIs directly. Codex should use the platform connectors that are available in-session for those systems, then use this repo's MyTime tools to understand gaps and create draft entries.

Inference rules are defined in [docs/inference-rules.md](docs/inference-rules.md). Follow them by default unless the user overrides them.

## Default workflow

1. Run `mytime_get_week_draft_context` first.
2. Focus only on days where `missingHours > 0`.
3. For each missing day, review:
   - Outlook Calendar for meetings and blocks on that date
   - Outlook Email for meaningful threads or follow-ups on that date
   - Teams for chats/channel work on that date
   - Slack for channel/DM activity on that date
   - SharePoint for meaningful document editing or review activity on that date when needed
4. Infer both likely project allocation and approximate hours from that evidence instead of defaulting everything to Available time.
5. Treat explicit calendar tags as the strongest signal. `Sales` maps to business development.
6. Do not allocate project time from calendar invites whose show-as status is `Free`.
7. Treat `Marathon`, `Marathon Petroleum`, and `MPC` as the same project family and map them to the MPC MyTime project unless stronger evidence points elsewhere.
8. Draft concise descriptions grounded in real evidence. Do not invent work.
9. Keep entries as drafts unless the user explicitly asks to post them.

## Commands

```bash
npx tsx src/index.ts auth
npx tsx src/index.ts status
npx tsx src/index.ts raw-week --week 5/11/2026
npx tsx src/index.ts draft-entry --date 5/12/2026 --hours 2
npx tsx src/index.ts delete-entry --id <time-entry-id> --week 5/11/2026
npm run draft-context
npx tsx src/index.ts weekly-draft-context --week 5/11/2026
npm run mcp
npm run build
```

## MCP tools

- `mytime_get_week_status`
- `mytime_get_week_dates`
- `mytime_get_week_draft_context`
- `mytime_get_approvals`
- `mytime_draft_entry`

`mytime_get_week_draft_context` is the primary starting point. It returns the requested week range, existing entries by day, total logged hours, missing hours, and a suggested drafting prompt for each incomplete day.

## Code map

```text
src/
  auth.ts               Playwright headful Entra login. Caches JWT to ~/.mytime-helper/token.json.
  config.ts             Local config storage for approval filters.
  index.ts              CLI entrypoint.
  mcp-server.ts         MCP server entrypoint.
  mytime-client.ts      MyTime REST client, including targeted draft create/delete helpers.
  time-utils.ts         Week/date helpers.
  week-draft-context.ts Shared context builder for weekly drafting gaps.
```

## Guardrails

- Treat Calendar as the primary signal and Email, Teams, Slack, and SharePoint as supporting signals for project inference and hour estimation.
- Use calendar duration as the anchor, then adjust with email, chat, and document evidence when it clearly supports additional work.
- Prefer short descriptions that summarize the work, for example: `Business development follow-up, client outreach, planning, and internal coordination`.
- If evidence is thin or ambiguous, make a reasonable first-pass assumption, but avoid highly specific claims that are not supported.
- Do not invent work based on weak signals.
- Never overwrite existing project time with generic Available time.

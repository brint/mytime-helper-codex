# mytime-helper-codex

CLI and MCP server for viewing, drafting, and approving time entries in [MyTime](https://mytime.slalom.com/), extended for Codex-driven weekly time drafting.

The intended use is that Codex acts as the agent: it reads MyTime state from this repo, pulls evidence from connected Outlook, Slack, Teams, SharePoint, and other in-session tools, then makes a reasonable project-and-hours decision for missing time.

## What This Repo Does

- Authenticates to MyTime and reads or creates draft entries
- Exposes MyTime as an MCP server for Codex
- Provides a weekly drafting context tool that identifies missing hours by day and exposes existing entries
- Provides targeted draft and delete helpers for refreshing stale weekly drafts
- Documents the expected Codex workflow for combining MyTime with Outlook Calendar, Outlook Email, Teams, Slack, and SharePoint evidence
- Defines default inference rules for likely project allocation and approximate hours

This repo does not directly call Microsoft 365 or Slack APIs from Node. Codex should use the in-session connectors for those systems and this repo's MyTime tools for the time-entry side.

## Intended workflow

1. Codex reads the target week from MyTime with `mytime_get_week_draft_context`.
2. Codex looks only at days with missing time or days whose existing draft needs to be refreshed.
3. Codex pulls supporting evidence from Outlook Calendar, Outlook Email, Teams, Slack, SharePoint, and other connected tools.
4. Codex infers which project the time likely belongs to and about how many hours to allocate.
5. Codex creates or refreshes MyTime draft entries without inventing unsupported work.

Calendar is the primary signal. Email, Teams, Slack, and SharePoint are supporting signals used to strengthen or adjust the allocation.

## Setup

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Build the CLI and MCP server

```bash
npm run build
```

### 3. Add the MCP server using Codex repo conventions

This repo uses a repo-level [`.mcp.json`](.mcp.json) file for Codex:

```json
{
  "mcpServers": {
    "mytime": {
      "command": "npx",
      "args": ["tsx", "src/mcp-server.ts"]
    }
  }
}
```

If Codex is running from this repo, that is the expected MCP configuration pattern.

## Authentication

On first run, a browser window opens for Entra login. Complete the login and MFA flow; the access token is cached at `~/.mytime-helper/token.json`.

```bash
npx tsx src/index.ts auth
```

## CLI

```bash
npx tsx src/index.ts auth
npx tsx src/index.ts status
npx tsx src/index.ts raw-week --week 5/11/2026
npx tsx src/index.ts draft --dry-run
npx tsx src/index.ts draft-entry --date 5/12/2026 --hours 2
npx tsx src/index.ts delete-entry --id <time-entry-id> --week 5/11/2026
npx tsx src/index.ts approvals
npx tsx src/index.ts weekly-draft-context --week 5/11/2026 --target-hours 8
npm run build
npm run mcp
```

### `weekly-draft-context`

Returns structured JSON describing the current week, total logged hours per day, missing hours, existing entries, and guidance for Codex to use with connected Calendar, Email, Teams, Slack, and SharePoint context.

```bash
npm run draft-context
npx tsx src/index.ts weekly-draft-context --week 5/11/2026 --target-hours 8
```

## MCP server

Start the local MCP server directly:

```bash
npm run mcp
```

### Tools

- `mytime_get_week_dates`
- `mytime_get_week_status`
- `mytime_get_week_draft_context`
- `mytime_get_approvals`
- `mytime_draft_entry`

## Codex workflow

1. Call `mytime_get_week_draft_context`.
2. Review dates with `missingHours > 0`, or inspect an already-drafted week that needs to be refreshed.
3. Pull evidence for those dates from Outlook Calendar first, then Outlook Email, Teams, Slack, and SharePoint as needed.
4. Use the evidence to make a project mapping decision, not just to summarize activity.
5. Draft concise, truthful descriptions for the time being added or refreshed.
6. Create MyTime draft entries with `mytime_draft_entry` or the CLI `draft-entry` flow.
7. When a week needs to be rewritten, inspect current rows with `raw-week` and remove stale rows with `delete-entry` before re-drafting.

This repo is intended for agentic use: Codex should do the evidence gathering and project inference work, then use these local MyTime tools to update the week.

## Inference defaults

See [docs/inference-rules.md](docs/inference-rules.md).

Current defaults include:

- Codex should make a reasonable first-pass assumption about which projects missing time belongs to and about how many hours to allocate.
- Outlook Calendar is the primary signal, especially when entries are explicitly tagged.
- Calendar duration is the anchor, but it can be adjusted when email, chat, or document activity clearly supports additional work.
- `Sales` calendar tags map to business development.
- `Marathon`, `Marathon Petroleum`, and `MPC` all map to the MPC MyTime project unless stronger evidence points elsewhere.
- Calendar invites marked `Free` should not contribute project hours.
- Email, Teams, Slack, and SharePoint activity should be used to strengthen or adjust the allocation.
- Existing logged project time should not be overwritten with generic Available time.

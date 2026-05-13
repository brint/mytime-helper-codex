# mytime-helper-codex

CLI and MCP server for viewing, drafting, and approving time entries in [MyTime](https://mytime.slalom.com/), extended so Codex can use Calendar, Email, Teams, Slack, SharePoint, and other connected context to draft weekly time.

## What This Repo Does

- Authenticates to MyTime and reads or creates draft entries
- Exposes MyTime as an MCP server for Codex
- Provides a weekly drafting context tool that identifies missing hours by day
- Documents the expected Codex workflow for combining MyTime with Outlook Calendar, Outlook Email, Teams, Slack, and SharePoint evidence
- Defines default inference rules for likely project allocation and approximate hours

This repo does not directly call Microsoft 365 or Slack APIs from Node. Codex should use the in-session connectors for those systems and this repo's MyTime tools for the time-entry side.

## Setup

```bash
npm install
npx playwright install chromium
```

## Authentication

On first run, a browser window opens for Entra login. Complete the login and MFA flow; the access token is cached at `~/.mytime-helper/token.json`.

```bash
npx tsx src/index.ts auth
```

## CLI

```bash
npx tsx src/index.ts status
npx tsx src/index.ts draft --dry-run
npx tsx src/index.ts approvals
npx tsx src/index.ts weekly-draft-context
```

### `weekly-draft-context`

Returns structured JSON describing the current week, total logged hours per day, missing hours, existing entries, and guidance for Codex to use with connected Calendar, Email, Teams, Slack, and SharePoint context.

```bash
npm run draft-context
npx tsx src/index.ts weekly-draft-context --week 5/11/2026 --target-hours 8
```

## MCP server

Start the local MCP server:

```bash
npm run mcp
```

Example `.claude/settings.json` entry:

```json
{
  "mcpServers": {
    "mytime": {
      "command": "npx",
      "args": ["tsx", "/Users/brintohearn/src/mytime-helper-codex/src/mcp-server.ts"]
    }
  }
}
```

### Tools

- `mytime_get_week_dates`
- `mytime_get_week_status`
- `mytime_get_week_draft_context`
- `mytime_get_approvals`
- `mytime_draft_entry`

## Codex workflow

1. Call `mytime_get_week_draft_context`.
2. Review only dates with missing hours.
3. Pull evidence for those dates from Outlook Calendar, Outlook Email, Teams, and Slack.
4. Draft concise, truthful descriptions for the missing time.
5. Create MyTime draft entries only after the user is comfortable with the proposal.

## Inference defaults

See [docs/inference-rules.md](/Users/brintohearn/src/mytime-helper-codex/docs/inference-rules.md).

Current defaults include:

- Codex should make a reasonable first-pass assumption about which projects missing time belongs to and about how many hours to allocate.
- Outlook Calendar is the primary signal, especially when entries are explicitly tagged.
- `Sales` calendar tags map to business development.
- `Marathon`, `Marathon Petroleum`, and `MPC` all map to the MPC MyTime project unless stronger evidence points elsewhere.
- Calendar invites marked `Free` should not contribute project hours.
- Email, Teams, Slack, and SharePoint activity should be used to strengthen or adjust the allocation.

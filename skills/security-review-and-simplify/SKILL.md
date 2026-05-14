---
name: security-review-and-simplify
description: Use when the user asks for a security review, hardening changes, code simplification, or a combined pass that should identify concrete risks, reduce unnecessary complexity, validate the result, and prepare a safe commit.
---

# Security Review And Simplify

Use this skill when the task is security-focused, simplification-focused, or both.

## Goals

1. Find real security and robustness issues before proposing cleanup.
2. Prefer smaller, clearer code over clever code.
3. Remove duplication when it improves correctness, not just style.
4. Validate the repo after edits before committing.

## Review workflow

1. Read `AGENTS.md` and any task-specific docs first.
2. Inspect the smallest relevant surface area before editing.
3. Look for findings in this order:
   - unsafe input handling and missing validation
   - secrets, tokens, auth flows, and data exposure
   - overly broad destructive operations
   - duplicated logic that can drift
   - dead code and unnecessary branches
4. If the user asked for a review, report findings first with severity and file references.
5. If the user asked for fixes, make the narrowest change set that hardens and simplifies the code.

## Editing rules

- Prefer shared validation helpers over repeated inline parsing.
- Prefer deleting or consolidating code over adding new layers.
- Preserve existing behavior unless the current behavior is risky or clearly broken.
- Do not invent vulnerabilities. Call out uncertainty explicitly.
- Avoid cosmetic churn that makes the review harder.

## Repo-specific focus

In this repo, prioritize:

- `src/auth.ts` for token handling and browser auth flow
- `src/mcp-server.ts` for tool input validation and unsafe tool behavior
- `src/index.ts` for CLI input validation, destructive commands, and duplicated control flow
- `src/mytime-client.ts` for API request shaping and unsafe defaults
- `src/config.ts` and `src/time-utils.ts` for shared parsing and persistence helpers

## Validation

Run these after changes:

```bash
npm run build
npm run lint
```

If you changed CLI or MCP entrypoints, also smoke test:

```bash
node dist/src/index.js --help
```

Do not commit until validation is complete, or explicitly note what could not be verified.

# AI Context — MKT-Workshop-Ops GitHub Actions

This file exists so a future AI session can pick up exactly where the previous
one left off. Paste it in at the start of a new conversation.

---

## What this repo does

Two GitHub Actions workflows that replace old SFMC CloudPage/SSJS automations:

1. **Create Business Unit** — replaces `1.1 Create Business Unit`, `1.2 Update Business Unit Settings`, `1.3 Add Admin Users to BU`
2. **Create Users** — replaces `2.1 Create Student Users`, `2.2 Update Student Users`

Both are triggered via **GitHub Issue Forms** (preferred) or `workflow_dispatch` (fallback for scripted/CLI runs).

---

## Repo structure

```
.github/
  ISSUE_TEMPLATE/
    create-business-unit.yml   # Issue Form — one input: Business Unit Name
    create-users.yml           # Issue Form — two inputs: BU Name + User List textarea
  workflows/
    create-business-unit.yml         # workflow_dispatch fallback
    create-business-unit-issue.yml   # issues: [labeled] trigger (preferred)
    create-users.yml                 # workflow_dispatch fallback
    create-users-issue.yml           # issues: [labeled] trigger (preferred)
    delete-bu.yml                    # one-off workflow_dispatch for deleting a BU by name
scripts/
  run.js                      # Create BU automation (Steps 1-4)
  create-users.js             # Create Users automation (Create + MustChangePassword Update per user)
  sfmc-client.js              # SfmcClient class — all SOAP/REST calls live here
  parse-bu-issue-body.js      # Parses create-BU issue body -> BU_NAME in GITHUB_ENV
  parse-issue-body.js         # Parses create-users issue body -> TARGET_BU_NAME + USER_LIST in GITHUB_ENV
  delete-bu.js                # One-off: resolves BU name -> MID, calls SOAP Delete
package.json                  # scripts: create-bu, create-users, delete-bu
```

---

## Architecture decisions (the "why" behind the code)

### Issue Forms vs workflow_dispatch
GitHub's "Run workflow" web form renders `type: string` as a single-line box —
pasting multiple spreadsheet rows collapses them onto one line. Issue Forms
render `type: textarea` as a real multi-line `<textarea>`, which preserves
newlines. That's why the Issue Form path exists.

### `labeled`-only trigger (not `opened`)
When a label is defined in an issue template, GitHub fires **both** `opened`
and `labeled` simultaneously. If both are listed as triggers, two workflow runs
race each other — the second one fails ("duplicate external key" / "already
exists"). The fix: trigger on `labeled` only. Since both labels (`create-users`,
`create-business-unit`) now exist in the repo, they always get auto-applied at
submission time, so `labeled` fires exactly once.

### Two SOAP calls per user (Create, then Update)
SFMC's AccountUser `Create` call does not reliably honor `MustChangePassword=false`
at creation time. A separate `Update` call is always required afterward to set it.
This is why the original automation was two scripts — preserved as two sequential
SOAP calls per user inside one script run.

### BU name → MID resolution at runtime
Team members only know BU names, not MIDs. The script calls
`retrieveBusinessUnitMap()` (SOAP Retrieve on BusinessUnit) and resolves the
name to a MID before touching any users. Fails fast with a clear error if the
name doesn't match, before any users are created.

### GITHUB_STEP_SUMMARY is scoped per-step
`$GITHUB_STEP_SUMMARY` points to a **different file for every step** — a later
step reading it gets an empty file. Fix: `summaryLine()` in both `run.js` and
`create-users.js` writes to a shared temp file (`/tmp/create-bu-report.md` and
`/tmp/create-users-report.md`) in addition to `$GITHUB_STEP_SUMMARY`. The
"Post results" workflow step reads from the temp file.

### `permissions: contents: read` required alongside `issues: write`
Specifying any permission explicitly zeros out all other defaults. Adding only
`issues: write` drops the implicit `contents: read`, which breaks
`actions/checkout`. Both must be listed explicitly.

---

## Secrets and Variables

**Security constraint (verbatim):** Credentials never touch AI tooling — enter
secrets directly in GitHub's Secrets UI; nothing sensitive is passed through
chat or committed to the repo.

### Secrets (Settings → Secrets and variables → Actions → Secrets)
| Secret | Used by |
|---|---|
| `SFMC_SUBDOMAIN` | Both workflows |
| `SFMC_CLIENT_ID` | Both workflows |
| `SFMC_CLIENT_SECRET` | Both workflows |
| `DEFAULT_USER_PASSWORD` | Create Users only — fixed password for all new users |

### Variables (Settings → Secrets and variables → Actions → Variables)
| Variable | Used by | Notes |
|---|---|---|
| `SFMC_PARENT_MID` | Both | Enterprise parent MID — API auth context on every SOAP call |
| `NEST_UNDER_BU_MID` | Create BU | MID of the `!VIW Parent` BU — new BUs are nested under this |
| `BU_EMAIL` | Create BU | |
| `BU_FROM_NAME` | Create BU | |
| `COMPANY_NAME` | Create BU | |
| `COMPANY_ADDRESS` | Create BU | |
| `COMPANY_CITY` | Create BU | |
| `COMPANY_STATE` | Create BU | |
| `COMPANY_ZIP` | Create BU | |
| `COMPANY_COUNTRY` | Create BU | |
| `LOG_DE_KEY` | Create BU | ExternalKey of `Automation_Log_CreateBU` DE |
| `DEFAULT_ADMIN_USER_KEYS` | Create BU | Comma-separated AccountUser CustomerKeys — every new BU gets these admins |
| `DEFAULT_USER_ROLE_ID` | Create Users | Comma-separated Role ObjectIDs — currently Administrator + Marketing Cloud VIW |
| `DEFAULT_USER_EMAIL` | Create Users | Single shared email for all created users |
| `LOG_DE_KEY_CREATE_USERS` | Create Users | ExternalKey of `Automation_Log_CreateVIWStudent` DE |

---

## Labels (must exist in the repo for templates to auto-apply them)

| Label | Color | Triggers |
|---|---|---|
| `create-business-unit` | `#0075ca` | `create-business-unit-issue.yml` |
| `create-users` | `#0052cc` | `create-users-issue.yml` |

Both were created via `gh label create` — they exist in the repo already. If
the repo is ever re-created from scratch, recreate them before testing the
Issue Forms, otherwise the label silently won't apply and the workflow won't
fire.

---

## Issue Form flow (end-to-end)

1. Team member goes to **Issues → New issue → Create Users** (or Create Business Unit)
2. Fills in the form, submits
3. GitHub auto-applies the label → `labeled` event fires → workflow starts
4. **Step: Rename title** — renames the issue from "Create New Marketing Cloud Users" to
   `New User Creation - MM/DD/YYYY H:MMam/pm UTC` using `github.event.issue.created_at`
   (always UTC, not the submitter's local clock). Also posts "⏳ in progress…" comment.
5. **Step: Parse issue body** — `parse-issue-body.js` / `parse-bu-issue-body.js` extracts
   field values from the `### Heading` format GitHub Issue Forms produce, writes them to
   `GITHUB_ENV` using multiline heredoc syntax so the next step can read them.
6. **Step: Run automation** — `npm run create-users` / `npm run create-bu`. `continue-on-error: true` so the results comment always posts even on failure.
7. **Step: Post results** — reads `/tmp/create-users-report.md` (or `create-bu-report.md`) into an issue comment.
8. **Step: Close on success** — closes the issue as "completed" if automation succeeded.
9. **Step: Fail job** — exits 1 if automation failed (so the Actions run shows red).

---

## User list paste format (Create Users)

Column order: **Name first, Username second** — matching the source Google Sheet layout.

Three paste shapes all work:
- **Plain CSV**: `NTO Student 0001,MKT001_0001`
- **Tab-separated**: `NTO Student 0001\tMKT001_0001`
- **Google Sheets copy-paste**: Sheets injects `<google-sheets-html-origin><style>…</style>` + a markdown pipe table. `parseUserList()` strips the HTML wrapper, drops the `-- | --` separator row, and parses pipe-separated columns.

Header rows with literal values `"name"` / `"username"` (case-insensitive) are silently skipped so the team can copy-paste including the header without errors.

---

## Known SFMC behaviors / gotchas

- **`MustChangePassword=false` on Create is ignored** — must always follow up with a separate Update call. This is the entire reason `2.1` and `2.2` were two separate scripts originally.
- **Role ObjectIDs are org-specific** — `DEFAULT_USER_ROLE_ID` currently holds two GUIDs (Administrator + Marketing Cloud VIW). If the org is ever migrated or recreated, look up role GUIDs via SOAP Retrieve on `ObjectType Role`.
- **BU Name doubles as CustomerKey/ExternalKey** — the Create BU script sets `CustomerKey = BU Name`. If a BU by that name was ever deleted and recreated, SFMC may say "customer key already exists" even if the BU no longer appears in Setup — it retains the key in its records.
- **SFMC `dbo.AggregateUserRoles` error** — a transient SFMC internal error on role assignment during user creation. The user may have been created without the role. Check in Setup → Users and retry that one user.
- **"Username not available"** — user already exists in the org (possibly in a different BU). Skip or handle manually.

---

## How to resume in a new AI session

Paste the following prompt (adjust as needed):

> I'm working on a GitHub Actions repo at `https://github.com/melanie-pulido/MKT-Workshop-Ops`.
> It automates SFMC Marketing Cloud Business Unit creation and user creation via GitHub Issue Forms.
> The repo is cloned locally at `/tmp/mktviw`.
> Read `.github/ai-context.md` in the repo for full context on how everything works.
> [Then describe what you want to do next.]

The local clone at `/tmp/mktviw` may or may not persist between sessions — if it doesn't, re-clone:
```bash
gh repo clone melanie-pulido/MKT-Workshop-Ops /tmp/mktviw
```

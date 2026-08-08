# Create Business Unit — GitHub Actions

Recreates the old CloudPage automation (`1.1 Create Business Unit`, `1.2 Update
Business Unit Settings`, `1.3 Add Admin Users to BU`) as a single GitHub
Actions workflow. A team member enters a BU name (and optionally a custom
admin list) via the **Run workflow** form under the Actions tab — no CloudPage,
no Data Extension trigger row, no SSJS.

## How it works

1. `.github/workflows/create-business-unit.yml` defines a `workflow_dispatch`
   trigger with two inputs: `bu_name` (required) and `admin_user_keys`
   (optional, comma-separated AccountUser CustomerKeys).
2. The job runs `scripts/run.js`, which:
   - Authenticates to SFMC via REST OAuth (`client_credentials`).
   - Creates the Business Unit via the SOAP `Create` call (same payload shape
     as the old `1.1` script).
   - Updates `MasterUnsubscribeBehavior` to `BUSINESS_UNIT_ONLY` via SOAP
     `Update` (same as `1.2`).
   - Retrieves all Business Units to resolve the new BU's MID by name, then
     assigns each admin user to it via SOAP `Update` on `AccountUser` (same
     as `1.3`).
   - Logs each step to the same `Automation_Log_CreateBU` Data Extension,
     now via the REST Data Extension rowset endpoint instead of
     `Platform.Function.InsertData`.
   - Writes a human-readable progress report to the GitHub Actions job
     summary (visible right on the workflow run page).

## One-time setup

### 1. Create the repo and push this folder

```bash
cd "Automation - Create VIW BU - GHA"
git init
git add .
git commit -m "Recreate BU automation as a GitHub Action"
gh repo create <your-org>/<repo-name> --private --source=. --push
```

### 2. Add Secrets (Settings → Secrets and variables → Actions → **Secrets**)

Never paste these into a chat/AI tool — enter them directly in GitHub's UI.

| Secret | Description |
|---|---|
| `SFMC_SUBDOMAIN` | Your SFMC tenant subdomain (the "tssd", found in Setup → Apps → Installed Packages, e.g. `abc1def2ghij3klmno4pqr5stu` — this is org-specific, do not reuse another org's value) |
| `SFMC_CLIENT_ID` | Installed Package Client ID |
| `SFMC_CLIENT_SECRET` | Installed Package Client Secret |

The Installed Package needs SOAP + REST API access with permissions to
manage Business Units and Account Users (the same scopes the original
CloudPage's package/token already had).

### 3. Add Variables (Settings → Secrets and variables → Actions → **Variables**)

These are the org-level values that used to be hardcoded at the top of each
script — not secret, just config, so they're safe to keep as plain repo
Variables.

**⚠️ All example values below are placeholders only — fill in this org's own
values.** None of these should be copied from another org/tenant (parent MID,
addresses, and admin user keys are all org-specific and will silently create
BUs under the wrong parent account, or grant access to the wrong org's users,
if reused from a different org by mistake.

| Variable | Example (placeholder — replace with this org's value) | Notes |
|---|---|---|
| `SFMC_PARENT_MID` | `000000000` | This org's parent/enterprise MID, from Setup → Account → Account Details. Used only as the API auth/Client context on every call — **not** necessarily where new BUs get nested (see `NEST_UNDER_BU_MID` below). |
| `NEST_UNDER_BU_MID` | `111111111` | MID of the existing Business Unit that new BUs should be created *under* (their `ParentID`) — for this org, the MID of the `!VIW Parent` BU. Look it up once via Setup → Account → Business Units (or the Business Unit's own Account Details page) and hardcode it here, same as `SFMC_PARENT_MID`. MID is the durable identifier — it doesn't change if the BU is later renamed, so hardcoding it here is more reliable than looking it up by name on every run. |
| `BU_EMAIL` | `marketing@yourcompany.com` | Default sending email on the new BU |
| `BU_FROM_NAME` | `Your Company Name` | |
| `COMPANY_NAME` | `Your Company Name` | |
| `COMPANY_ADDRESS` | `123 Main St` | |
| `COMPANY_CITY` | `Your City` | |
| `COMPANY_STATE` | `XX` | |
| `COMPANY_ZIP` | `00000` | |
| `COMPANY_COUNTRY` | `US` | |
| `LOG_DE_KEY` | `Automation_Log_CreateBU` | ExternalKey of the log DE in *this* org (create one with columns `BU_Name`, `Status`, `LogDate` if it doesn't exist yet) |
| `DEFAULT_ADMIN_USER_KEYS` | `<this-orgs-user-customerkey-1>,<this-orgs-user-customerkey-2>` | AccountUser CustomerKeys from *this* org's Setup → Users, used when the form's `admin_user_keys` input is left blank |

### 4. (Optional but recommended) Require approval before running

The workflow references a GitHub **Environment** called `sfmc-production`.
Create it under Settings → Environments, and add required reviewers if you
want a human approval gate before the job actually calls SFMC — similar to
having someone double-check the CloudPage's DE row before running it. If you
don't want this gate, delete the `environment:` line from the workflow file.

## Running it

1. Go to the **Actions** tab → **Create Business Unit** → **Run workflow**.
2. Enter the new BU name.
3. Optionally override the admin user list (comma-separated CustomerKeys).
4. Click **Run workflow** and watch the job summary for step-by-step
   progress, same as the `Write()` output on the old CloudPage.

## Differences from the old CloudPage solution

- **No Data Extension trigger row required.** The old flow required writing
  a row to `Business_Unit_Details_DE` and then loading the CloudPage. Here,
  the BU name is a direct form input — no DE round-trip needed. (The log DE
  is still used, so existing reporting/dashboards against
  `Automation_Log_CreateBU` keep working unchanged.)
- **No "process all rows in the DE" batch loop.** The old scripts processed
  every row in the source DE each run. This automation processes exactly one
  BU per workflow run, which maps more naturally to "one request = one
  approval = one run" and avoids accidentally re-processing old rows.
- **SOAP is still used** for Business Unit create/update and Account User
  assignment, because SFMC's REST API does not expose those operations — this
  matches what the original `WSProxy`/raw `HTTP.Post` calls were doing under
  the hood.
- **Credentials never touch AI tooling.** Enter secrets directly into
  GitHub's Secrets UI; nothing sensitive is passed through chat or committed
  to the repo.

## Extending later

- Swap the manual form for an Issue template or Slack slash command if you
  want a lower-friction intake path (both can still call this same
  workflow via `repository_dispatch` or `gh workflow run`).
- If you later want an LLM to parse free-text requests into `bu_name` /
  `admin_user_keys`, add a step before `Run Business Unit automation` that
  calls the Claude API and feeds its structured output into `env:` — the
  core SFMC logic in `scripts/run.js` doesn't need to change.

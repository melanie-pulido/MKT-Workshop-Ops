# MKTVIW Setup — GitHub Actions

This repo has two independent workflows that together recreate the old
CloudPage/Data Extension automations as GitHub Actions:

1. **Create Business Unit** — see below.
2. **Create Users** — see [Create Users — GitHub Actions](#create-users--github-actions)
   further down.

---

# Create Business Unit — GitHub Actions

Recreates the old CloudPage automation (`1.1 Create Business Unit`, `1.2 Update
Business Unit Settings`, `1.3 Add Admin Users to BU`) as a single GitHub
Actions workflow. A team member enters a BU name via the **Run workflow**
form under the Actions tab — no CloudPage, no Data Extension trigger row,
no SSJS.

## How it works

1. `.github/workflows/create-business-unit.yml` defines a `workflow_dispatch`
   trigger with a single input: `bu_name` (required). Admin users are always
   the backend-configured list in the repo Variable `DEFAULT_ADMIN_USER_KEYS`
   — there's no per-run override field on the form.
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
| `DEFAULT_ADMIN_USER_KEYS` | `<this-orgs-user-customerkey-1>,<this-orgs-user-customerkey-2>` | AccountUser CustomerKeys from *this* org's Setup → Users. Every new BU gets exactly this admin list — there is no per-run override, so keep this current as the org's admin roster changes. |

### 4. (Optional but recommended) Require approval before running

The workflow references a GitHub **Environment** called `sfmc-production`.
Create it under Settings → Environments, and add required reviewers if you
want a human approval gate before the job actually calls SFMC — similar to
having someone double-check the CloudPage's DE row before running it. If you
don't want this gate, delete the `environment:` line from the workflow file.

## Running it

1. Go to the **Actions** tab → **Create Business Unit** → **Run workflow**.
2. Enter the new BU name.
3. Click **Run workflow** and watch the job summary for step-by-step
   progress, same as the `Write()` output on the old CloudPage. Admin access
   is granted automatically to the users in `DEFAULT_ADMIN_USER_KEYS`.

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
- If you later want an LLM to parse free-text requests into `bu_name`, add a
  step before `Run Business Unit automation` that calls the Claude API and
  feeds its structured output into `env:` — the core SFMC logic in
  `scripts/run.js` doesn't need to change.

---

# Create Users — GitHub Actions

Recreates the old CloudPage automation (`2.1 Create Student Users`, `2.2
Update Student Users`) as a single GitHub Actions workflow. A team member
provides the target Business Unit name and a list of usernames via the **Run
workflow** form — no CloudPage, no Data Extension trigger row, no SSJS.

## How it works

1. `.github/workflows/create-users.yml` defines a `workflow_dispatch`
   trigger with two inputs: `target_bu_name` (the Business Unit's name — not
   the MID) and `user_list` (a multi-line textarea — see format below).
2. The job runs `scripts/create-users.js`, which:
   - Authenticates to SFMC via REST OAuth (`client_credentials`).
   - Retrieves all Business Units and resolves `target_bu_name` to its MID
     (the same `retrieveBusinessUnitMap()` lookup the Create Business Unit
     workflow uses to resolve a newly created BU's MID by name). Fails
     fast with a clear error if no BU matches the given name, before
     touching any users.
   - Parses `user_list` into individual users.
   - For each user, calls SOAP `Create` on `AccountUser` (mirrors `2.1`),
     using the hardcoded default password, role, and email, and assigning
     the user to the resolved MID.
   - **Then** calls a separate SOAP `Update` on that same `AccountUser`
     setting `MustChangePassword` to `false` (mirrors `2.2`). This has to
     be a second, separate call — SFMC's `Create` does not reliably honor
     `MustChangePassword: false` at creation time, which is exactly why the
     original CloudPage automation was split into two scripts/two
     automation steps in the first place.
   - Logs each step to the `Automation_Log_CreateVIWStudent` Data
     Extension (same DE the old scripts logged to), via the SOAP
     `DataExtensionObject` write path.
   - Writes a human-readable progress table to the GitHub Actions job
     summary.

Everything **except** the target BU name and the usernames/names is
hardcoded as repo Secrets/Variables — password, role, and email are fixed
per org, matching the request that the team only ever has to supply "which
BU" and "which usernames."

## One-time setup

### 1. Add Secrets (Settings → Secrets and variables → Actions → **Secrets**)

Never paste these into a chat/AI tool — enter them directly in GitHub's UI.

| Secret | Description |
|---|---|
| `SFMC_SUBDOMAIN` | Same tenant subdomain used by the Create Business Unit workflow (shared secret, not duplicated per workflow). |
| `SFMC_CLIENT_ID` | Installed Package Client ID (shared with Create Business Unit; needs SOAP AccountUser create/update permissions). |
| `SFMC_CLIENT_SECRET` | Installed Package Client Secret. |
| `DEFAULT_USER_PASSWORD` | The fixed password every new user is created with. Stored as a Secret (not a plain Variable) precisely so it's never shown in the workflow form, never printed to logs, and never committed to the repo — while still being "hardcoded" in the sense that the team never types or sees it per run. |

### 2. Add Variables (Settings → Secrets and variables → Actions → **Variables**)

**⚠️ All example values below are placeholders only — fill in this org's own
values.**

| Variable | Example (placeholder) | Notes |
|---|---|---|
| `SFMC_PARENT_MID` | `000000000` | Same enterprise parent MID used for API auth context as the Create Business Unit workflow. |
| `DEFAULT_USER_ROLE_ID` | `d2be5e3f-4a43-f011-a5d5-5cba2c6ff268` | One or more Role ObjectIDs every new user is assigned, comma-separated (e.g. `Administrator,Marketing Cloud VIW` → their ObjectIDs). Look up Role ObjectIDs via a SOAP `Retrieve` on `ObjectType Role` if you don't already have them — role GUIDs are org-specific. |
| `DEFAULT_USER_EMAIL` | `viw-students@yourcompany.com` | The single fixed email/notification address used for every created user (per this org's stated setup, all users share one email). |
| `LOG_DE_KEY_CREATE_USERS` | `Automation_Log_CreateVIWStudent` | ExternalKey of the log DE in *this* org (create one with columns `Username`, `Status`, `Message`, `LogDate` if it doesn't exist yet). Kept as a separate Variable name from the BU workflow's `LOG_DE_KEY` so the two workflows can log to different DEs without colliding. |

### 3. (Optional but recommended) Require approval before running

Same `sfmc-production` GitHub Environment as the Create Business Unit
workflow — add required reviewers under Settings → Environments if you
want a human approval gate before the job calls SFMC. Delete the
`environment:` line from `create-users.yml` if you don't want this gate.

## Running it

1. Go to the **Actions** tab → **Create Users** → **Run workflow**.
2. Enter the target **Business Unit name** exactly as it appears in
   Setup → Account → Business Units (the script resolves it to a MID —
   a typo/mismatch fails the whole run before any users are touched).
3. Paste the user list into the textarea — **one user per line**, as
   `username,Full Name` (comma or tab separated, so you can paste two
   columns straight out of a spreadsheet without reformatting). For
   example:

   ```
   jsmith@school.edu	Jane Smith
   bwong@school.edu	Bob Wong
   ```

4. Click **Run workflow** and watch the job summary for a per-user
   status table (Create result + password-never-expire Update result).

## Differences from the old CloudPage solution

- **No Data Extension trigger row required.** The old flow required
  loading `Student_Details_DE` and running an automation against it. Here,
  the BU name and user list are direct form inputs, with the MID resolved
  automatically at run time (same as the Create Business Unit workflow).
- **The required two-call sequence (Create, then Update
  `MustChangePassword`) is preserved exactly**, including the reason for
  it — it's implemented as two SOAP calls per user inside one script run,
  rather than two separate automations/scripts, but the underlying API
  behavior it works around is unchanged.
- **Credentials never touch AI tooling.** Enter secrets directly into
  GitHub's Secrets UI; nothing sensitive is passed through chat or
  committed to the repo.

## Extending later

- If a future request needs a genuinely different email/name per user
  instead of the one shared email, add a third column to the `user_list`
  format (e.g. `username,Full Name,email`) and thread it through
  `parseUserList()` and `createUser()` in `scripts/create-users.js` —
  no other structural change needed.

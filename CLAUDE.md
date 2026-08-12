# MKT-Workshop-Ops

GitHub Actions automation for Salesforce Marketing Cloud (SFMC) — replicates
CloudPage SSJS scripts as issue-triggered workflows so team members without
SFMC access can submit requests through a Google Form or GitHub Issues.

**Repo:** `melanie-pulido/MKT-Workshop-Ops`
**Local working copy:** `/tmp/mktviw` (re-clone here if it disappears)

---

## Environments (SFMC orgs)

| Label in forms/issues | Parent MID |
|---|---|
| MC Events 2 (MID 517022562) | 517022562 |
| MC Events 3 (MID 517035532) | 517035532 |

Every workflow routes to the right org's credentials at runtime using a
`case "$ORG"` shell step that writes generic `SFMC_*` env vars into
`GITHUB_ENV`. The scripts themselves only read `SFMC_SUBDOMAIN`,
`SFMC_CLIENT_ID`, `SFMC_CLIENT_SECRET`, `SFMC_PARENT_MID`.

---

## Workflows

All four workflows fire on `issues: labeled` (never `opened`) to avoid
double-trigger races. Each workflow:
1. Renames the issue with a PST timestamp
2. Posts a "⏳ in progress" comment
3. Parses the issue body → writes env vars to `GITHUB_ENV`
4. Routes org credentials
5. Runs the Node script
6. Posts results as a comment on the issue
7. Closes the issue on success, fails the job on error

| Workflow file | Label | Script |
|---|---|---|
| `create-instructor-user-issue.yml` | `create-instructor-user` | `scripts/create-instructor-user.js` |
| `create-users-issue.yml` | `create-users` | `scripts/create-users.js` |
| `create-business-unit-issue.yml` | `create-business-unit` | `scripts/run.js` |
| `add-instructor-to-class-issue.yml` | `add-instructor-to-class` | `scripts/add-instructor-to-class.js` |

---

## Issue form templates

`.github/ISSUE_TEMPLATE/` — each template has an **Environment** dropdown
as its first field (MC Events 2 / MC Events 3). The first field's label
must read exactly `Environment` or the parse scripts will fail to extract it.

---

## Key scripts

| File | Purpose |
|---|---|
| `scripts/sfmc-client.js` | SOAP + REST client — all SFMC API calls go through here |
| `scripts/parse-instructor-issue-body.js` | Extracts ORG, INSTRUCTOR_NAME, INSTRUCTOR_USERNAME, INSTRUCTOR_EMAIL |
| `scripts/parse-issue-body.js` | Extracts ORG, TARGET_BU_NAME, USER_LIST |
| `scripts/parse-bu-issue-body.js` | Extracts ORG, BU_NAME |
| `scripts/parse-add-instructor-issue-body.js` | Extracts ORG, INSTRUCTOR_USERNAME, CLASS_BU_NAME |
| `scripts/create-instructor-user.js` | Two-call SOAP sequence: Create then Update MustChangePassword=false |
| `scripts/create-users.js` | Batch creates student users from a name/username table |
| `scripts/run.js` | Creates BU, sets unsubscribe behavior, optionally assigns admin users |
| `scripts/add-instructor-to-class.js` | Resolves BU name → MID, calls assignUserToBusinessUnit |

### Notable SFMC SOAP behaviors
- **Create user** requires a two-call sequence: Create then Update `MustChangePassword=false`.
  SFMC's Create call does not reliably honor MustChangePassword on its own.
- **assignUserToBusinessUnit** UpdateRequest must include BOTH `<CustomerKey>` AND `<UserID>`
  (same value: the username). Without `<UserID>`, SFMC treats it as a Create and demands
  Name/Email/Password.
- **DEFAULT_ADMIN_USER_KEYS** is optional — `run.js` handles empty string gracefully.

---

## Google Form bridge

`.github/google-form-script.js` — paste the full contents into the Google
Form's Apps Script editor (Form → ⋮ → Script editor).

The script maps form dropdown answers to GitHub issue labels and formats the
issue body exactly as the parse scripts expect. The form collects respondent
email automatically (Google login) and sends a confirmation email with the
issue URL after creating the issue.

**GitHub PAT** is stored as a Script Property named `GITHUB_TOKEN` — never
hardcoded. See `.github/google-form-setup.md` for full setup steps.

---

## Secrets & Variables

Credentials **never** touch AI tooling — entered directly in GitHub's Secrets
UI (`Settings → Secrets and variables → Actions`). See `.env.example` for the
full list of what's needed.

- **Secrets tab:** `MC_EVENTS_3_SUBDOMAIN`, `MC_EVENTS_3_CLIENT_ID`,
  `MC_EVENTS_3_CLIENT_SECRET`, `MC_EVENTS_2_SUBDOMAIN`, `MC_EVENTS_2_CLIENT_ID`,
  `MC_EVENTS_2_CLIENT_SECRET`, `DEFAULT_USER_PASSWORD`
- **Variables tab:** all `MC_EVENTS_2_*` and `MC_EVENTS_3_*` non-secret config
  (MIDs, email addresses, role IDs, BU names, etc.)

Local `.env` file at `/tmp/mktviw/.env` — already in `.gitignore`, never committed.

---

## Git / CLI setup

```bash
# Switch to the right GitHub account before pushing
gh auth switch --user melanie-pulido

# Push with explicit token (avoids EMU account confusion)
TOKEN=$(gh auth token --hostname github.com --user melanie-pulido)
git push "https://melanie-pulido:${TOKEN}@github.com/melanie-pulido/MKT-Workshop-Ops.git" main
```

If `/tmp/mktviw` is gone, re-clone:
```bash
git clone https://github.com/melanie-pulido/MKT-Workshop-Ops /tmp/mktviw
```
Then restore your `.env` manually from your secure copy.

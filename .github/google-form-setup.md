# Google Form → GitHub Issues Setup

This form gives your team a simple link to submit requests without needing
a GitHub account. On submit it creates a GitHub issue in the correct format,
which the existing workflows pick up automatically.

---

## Step 1 — Create the Google Form

Go to [forms.google.com](https://forms.google.com) and create a new form.

**Form title:** MKT Workshop Operations

### Required form settings (do these first)

Click **Settings (⚙️)** at the top and configure:

| Tab | Setting | Value |
|---|---|---|
| Responses | Collect email addresses | **Responder input** → change to **Verified** |
| Responses | Restrict to users in Salesforce and trusted organizations | ✅ Checked |
| Presentation | Confirmation message | See below |

**Confirmation message** (paste this exactly):
```
Your request has been submitted and is being processed.

View the status here:
https://github.com/melanie-pulido/MKT-Workshop-Ops/issues

Your request will appear at the top of the list within seconds.
You will also receive a confirmation email with a direct link.
```

> **"Collect email addresses: Verified"** is what auto-fills their email from their
> Google login — no typing needed. It also lets the script send them the confirmation
> email with a direct link to their specific issue.

---

### Question 1 — Action selector (required)
- Type: **Multiple choice**
- Title: `What would you like to do?`
- Options:
  - `Create Instructor User`
  - `Create Users (student batch)`
  - `Create Business Unit`
- Turn on **"Go to section based on answer"** (click the three dots at bottom of question)
  - Create Instructor User → Section 2
  - Create Users (student batch) → Section 3
  - Create Business Unit → Section 4

---

### Section 2 — Create Instructor User

**Section title:** Create Instructor User

Add these questions (all **Short answer**, all **Required**):

| Question title | Notes |
|---|---|
| `Full Name` | Short answer |
| `Username` | Short answer |
| `Email Address` | Short answer |

Add a **Text** block (not a question): `Password: journey@1 (pre-configured)`

At the bottom: **"After section 2" → Submit form**

---

### Section 3 — Create Users (student batch)

**Section title:** Create Users

Add these questions:

| Question title | Notes |
|---|---|
| `Business Unit Name` | Short answer, required. Must match exactly as it appears in Setup → Account → Business Units. |
| `User List` | **Paragraph** (long answer), required. One user per line: Full Name, username — comma or tab separated. |

At the bottom: **"After section 3" → Submit form**

---

### Section 4 — Create Business Unit

**Section title:** Create Business Unit

Add this question:

| Question title | Notes |
|---|---|
| `Business Unit Name` | Short answer, required. This also becomes the BU's External Key in SFMC. |

At the bottom: **"After section 4" → Submit form**

---

## Step 2 — Add the Apps Script

1. In the form, click **⋮ (three dots)** → **Script editor**
2. Delete any existing code
3. Paste the entire contents of `.github/google-form-script.js`
4. Click **Save** (💾)

---

## Step 3 — Store your GitHub token

You need a PAT from `melanie-pulido` on github.com with **repo** scope.

1. In the Apps Script editor: **Project Settings** (⚙️ left sidebar) → **Script Properties**
2. Click **Add property**
   - Name: `GITHUB_TOKEN`
   - Value: your PAT
3. Click **Save script properties**

The token never appears in the form or the script code — only in Script Properties.

---

## Step 4 — Test the connection

1. In the Apps Script editor, select `testConnection` from the function dropdown
2. Click **Run**
3. Click **Execution log** — you should see `Status: 200` and repo details

If you see 401/403, the token is wrong or not SSO-authorized for the repo.

---

## Step 5 — Set up the submit trigger

1. In the Apps Script editor: **Triggers** (⏰ left sidebar) → **+ Add Trigger**
2. Settings:
   - Function: `onFormSubmit`
   - Event source: `From form`
   - Event type: `On form submit`
3. Click **Save** — it will ask you to authorize the script, click through
   - When prompted for permissions, approve **both** "Connect to an external service"
     (for GitHub API) and "Send email as you" (for confirmation emails)

---

## Step 6 — Test end-to-end

1. Open the form (Preview 👁️) and submit a test entry
2. The confirmation page should appear with the link to the issues list
3. Check `https://github.com/melanie-pulido/MKT-Workshop-Ops/issues` — a new issue should appear within seconds with the right label
4. Check your email — you should receive a confirmation with a direct link to your issue
5. The workflow will fire and post results as a comment on that issue

---

## Sharing the form

Once tested, click **Send** in the form and copy the link.
Share it with your team — that's all they need. No GitHub account required.

Submitters must be logged into a `@salesforce.com` Google account to submit.
Their email is captured automatically — no need to type it.

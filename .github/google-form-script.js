/**
 * MKT-Workshop-Ops — Google Form → GitHub Issues bridge
 *
 * Paste this entire script into the Google Form's Apps Script editor
 * (Form → ⋮ → Script editor), then follow the setup steps in
 * .github/google-form-setup.md.
 *
 * On every form submission this script creates a GitHub issue in the
 * correct format for the existing issue-triggered workflows to pick up.
 * The workflows run exactly as they do when someone submits via GitHub
 * Issues directly — no changes needed to any workflow or script files.
 *
 * SETUP: Store your GitHub PAT as a Script Property (never hardcode it):
 *   Apps Script → Project Settings → Script Properties → Add property
 *   Name: GITHUB_TOKEN   Value: <your PAT with repo scope>
 */

var REPO = "melanie-pulido/MKT-Workshop-Ops";

// ---------------------------------------------------------------------------
// Main entry point — wired to the form's onFormSubmit trigger
// ---------------------------------------------------------------------------
function onFormSubmit(e) {
  var responses = e.response.getItemResponses();
  var data = {};
  responses.forEach(function(r) {
    data[r.getItem().getTitle()] = r.getResponse();
  });

  var action = data["What would you like to do?"];
  var title, body, label;

  if (action === "Create Instructor User") {
    title = "Create New Instructor User";
    body  = formatInstructorBody(data);
    label = "create-instructor-user";

  } else if (action === "Create Users (student batch)") {
    title = "Create New Marketing Cloud Users";
    body  = formatUsersBody(data);
    label = "create-users";

  } else if (action === "Create Business Unit") {
    title = "Create New Business Unit";
    body  = formatBUBody(data);
    label = "create-business-unit";

  } else {
    Logger.log("Unknown action: " + action);
    return;
  }

  var submitterEmail = e.response.getRespondentEmail();
  var issueUrl = createGitHubIssue(title, body, label);

  if (issueUrl && submitterEmail) {
    MailApp.sendEmail({
      to:      submitterEmail,
      subject: "✅ Request received: " + title,
      body:    "Your request has been received and is being processed.\n\n" +
               "You can track the status and see the results here:\n" +
               issueUrl + "\n\n" +
               "Results will appear as a comment on that page within a minute or two.\n\n" +
               "— MKT Workshop Ops"
    });
    Logger.log("Confirmation email sent to: " + submitterEmail);
  }
}

// ---------------------------------------------------------------------------
// Body formatters — must match exactly what the parse scripts expect
// ---------------------------------------------------------------------------

function formatInstructorBody(data) {
  return "### Environment\n\n"  + data["Environment"]  + "\n\n" +
         "### Full Name\n\n"     + data["Full Name"]     + "\n\n" +
         "### Username\n\n"      + data["Username"]      + "\n\n" +
         "### Email Address\n\n" + data["Email Address"];
}

function formatUsersBody(data) {
  return "### Environment\n\n"        + data["Environment"]        + "\n\n" +
         "### Business Unit Name\n\n" + data["Business Unit Name"] + "\n\n" +
         "### User List\n\n"          + data["User List"];
}

function formatBUBody(data) {
  return "### Environment\n\n"        + data["Environment"]        + "\n\n" +
         "### Business Unit Name\n\n" + data["Business Unit Name"];
}

// ---------------------------------------------------------------------------
// GitHub API — create an issue with the right label
// ---------------------------------------------------------------------------

function createGitHubIssue(title, body, label) {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) {
    Logger.log("ERROR: GITHUB_TOKEN script property not set.");
    return;
  }

  var url = "https://api.github.com/repos/" + REPO + "/issues";

  var payload = JSON.stringify({
    title:  title,
    body:   body,
    labels: [label]
  });

  var options = {
    method:      "post",
    contentType: "application/json",
    headers: {
      "Authorization":        "Bearer " + token,
      "Accept":               "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    payload:          payload,
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code     = response.getResponseCode();
  var result   = JSON.parse(response.getContentText());

  if (code === 201) {
    Logger.log("Issue created: " + result.html_url);
    return result.html_url;
  } else {
    Logger.log("ERROR " + code + ": " + response.getContentText());
    return null;
  }
}

// ---------------------------------------------------------------------------
// One-time setup helper — run this manually once to verify your token works
// ---------------------------------------------------------------------------
function testConnection() {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  var url   = "https://api.github.com/repos/" + REPO;
  var options = {
    headers: {
      "Authorization":        "Bearer " + token,
      "Accept":               "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(url, options);
  Logger.log("Status: " + response.getResponseCode());
  Logger.log(response.getContentText().substring(0, 200));
}

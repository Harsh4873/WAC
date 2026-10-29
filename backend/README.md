# WAC assignment analysis service

This is a dependency-free Node.js 20+ development service. It accepts assignment text or a PDF plus
a learning profile and returns a validated task draft. WAC users never enter a model API key. The
Google Calendar OAuth configuration is separate and remains unchanged.

## Run without model credentials

From the extension folder:

```sh
npm run analysis
```

The service listens only on `127.0.0.1:8787`. Without model credentials, `GET /health` reports
`not_configured` and analysis requests return `503 AI_NOT_CONFIGURED`. No model calls are made.
Uploads and manual estimates in WAC still work.

## Exercise the interface without token charges

```sh
npm run analysis:demo
```

This explicitly enables a fixed demonstration response. Both the API and WAC label the result **Demo
draft — no AI call made**. PDF bytes are validated but not interpreted in demo mode. It is a
workflow fixture, not an effort prediction. Stop this process before running another instance on the
same port.

## Enable real Gemini analysis later

The developer supplies these environment variables on the machine running the service:

| Variable                    | Purpose                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GEMINI_API_KEY`            | The team's Gemini API credential                                                                       |
| `GEMINI_MODEL`              | A currently available Gemini model ID supporting PDF input and structured output                       |
| `WAC_ANALYSIS_MODE`         | `gemini` for real requests; `demo` for the explicit fixture                                            |
| `WAC_ANALYSIS_HOURLY_LIMIT` | Maximum uncached analysis attempts per local client per hour; default `30`                             |
| `WAC_ANALYSIS_PORT`         | Local service port; default `8787`                                                                     |
| `WAC_EXTENSION_IDS`         | Additional allowed Chrome extension IDs, separated by commas; use the store ID for store installations |

Keep the credential outside the extension directory, for example in a private environment file
elsewhere on your machine. Node.js 20 can read it directly:

```sh
node --env-file=/absolute/path/outside-the-extension/wac-analysis.env backend/server.mjs
```

For local team development, `.env.example` is a credential-free template. Copy it to the ignored
`.env` file and run `npm run analysis:env`. It starts in demo mode until explicitly changed. The
extension ID from the source manifest is allowed automatically; `WAC_EXTENSION_IDS` adds specific
store or development IDs without allowing every extension. When loading a manifest without a public
development key, provide the installed extension ID explicitly in this variable.

Example environment-file structure (replace the placeholders in your private file):

```text
WAC_ANALYSIS_MODE=gemini
GEMINI_API_KEY=YOUR_TEAM_KEY
GEMINI_MODEL=YOUR_SUPPORTED_MODEL_ID
WAC_ANALYSIS_HOURLY_LIMIT=30
```

No model or credentials are selected automatically. Check current model availability and pricing
before enabling real calls. The adapter uses Gemini's `generateContent` endpoint, PDF inline data,
and JSON Schema output. Real-provider behavior has not been verified with live credentials;
automated tests use mock responses.

## Extension connection

The extension already points to:

```text
http://127.0.0.1:8787/v1/analyze
```

Reload WAC after updating extension files. The local preview at port `8765` uses the same service.
If a developer later supplies a different service URL, configure it with:

```sh
node scripts/configure-analysis.mjs https://YOUR_SERVICE_HOST/v1/analyze
```

This updates the public service URL, the extension's host permission, and its connection policy. It
never writes model credentials into the extension. For a different local port, use a loopback URL
with that port and start the service with the matching `WAC_ANALYSIS_PORT`.

The included server binds to loopback only. It is a local prototype, not a public deployment. Before
a shared internet deployment, the team needs authenticated user sessions and user-level quotas at
its hosting layer. Origin checks alone do not authenticate a user. No public deployment is performed
by these scripts.

## API contract

### `GET /health`

Returns a status of `not_configured`, `demo`, or `ready`. `ready` means environment variables are
present; it does not validate access to a live model.

### `POST /v1/analyze`

Content type: `application/json`.

```json
{
  "schemaVersion": 1,
  "text": "Compare two historical sources and write a 1,000-word essay.",
  "attachment": null,
  "profile": {
    "fieldOfStudy": "History",
    "stage": "undergraduate",
    "familiarTopics": "Close reading",
    "developingTopics": "Archival research",
    "readingPace": "typical",
    "writingConfidence": "some",
    "preferredBlockMinutes": 25
  },
  "task": {
    "title": "History essay",
    "course": "History 101",
    "type": "writing",
    "familiarity": "some"
  },
  "timeZone": "America/Chicago"
}
```

For a PDF, `attachment` contains `name`, `mimeType: "application/pdf"`, `size` in bytes, and `data`
as base64. Plain-text and Markdown files are read into `text` by the extension. Limits are 60,000
text characters, 6 MB per PDF, and 9 MB for the complete JSON request.

A successful response includes:

```json
{
  "schemaVersion": 1,
  "provider": "gemini",
  "model": "YOUR_CONFIGURED_MODEL",
  "generatedAt": "2026-10-28T18:00:00.000Z",
  "requestId": "generated-request-id",
  "cached": false,
  "analysis": {
    "title": "History essay",
    "type": "writing",
    "complexity": "medium",
    "deadline": null,
    "summary": "Compare two sources and develop an argument.",
    "estimate": { "minutes": 120, "lowMinutes": 90, "highMinutes": 180 },
    "steps": [
      { "title": "Review sources", "minutes": 30 },
      { "title": "Write the argument", "minutes": 60 },
      { "title": "Review and revise", "minutes": 30 }
    ],
    "reasons": ["The assignment requires comparison and a supported argument."],
    "assumptions": ["The sources are already available."],
    "questions": ["What is the deadline?"],
    "suggestedBlockMinutes": 25
  }
}
```

The numbers above illustrate the response format. They are not measured predictions. The service
validates types, time ranges, and whether step times sum to the total. Unknown deadlines remain
`null`; WAC asks the user to choose one before saving. Complexity is stored separately from the
time-based effort label.

Error responses use `{ "error": { "code": "...", "message": "..." } }`. Common statuses are `400`
for invalid input, `403` for a disallowed browser origin, `413` for oversized input, `429` for usage
limits, `502` for invalid provider results, and `503` for missing model configuration.

## Data and cost behavior

- The service does not write uploaded documents or profiles to disk and does not log request bodies
  or credentials.
- Only explicitly submitted assignment text, an attached PDF, and the learning profile are sent to
  Gemini. Google Calendar tokens, event lists, and other assignments are not sent.
- The browser stores the task's instructions, analysis draft, and file metadata. It does not retain
  the original PDF bytes. Text imported from TXT/Markdown remains in the instructions.
- Responses are cached in memory for ten minutes, with a maximum of thirty entries. Identical
  concurrent requests share one model call. Cache keys include the profile, source, model, and
  user's local date.
- The service limits concurrent distinct analyses to two. Uncached attempts count toward the hourly
  limit, including attempts rejected by the provider. Invalid input and missing configuration do not
  invoke a model.
- There are no automatic retries for paid generation calls. Closing the task dialog cancels the
  browser request; upstream work already performed may still count toward provider usage.
- The model has no Calendar tools. It only returns a draft. Users confirm task details and
  separately choose whether to publish work blocks.

Official references:
[Gemini document input](https://ai.google.dev/gemini-api/docs/document-processing),
[structured output](https://ai.google.dev/gemini-api/docs/structured-output),
[API keys](https://ai.google.dev/gemini-api/docs/api-key), and
[pricing](https://ai.google.dev/gemini-api/docs/pricing).

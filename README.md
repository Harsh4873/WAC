# WAC · Workload Aware Calendar

WAC is a university HCI course-project prototype that helps learners see the effort behind
assignments and plan manageable work blocks alongside their existing Google Calendar.

The installed extension uses a Chrome side panel and the native Google Calendar page. A separate,
sample-only web preview is available for development. Runtime code has no package dependencies and
requires no build step.

![WAC with sample tasks and custom work blocks](docs/assets/wac-overview.jpg)

## Try it locally

1. Clone this repository or download its source.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the repository root containing `manifest.json`.
4. Pin WAC, open Google Calendar, and click the WAC toolbar icon.
5. Set optional learning preferences, or use defaults. Load example assignments to try planning
   without connecting a Google account.

The upper-right arrow opens or reuses native Google Calendar. Plans remain local until a user
reviews and publishes them. Google connection is optional and may be restricted to approved OAuth
test users.

## What it does

- Estimate reading, writing, coding, problem-set, and project effort with editable time ranges and
  Low / Medium / High labels.
- Use an optional learning profile for any subject or occupation.
- Accept long instructions and PDF, TXT, or Markdown attachments. Original PDFs are not retained in
  task storage.
- Choose a focus-block length or custom blocks such as `25, 45, 50`, with breaks, daily limits,
  deadline checks, and explicit partial-plan reporting.
- Review local plans, check primary-calendar availability, and publish confirmed work blocks.
- Add effort labels and optional stripes to WAC-created events using Off, Tags, and Patterns
  controls. A collision banner marks a day whose deadlines exceed the daily work limit.
- Open an estimate popover on a deadline or work block and override Low, Medium, or High in one
  click. Drag an unpublished work block to another open time, or use Earlier on the plan list. Find
  time places that work on the open days before the deadline.
- Record points and a submission type with each assignment. Reminder count can follow the default
  setting or be chosen per assignment.

Optional AI analysis requires the included local service to be configured separately. This source
contains no model API key or hosted AI service. The explicit demo mode uses a fixed response with no
model call. Manual estimates and local planning work without AI.

## Develop and validate

Use Node.js 20 or newer; Node.js 22 is recommended and recorded in `.nvmrc`.

```sh
npm ci
npm run preview
```

Open [the local demo](http://127.0.0.1:8765/sidepanel.html). In another terminal:

```sh
npm run verify
npm run analysis:demo
```

`npm run verify` checks formatting, the manifest and assets, JavaScript syntax, and Node tests. CI
also builds and verifies the upload ZIP on Node.js 22 and 24. See the development guide for isolated
browser checks and real Google/Gemini configuration.

## Build a store upload

```sh
npm run package:webstore
```

The complete ZIP is written to `dist/wac-webstore-<version>.zip`. It contains runtime files and
removes the development manifest key. It excludes backend code, credentials, tests, dependencies,
and generated screenshots. Building or pushing this repository does not publish a store update.

## Project guide

| Guide                                 | Purpose                                                              |
| ------------------------------------- | -------------------------------------------------------------------- |
| [Development](docs/DEVELOPMENT.md)    | Clone, load, run, configure, test, and troubleshoot                  |
| [Architecture](docs/ARCHITECTURE.md)  | Module responsibilities, data flow, and storage boundaries           |
| [Contributing](CONTRIBUTING.md)       | Team branches, reviews, formatting, and change validation            |
| [Analysis service](backend/README.md) | Local setup, Gemini adapter, API contract, limits, and cost behavior |
| [Releasing](docs/RELEASING.md)        | Versions, upload contents, development/store IDs, and OAuth          |
| [Privacy](docs/PRIVACY.md)            | Data use, retention, optional analysis, and user controls            |
| [Limitations](docs/LIMITATIONS.md)    | What the current course prototype supports                           |
| [Changelog](CHANGELOG.md)             | Version history                                                      |

Source folders: `src/` for the extension, `backend/` for optional analysis, `tests/` for automated
Node checks, and `scripts/` for development and packaging tools. All project content is in English.

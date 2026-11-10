# Development setup

## Requirements

- Chrome 116 or newer for the installed extension.
- Node.js 20 or newer for scripts and the local service; Node.js 22 is the recommended development
  version and is recorded in `.nvmrc`.
- Git and access to this repository.

## Clone and load

```sh
git clone git@github.com:xianshunJ/WAC.git
cd WAC
npm ci
```

In Chrome, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose
the repository root containing `manifest.json`. Pin WAC, open Google Calendar, and click its toolbar
icon. Reload the extension after changing source files; refresh existing Calendar tabs after
changing the content script.

There is no frontend build step. `npm ci` installs development tools, not extension runtime
packages.

## Preview and analysis

```sh
npm run preview
```

Open [the local demo](http://127.0.0.1:8765/sidepanel.html). The Node preview server binds only to
loopback, serves runtime assets, and blocks environment files, server code, and Git metadata. The
preview uses sample data and its own local storage.

The course examples are due on December 7, 10, 10, and 14, 2026 at 11:00 p.m. local time. December
10 carries two deadlines whose combined estimate exceeds the daily limit, so the preview shows a
collision banner on that day. If the current week has no deadlines, the preview opens on the week of
the next example deadline. Opening WAC after this update refreshes untouched, unpublished older
examples once and clears their stale local work blocks. Edited, completed, manual, and published
tasks are preserved. Use **Load examples** to explicitly replace unpublished examples with a fresh
set.

In a separate terminal, use the fixed analysis fixture without model charges:

```sh
npm run analysis:demo
```

For explicit environment configuration, copy `.env.example` to `.env` and run:

```sh
npm run analysis:env
```

The example uses demo mode. Real Gemini calls require both a private API key and an explicitly
chosen model. See [the service guide](../backend/README.md). Never put model keys in extension
files.

## Common commands

| Command                    | Result                                                       |
| -------------------------- | ------------------------------------------------------------ |
| `npm run format`           | Format source, tests, configuration, and docs                |
| `npm run verify`           | Formatting, source/manifest checks, and automated Node tests |
| `npm test`                 | Domain, controller, integration, server, and packaging tests |
| `npm run preview`          | Sample web preview on `127.0.0.1:8765`                       |
| `npm run analysis`         | Local analysis service using the current process environment |
| `npm run analysis:demo`    | Force the fixed demo response; no model calls                |
| `npm run analysis:env`     | Load the ignored `.env` file and start the local service     |
| `npm run package:webstore` | Complete runtime ZIP in `dist/`                              |

## Browser regression checks

Install Playwright's test browser once:

```sh
npx playwright install chromium
```

Start `npm run preview` in another terminal, then run:

```sh
npm run test:browser
npm run test:features
```

The scripts use temporary isolated profiles and the bundled Chromium channel. They do not reuse your
personal browser profile. Tests use sample tasks and mocked analysis/Google responses; they do not
publish calendar events or invoke a paid model. Screenshots are written to ignored `artifacts/`.
These browser checks are additional to the Node checks run by CI.

Optional overrides:

- `WAC_CHROME_PATH`: compatible browser executable for a local test environment.
- `WAC_PLAYWRIGHT_PATH`: existing Playwright module path, if using an external tool installation.
- `WAC_PREVIEW_URL`: preview URL used by the workspace smoke script.
- `WAC_ARTIFACTS_DIR`: output directory for generated browser screenshots.

The extension smoke test uses Chrome's extension debugging protocol. A recent compatible Chromium
build is required; use the pinned Playwright installation when a system browser is incompatible.

## Google Calendar development configuration

The tracked manifest includes the project's public development key and OAuth client ID. The key
keeps the unpacked extension ID stable:

```text
opiabkfomcghikkaicmfmhhbfgfonjhi
```

These are public identifiers, not credentials. A teammate must still be approved as an OAuth test
user while the Google application is in testing. School-managed accounts may also need administrator
approval.

To use your own Google Cloud project, enable Google Calendar API, configure the consent
audience/test users, and create an OAuth client of type **Chrome Extension** with the unpacked
extension ID:

```sh
npm run configure -- --id
npm run configure -- YOUR_CLIENT_ID.apps.googleusercontent.com
```

Reload the extension, refresh existing Calendar tabs, and use Connect Google Calendar. To return to
demo-only mode, run `npm run configure -- --clear`. Coordinate tracked configuration changes with
the team before committing them. No OAuth client secret belongs in this repository.

OAuth scopes are `calendar.events` and `calendar.events.freebusy`. The implementation creates only
user-confirmed work blocks in the primary calendar; it does not update or delete existing events.
The broader event scope is still a Google authorization permission and must be disclosed accurately.

The Chrome Web Store item has a different ID. Match its Google Cloud OAuth client to the store ID
before testing a store installation. See [the release guide](RELEASING.md).

## Troubleshooting

| Symptom                                     | Check                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Google reports a bad client ID              | Client type must be Chrome Extension; its Application ID must match the installed extension ID               |
| Google reports access denied during testing | Add the account as an approved OAuth test user; check school administrator restrictions                      |
| Analysis is unavailable                     | Start the local service; confirm the endpoint and selected mode; manual estimates remain available           |
| Store build cannot reach local analysis     | Add the store ID to `WAC_EXTENSION_IDS` in the service environment                                           |
| Changes are not visible                     | Reload at `chrome://extensions` and refresh existing Calendar tabs                                           |
| A local server cannot start                 | Another process may already use the port; stop the instance you started or choose a documented port override |

Keep bug reports and screenshots limited to sample tasks. Do not include tokens, original assignment
documents, or real calendar contents.

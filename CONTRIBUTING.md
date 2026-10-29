# Contributing to WAC

Start with [development setup](docs/DEVELOPMENT.md) and the
[architecture map](docs/ARCHITECTURE.md). All code, documentation, UI text, and commit messages in
this repository use English.

## Work on one change at a time

1. Pull the current `main` branch.
2. Create a branch describing your change, such as `feature/task-import` or `fix/block-duration`.
3. Keep changes focused on the problem you are solving.
4. Run `npm run format`, then `npm run verify`.
5. Run the relevant browser checks when changing UI or extension behavior.
6. Push your branch and open a pull request into `main`.

Explain the problem, resulting behavior, and validation in the pull request. Include a screenshot
with sample data for a visible UI change. Have a teammate review it before merging when possible.

## Code boundaries

- Keep estimation, date handling, and scheduling rules in `src/core.mjs`.
- Put state-changing operations in `src/controller.mjs`; do not bypass its serialized writes.
- Keep Chrome/Google integration behind `src/google.mjs` and the background message boundary.
- Treat uploaded instructions, model output, and calendar titles as untrusted text.
- Keep model credentials on the local service side. The extension must never contain a model API key
  or an OAuth client secret.
- Prefer small changes to the current modules. A new framework or dependency should solve a concrete
  problem rather than replace working code for its own sake.

## Testing and formatting

`npm run verify` checks formatting, manifest/assets, JavaScript syntax, and the Node tests. CI runs
the same checks on Node.js 22 and 24, builds the store ZIP, and checks ZIP integrity. Browser smoke
tests are separate; see [development setup](docs/DEVELOPMENT.md).

Add regression tests for changed scheduling, storage, validation, integration, or packaging
behavior. Use mocked Google/model responses and temporary profiles. Do not write real calendar
events or call a paid model as part of automated tests.

Prettier is pinned in `package-lock.json`. Use `npm ci` and the repository's `npm run format`
command so teammates and CI use the same formatter version.

## Configuration and releases

The OAuth client ID and manifest public key are public identifiers, not secrets. The shared
development key preserves the unpacked extension ID. Coordinate changes to these identifiers with
the team because a changed key changes the extension's storage identity.

Commit `package-lock.json`. Do not commit `.env`, private keys, generated ZIPs, `node_modules`, or
screenshots of real accounts. Runtime files are selected explicitly when packaging.

For a release, update `manifest.json` and `package.json` together, refresh the lockfile, and add a
changelog entry. Follow [the release guide](docs/RELEASING.md). Pushing code to this repository does
not publish a new version to the Chrome Web Store.

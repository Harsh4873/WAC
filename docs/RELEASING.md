# Release guide

## Source releases and store releases

This repository is the editable source. Store upload ZIPs are generated into ignored `dist/`. A Git
push does not upload or publish an extension in the Chrome Web Store.

Version `0.1.0` was submitted for store review on October 28, 2026. The repository's `0.1.1`
maintenance version is a separate source update; it does not replace a pending store submission
automatically.

## Prepare an upload

1. Update the version in both `manifest.json` and `package.json`. Each new store upload needs a
   larger Chrome version number: one to four integer components, each from 0 to 65535, with no
   leading zeroes and not all zeroes.
2. Run `npm install --package-lock-only --ignore-scripts` to refresh root version metadata. Use
   `npm ci` when installing a teammate's existing lockfile.
3. Update `CHANGELOG.md` and relevant documentation.
4. Run `npm run verify` and the browser checks appropriate to the changes.
5. Run `npm run package:webstore` and inspect the generated archive.
6. Open the existing WAC store item and select **Package → Upload new package**. Submit the update
   for review after checking listing, privacy, and test instructions.

The packager includes `manifest.json`, `sidepanel.html`, `analysis.config.json`, runtime
modules/styles, and icons. It removes the manifest's development `key` from the ZIP. It excludes
backend code, environment files, documentation, dependencies, tests, and screenshots. The source
manifest retains its public key so the current unpacked installation keeps its ID and local data.

For the previous local output location, use:

```sh
npm run package:webstore -- --out-dir ../releases
```

This creates files locally only. It does not send anything to Google.

## Extension identities and OAuth

| Installation                      | Public extension ID                |
| --------------------------------- | ---------------------------------- |
| Shared unpacked development build | `opiabkfomcghikkaicmfmhhbfgfonjhi` |
| WAC store item                    | `jemkcnfiakblmlfoefjenckljbcngeoj` |

Google OAuth clients of type Chrome Extension are bound to an Application ID. Verify the store
build's client is bound to the store ID; a successful local development login does not prove store
login will work. If separate clients are needed, configure the appropriate client before building
its package.

The manifest client ID and public key are not secrets. An OAuth client secret and Gemini API key are
secrets and must never be packaged. Google OAuth consent/verification and Chrome Web Store review
are separate processes.

To make a local installation use the store ID, obtain the store's public key and coordinate
replacing the development key. Changing the key changes the installation's storage identity.
Preserve any needed local data first. Do not remove the source key simply to fix a ZIP upload
rejection.

## Analysis service and public disclosures

The default analysis endpoint is local. This repository does not deploy a public AI backend. For
store testers using the local service, set `WAC_EXTENSION_IDS` to include the store ID;
`.env.example` includes that public ID. This allows a specific browser origin and does not
authenticate a public service.

The current privacy-policy source is [PRIVACY.md](PRIVACY.md). Its public page is:

<https://docs.google.com/document/d/e/2PACX-1vTp_k9h_dFHIoeV0vXN2K6iidQxZ0NoPfYsi6t54hrVV19AeisaoX9wdSIsCAkw2dGT5mcBj0sereHX/pub>

Keep the public policy, store data-use disclosures, reviewer instructions, and actual behavior
aligned when changing data handling, permissions, providers, or deployment. Update screenshots using
sample data. The course store item is configured as Unlisted for link-based sharing.

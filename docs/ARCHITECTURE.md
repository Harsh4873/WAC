# Architecture

WAC is a Manifest V3 extension with native browser modules and no runtime package dependencies. Its
optional analysis service uses Node.js built-ins. Development dependencies provide formatting and
browser tests; they are excluded from the store package.

## Module map

| Area                        | Files                                                              | Responsibility                                                                   |
| --------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| UI                          | `sidepanel.html`, `src/panel.mjs`, `src/panel.css`                 | Forms, summaries, task lists, plan review, and accessible effort controls        |
| Environment bridge          | `src/bridge.mjs`                                                   | Chrome background messaging, or separate local storage in the web preview        |
| State controller            | `src/controller.mjs`                                               | Serialized state updates, validation, planning, publishing, and synchronization  |
| Domain rules                | `src/core.mjs`, `src/profile.mjs`                                  | Estimates, preferences, date arithmetic, scheduling, and data migration          |
| Google boundary             | `src/google.mjs`                                                   | OAuth, availability, event reads, deterministic event creation, and recovery     |
| Background                  | `src/background.js`                                                | Chrome storage ownership and message authorization                               |
| Native calendar integration | `src/calendar-navigation.mjs`, `src/content.js`, `src/content.css` | Reuse the Calendar tab and decorate WAC-created events                           |
| Analysis boundary           | `src/analysis-contract.mjs`, `src/analysis-client.mjs`             | Validate imports/results and call the configured service                         |
| Local service               | `backend/`                                                         | Request limits, allowed origins, caching, demo responses, and Gemini requests    |
| Tooling                     | `scripts/`                                                         | Local preview, configuration, validation, browser smoke tests, and ZIP packaging |

## Task and planning flow

1. The panel captures an assignment and optional attachment/profile context.
2. The bridge sends a message to the background controller.
3. The controller validates and serializes changes, then saves `wacState` in `chrome.storage.local`.
4. Find time produces a proposal using the remaining estimate, preferences, deadlines, and busy
   time. Blocks sit on the open days just before the deadline. The due day is used only when earlier
   days cannot hold the work.
5. Saving a proposal revalidates it against current state. Saving keeps it local.
6. Publishing is a separate user-confirmed operation. It checks current Google availability and
   creates events on the primary calendar. Each assignment can override the default reminder count.
7. Unpublished blocks can move to another open time. The same checks used for a new plan apply. A
   collision banner is derived from deadlines and the daily limit; it is not stored on its own.

The controller protects published blocks from accidental local deletion. Deterministic Google event
IDs and private WAC metadata allow recovery from duplicate submissions and lost responses. A partial
remote success remains recorded; retrying publishes only remaining blocks.

## Analysis flow

The browser validates a text/PDF import and sends selected context to the configured local endpoint
only when the user asks for analysis. The service checks the request and origin, applies limits, and
either returns a clearly labeled fixed demo result or calls Gemini. Model output must pass the
shared schema and duration checks before the UI offers an editable draft.

Task text and TXT/Markdown content can remain in saved instructions. Only attachment metadata is
retained for PDFs. Calendar event lists and OAuth tokens are not automatically included in analysis
requests. See [the service contract](../backend/README.md) and [privacy policy](PRIVACY.md).

## Extension and preview boundaries

The installed extension uses the real Google Calendar page with a task side panel. It does not
render a replacement calendar. The optional web preview includes sample classes and a standalone
sample week for offline demonstrations. These environments have separate storage. The preview cannot
authenticate through Chrome Identity.

The content script receives a limited styling index, not the complete profile or original uploads.
Extension pages send the state-changing messages. The Calendar content script may also send
`SET_EFFORT` from the event badge. Native event decoration matches WAC-created event titles and may
need updates when Google changes its page structure.

## Storage compatibility

Data migration lives with state creation in `src/core.mjs`. Preserve old saved task/profile fields
when extending the schema. Add migration regression coverage before changing storage shape. Keep the
shared public key stable during development so a reload does not create a different storage
identity.

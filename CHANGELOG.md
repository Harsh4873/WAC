# Changelog

## 0.1.3 — 2026-11-09

- Show an all-day collision banner when deadlines on the same day exceed the daily work limit.
- Let unpublished work blocks be dragged on the preview week, or moved earlier from the plan list.
- Open an estimate popover with a one-click Low, Medium, or High override.
- Store Canvas-style points and submission type on assignments, including the course examples.
- Let each assignment choose its own reminder count. The settings value stays the default.
- On Google Calendar, show Low / Medium / High on WAC events and a collision notice. The event badge
  opens the same one-click estimate override.
- Place new work on the open days just before a deadline, instead of filling the next open day.
- Say Medium on Google Calendar, and fill effort stripes across the event instead of a hairline.

## 0.1.2 — 2026-10-30

- Set course example deadlines to December 7, 10, 10, and 14, 2026.
- Refresh untouched, unpublished older examples once, clearing their stale local work blocks while
  preserving edited, completed, manual, and published tasks.
- Keep sample class conflicts aligned with the current planning window and the preview's displayed
  week.

## 0.1.1 — 2026-10-28

- Prepare a maintainable source repository with architecture, setup, contribution, privacy, and
  release documentation.
- Apply a pinned formatter and add repeatable Node.js 22/24 CI checks.
- Keep generated packages and browser screenshots in ignored output directories.
- Replace the Python preview command with a loopback-only Node runtime-asset server.
- Let the local analysis service explicitly allow store extension IDs in addition to the shared
  development ID; add a cross-platform demo command and credential-free environment template.
- Validate Chrome version components, missing runtime imports, and secret exclusions during
  packaging.
- Add regression tests for preview boundaries, store packaging, and analysis-service configuration.

This source version has not been uploaded to the Chrome Web Store by these repository changes.

## 0.1.0 — 2026-10-28

- Initial course prototype: effort estimates, task profiles, PDF/text intake, editable work blocks,
  local planning, optional Google Calendar integration, and an optional Gemini analysis service.
- Provide Off, Tags, and Patterns controls while retaining native Calendar as the installed view.

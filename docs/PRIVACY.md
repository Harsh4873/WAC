# WAC Privacy Policy

Effective date: October 28, 2026

WAC (Workload Aware Calendar) is a university HCI course project that helps users estimate
assignment effort and plan work blocks alongside Google Calendar. This policy describes the 0.1.x
course prototype.

## Information WAC handles

- **Tasks and learning preferences:** task titles, course labels, deadlines, points, submission
  type, instructions, estimates, per-assignment reminder counts, completion status, work-block
  plans, settings, and optional self-reported learning preferences such as study area, familiar
  topics, reading pace, writing confidence, and preferred focus length.
- **Attachments:** file name, type, and size. TXT and Markdown content can be added to saved task
  instructions. Original PDF files are held temporarily for an analysis request and are not retained
  in WAC's task storage; reattaching a PDF is required to analyze it again.
- **Google Calendar information, when connected:** calendar event identifiers, titles, start and end
  times, all-day status, event links, and availability information. Calendar API responses and
  user-entered content can contain names or other personal information. WAC uses event titles and
  times for planning and synchronization, not for advertising or profiling.
- **Authentication information:** Google OAuth access tokens obtained through Chrome Identity to
  authorize Calendar API requests. WAC does not request your Google password and does not save OAuth
  tokens in its local task storage. Chrome manages its authentication token cache.

## How information is used

WAC uses this information to provide editable time estimates, display effort and workload, find
available times, save local plans, and create work blocks on the user's primary Google Calendar
after the user reviews and confirms publication. A content script on calendar.google.com matches
WAC-created events to add effort labels and patterns, shows a collision notice, and can update an
estimate from the event badge. That update is saved in local task storage.

The prototype does not include advertising, behavioral analytics, sale of user data,
creditworthiness assessment, or lending decisions. Personal information is not used for purposes
unrelated to WAC's workload-planning features.

## Where information goes

**Local planning:** tasks, learning preferences, settings, saved analysis results, work blocks, and
a cache of connected calendar events are stored in chrome.storage.local on your device. WAC does not
operate a central account or task-storage service in this build.

**Google Calendar:** if you choose to connect, WAC sends authenticated requests directly to Google
over HTTPS to read calendar information, check availability, and publish approved work blocks.
Published blocks include the task title, course label, deadline, effort estimate, and planned times.
Google processes this information under its own policies. Disconnecting WAC does not delete
previously published Google Calendar events.

**Optional assignment analysis:** importing a file or entering instructions alone does not send
content to an AI provider. Clicking the analysis action sends the selected task instructions, the
selected PDF if any, optional learning preferences, task context, and time-zone information to a
separately configured local service at 127.0.0.1:8787. The test extension does not include a hosted
AI service or a model API key. If the local service is configured to use Gemini, that service sends
the analysis content to Google Gemini over HTTPS. The local service keeps a bounded in-memory cache
of analysis results for up to ten minutes. Google processes requests under the applicable Gemini API
terms and privacy policies. Calendar events and OAuth tokens are not automatically sent to the
analysis service.

Do not submit content to optional analysis that you do not want processed by the configured service
and its model provider. Manual estimation and local planning can be used without AI analysis or a
Google Calendar connection.

## Retention and user controls

Local task data remains until changed or removed by the user or until WAC's extension data is
removed. Users can edit their learning preferences, delete assignments where supported, and clear
unpublished work blocks in WAC. Uninstalling the extension removes its local extension data.
Removing local data does not delete events already published to Google Calendar; those events must
be managed in Google Calendar.

Disconnecting Google through WAC clears WAC's connected-calendar cache and Chrome's cached
authorization tokens for the extension. Users can also revoke WAC's access through their Google
Account's third-party connections settings. Google and the optional model provider apply their own
retention policies to data processed by their services.

## Limited use of Google user data

WAC's use and transfer of information received from Google APIs adheres to the Google API Services
User Data Policy, including its Limited Use requirements. WAC also follows the Chrome Web Store User
Data Policy, including the Limited Use requirements. Google user data is used only for WAC's
disclosed, user-facing planning features; it is not sold, used for personalized advertising, or made
available for unrelated human review.

## Changes and contact

This policy will be updated when the prototype's data practices change. The effective date above
identifies this revision. For privacy questions, contact the WAC course project publisher at
notcillaj@gmail.com.

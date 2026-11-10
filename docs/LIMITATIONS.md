# Prototype limitations

- Rule-based and optional AI estimates are editable starting points, not validated predictions of a
  person's ability or performance. Deadline urgency is separate from effort.
- No live Canvas integration is included. Example assignments are local course fixtures with
  December 2026 deadlines. Learning preferences can be used across subjects, not only computer
  science.
- AI analysis requires a separately configured local service. No hosted backend or model API key is
  included. Demo analysis is a fixed labeled fixture and does not interpret PDF content.
- Planning covers one task at a time, considers up to 30 days ahead, and does not automatically
  rearrange existing blocks. New blocks are placed on the open days just before the deadline, not
  piled onto tomorrow when the deadline is weeks away. The due day is used only when earlier days
  cannot hold the work. Uniform plans may end with a shorter remainder. Custom shorter totals can be
  saved as partial plans; missing time is reported.
- Real availability and synchronization cover the primary Google calendar only. The daily limit
  counts WAC work blocks, not all classes, activities, or cognitive demands.
- Publication requires user review and confirmation. Assignment deadlines are not automatically
  published as calendar events. The preview's deadline markers are sample UI, not Google events.
- Refresh manually reconciles WAC-published events moved or deleted in Google Calendar. Local
  editing does not automatically reschedule existing published blocks.
- Deleting local plans, disconnecting Google, or uninstalling WAC does not delete published events.
  Manage those events in Google Calendar. The controller prevents deleting an assignment while its
  published blocks remain known locally.
- Unpublished work blocks can be dragged on the preview week, or moved earlier from the plan list.
  Dragging a block from the side panel into the Google Calendar grid is not implemented. Published
  events move in Google Calendar; refresh pulls the new time.
- Effort labels and stripes are applied locally to WAC-created events by a content script. The
  Google Calendar API does not support these arbitrary patterns. Renaming an event or a Google page
  redesign can affect matching and styling.
- The application and its optional Gemini adapter have automated fixture coverage. Automated tests
  do not validate live Google consent, current model access, store review, or a school's access
  rules.

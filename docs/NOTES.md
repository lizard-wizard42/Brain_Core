# Notes: checklists, reminders and recovery

Open Notes for short notes, lists and reminders. Search includes titles, text, tags and checklist entries; use All, Lists or Reminders filters and sort by last update or title.

## Mark items directly

Click or tap a checklist checkbox on a note card. The change is saved immediately; there is no need to open the editor. Controls remain disabled while that note is saving. If saving fails, the previous state remains and a visible error allows retry. While the editor is open, use its checklist controls and Save.

Each direct toggle updates only the selected item on the server. Concurrent changes to different checklist items do not overwrite each other, and toggling does not reset the note's reminder-delivery state.

## Trash and Undo

“Move to trash” removes a note from the normal board and offers Undo immediately. Open **Notes → Trash** to restore it later, including after restarting or changing devices. Restoring preserves the note ID, text, checklist, tags, color and reminder settings. Only the owning account can list or restore its trash.

Trashed notes do not appear in normal lists, global search or MCP note tools, and are excluded from new reminder delivery feeds. Android removes downloaded alarms after its next successful reminder synchronization; an already displayed or in-flight alert may remain. Restoring reactivates pending reminders, including overdue reminders not yet sent. The UI states this before restoration.

Trash has no automatic expiration or permanent-delete control in this version. Export and backups preserve trash status. This applies to deletions made after the update; notes permanently removed by earlier versions can only be recovered from an existing backup.

## Reminder dates

The default date uses the device/browser's local calendar, not a UTC date. A reminder started late in the evening therefore uses that local day. Stored date-only reminders stay date-only; notification scheduling and timezone behavior are described in the [Android guide](ANDROID.md).

## Deployment and API

Update the backend before serving the new frontend. Startup adds nullable `remember_notes.deleted_at` and an account/trash index automatically; existing notes are not moved or rewritten. Publish through `./build.sh`; native same-origin deployments also build `frontend/dist-same-origin`. No new Android APK is required.

- `GET /api/remember`: active notes only.
- `DELETE /api/remember/:id`: move the owning account's active note to trash.
- `GET /api/remember/trash`: the owning account's trashed notes.
- `POST /api/remember/:id/restore`: restore a trashed note without changing its content.
- `PATCH /api/remember/:id/checklist/:itemId` with `{ "checked": true }` or false: update one flag on an active note.

All routes require the existing account authentication. Inactive, missing or another account's targets return 404. The existing full-note update endpoint cannot edit a trashed note. Account export includes `deleted_at`; MCP history remains attached to the same note through trash and restoration.

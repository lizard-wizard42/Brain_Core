# Notebook: handwriting and paper

Create a page and choose **Caderno / Notebook**, below Infinite. The same bordered format choices are available for subpages. Enter a title, then choose the format; pressing Enter in the title retains the default text-note shortcut. Creation errors keep the title available for retry, and pending requests disable duplicate submissions. Notebooks live in the existing page tree and use the same account ownership, sharing, revision checks, trash and backups as other pages.

## Writing

- Pen and highlighter support editable vector ink. Choose a color and thickness; the pen uses pressure when the browser/device supplies it.
- The eraser removes whole strokes. Undo/redo applies to ink, text, paper and sheet changes while the editor remains open (up to 40 undo steps).
- Select with a rectangle, then drag to move ink and text. Delete a selection with its action button.
- Choose Text and tap a sheet to add a typed text box. Use Text again to edit it, or Select to move/delete it.
- Mouse drawing works on desktop. On touch devices, a finger moves the sheet by default; enable **Draw with finger** explicitly to draw without a pen. The Hand tool always pans. With the Text tool a finger tap adds a text box even when finger drawing is off; a box left empty is removed when it loses focus.
- While the S Pen side button is held, the pen erases whole strokes; releasing it returns to the current tool. This depends on the device reporting the button and is not verified on hardware.

## Zoom and view

- Two-finger pinch zooms around the point between the fingers (25% to 300%); the sheet follows the fingers while pinching and the zoom is applied once when they lift. A pen touching during a pinch cancels it so writing is never interrupted; a finger that lands right after the pen is ignored as a palm.
- Double tap with a finger toggles between fit-to-width and 100% (not in the Text tool, nor while finger drawing is on).
- Desktop: Ctrl+wheel zooms around the cursor; Ctrl/Cmd `+`, `-` and `0` zoom in, out and fit (ignored while typing in a field). The footer `-`/`+` buttons multiply by 1.2 around the center of the view; the percentage button fits the sheet.
- Opening, rotating or resizing fits the sheet to the width (in landscape the fit is capped by the height, never below 80%) until you zoom manually. A manual zoom is remembered per notebook in this browser.
- **Focus mode** (More menu, or F outside text fields) hides the bars and leaves a small exit button; Escape also exits.
- Ctrl+Y or Ctrl+Shift+Z redoes. Typing in the title or in one text box is grouped into a single undo step (about 0.8 s).

## Narrow screens

Up to 550 px wide the toolbar is one row (undo, redo, pen, highlighter, eraser, select, text, More); Hand, Paper, **Desenhar com dedo** and the input indicator are in the More menu, stroke width is a popover next to the colors, and the footer is one row (add sheet, import, remove and focus mode are in its menu). Colors are disabled for eraser, hand and select. In short landscape (height up to 500 px) the header is hidden and the title is in the footer menu.

**Checking that the pen is recognized.** Hover the pen over the sheet: a small blue ring follows it, and the options bar shows **Caneta detectada** (pen detected). If the bar shows **Toque fino** instead, the browser or WebView is reporting the S Pen as a touch contact; enable **Desenhar com dedo** to write with it. If a gesture ever loses its release event, the next pen touch now recovers instead of being ignored.

The implementation uses pointer capture, available coalesced pointer samples, pressure-aware outlines and animation-frame drawing. Touch contacts received during/recently after pen input are ignored as a best-effort precaution. Hardware palm rejection, pen latency and pressure quality depend on the device and browser; they are not guaranteed or certified. Finger pan, pinch zoom and button zoom are supported; two-finger rotation is not. Pinch and the pen button have only been tested with simulated events, not on a physical tablet.

## Sheets and paper

A notebook contains one or more 800 × 1120 logical-unit sheets. Add a sheet, switch with the footer controls, or open the sheet navigator. New sheets inherit the current paper. Remove a sheet from More; at least one sheet must remain, and removal can be undone in the current editing session.

Open **Paper** to preview blank, ruled, grid, dotted or Oxford paper. Choose narrow/normal/wide spacing and a paper tint, then Apply to the current sheet or all sheets. Changing paper never clears ink or text. Paper and vector content scale together with zoom; automatic width fitting follows container changes until manual zoom is chosen.

This first version focuses on writing. Covers, planner templates, handwriting recognition, PDF import/export, custom paper images and native S Pen SDK integration are not included. Notebook titles are searchable; handwriting and typed boxes are not indexed by the text search/MCP tools in this version.

## Saving, drafts and copies

Changes are automatically saved after a short pause. **Saved** means the server acknowledged that snapshot. Writes are serialized and use the existing page revision; a newer server revision returns a conflict instead of silently overwriting another session.

An account-scoped IndexedDB draft is also queued after edits. If a save fails, the writing remains on screen with Retry and Download copy actions. If browser draft storage fails, a separate warning appears. Opening a notebook with an unsent local draft asks whether to recover it. Drafts based on an older server revision can be downloaded, but are not automatically applied over the newer version. Drafts are local to that browser/profile and do not replace backups or provide a full offline app.

Download copy creates a `.brain-notebook.json` file with editable ink, typed text, paper and sheets. **More → Add sheets from a copy** validates and appends those sheets without replacing existing writing. Copies are private user data: do not commit or attach real notebooks to public issues.

Version 1 limits: 100 sheets, 10,000 ink/text objects, 100,000 sampled ink points, 10,000 points per stroke, 10,000 characters per text box and 200,000 typed characters per notebook. Imported files must be at most 8 MB. The API independently validates snapshots and retains the existing 10 MB request limit. Continue in a new notebook before reaching the limits.

## Deployment and validation

No schema migration or new Android APK is required: the existing pages table stores `type: notebook` and a versioned JSON document (`notebook: true`, `version: 1`, `sheets`). Update the backend before the frontend so defaults and validation are ready. Publish with `./build.sh`; native same-origin deployments also build `frontend/dist-same-origin`.

A malformed or unsupported notebook is never normalized to a blank page. Creation, updates, permissions, revision conflict, stored history and trash/restore are tested against disposable PostgreSQL. Pointer interactions, paper preservation, undo/redo, network failures and draft recovery have frontend tests. Visual checks use fictional content; physical handwriting with an S Pen remains a separate device check.

# README screenshots

The README gallery was refreshed on 2026-10-24 from the web components in commit
`a22b7e36dd2a18af776043e887a6b2dcbe02c06b`. This documentation change does not
modify application behavior.

## Gallery

| Image | What it shows |
| --- | --- |
| [Editor](images/editor-demo.jpg) | Compact page tree, real rich-text content, managed subpage cards, writing between cards and the corner code-copy icon. |
| [Notebook](images/notebook-demo.jpg) | Editable vector ink, typed text boxes, ruled paper, pen tools and multiple sheets. |
| [Paper chooser](images/notebook-paper-demo.jpg) | Blank, ruled, grid, dotted and Oxford styles, spacing and paper tint. |
| [Quick Notes](images/notes-board-demo.jpg) | Fictional checklists, a reminder, search, filters, sorting and recoverable Trash navigation. |
| [Infinite](images/infinite-canvas-demo.jpg) | Native tldraw shapes, arrows and sticky notes in a fictional visual workflow. |
| [Memory](images/memory-conversation-demo.jpg) | A fictional two-speaker conversation, manual speaker controls and note/copy/download actions. The page is scrolled to keep all three turns visible. |
| [Dashboard](images/dashboard-current-demo.jpg) | Quick capture, recent work, recordings and the activity overview, computed from fictional page/note dates. |

## Data and language

These are browser screenshots of the actual React components, rendered in a
separate, disposable source copy with in-memory fixture responses. They are not
captures of a personal account and are not generated product mockups.

The fixture supplies example pages such as Product studio, Research notes,
Sketchbook and Reading room; a fictional Demo account; and a conversation with
fictional Me/Alex speakers. Notebook ink and typed boxes are synthetic editable
document data. Infinite examples are created with the canvas API. The Memory
conversation does not come from an audio recording and does not demonstrate
transcription accuracy or speaker-recognition accuracy.

English display labels and date formatting are applied only in the documentation
fixture. The shipped application remains primarily Portuguese; the gallery does
not claim complete English localization. Numeric date controls can follow the
browser's regional format. Some ink/zoom behavior still requires physical-device
validation; see [Notebook limits](NOTEBOOK.md).

## Capture and publication procedure

1. Work from a disposable copy of the reviewed source. Keep demonstration
   files outside the production installation and do not include private `.env`
   files, uploads, recordings, browser sessions or database exports.
2. Render the real components with fictional API data. Disable sockets and
   reject unhandled API calls rather than falling through to a live backend.
   Use the real theme, page layout and document renderers; apply English labels
   only in the fixture. Do not hide third-party licensing notices.
3. Inspect the visible controls before capture. Allow the page to finish
   loading; frame meaningful content and dismiss unrelated popovers. Include
   a paper chooser separately instead of obscuring the main Notebook view.
4. Capture only the application content area. Review every image for real
   account names, note titles, addresses, credentials, notifications, browser
   chrome and unrelated desktop content.
5. Verify the actual image encoding and metadata. These files are JPEGs with
   no EXIF; only standard JFIF/ICC metadata may be present. No pixel retouching,
   artificial feature overlays or personal-data redaction was needed.
6. Add descriptive alt text and captions, update the gallery/source version,
   and check local links before publishing. Stop the disposable demo server
   and remove its browser tab after review.

The images illustrate the implemented interface, not a performance benchmark,
a hardware certification or a guarantee that optional services are configured.
Detailed limits and setup belong to the linked feature guides. Older screenshots
elsewhere in the documentation have their own narrower context; the README uses
this gallery in place of the previous dashboard/navigation/Timeline set.

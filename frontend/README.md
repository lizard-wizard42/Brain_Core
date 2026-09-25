# Frontend

React frontend for Brain Core.

## Main areas

- sidebar tree and trash
- mobile-style dashboard/home with app tiles
- TipTap note editor
- attachment blocks for PDF/Office/text uploads
- infinite canvas with `tldraw`
- terminal drawer with `xterm`
- mobile terminal helper keyboard

## Scripts

```bash
npm run dev
npm run lint
npm run build
```

## Notes

- source of truth is `frontend/src/`; do not manually edit `dist/`
- build uses standard Vite base `/`
- `src/App.tsx` owns the dashboard/home layout and the app launcher tiles shown on `/`
- `src/components/Editor/Editor.tsx` now performs an immediate HTTP save after inserting uploaded attachments/images, and also flushes pending saves on `pagehide`
- `src/components/Editor/Editor.tsx` now includes a custom `pt-BR` + `en-US` spelling review UX:
  - no default browser wavy underline while typing
  - bottom-toolbar spellcheck toggle
  - enabled review mode with straight red underline decorations
  - click a highlighted word to open suggestions near that word
  - dictionaries are lazy-loaded so normal typing does not scan the whole document
  - accessibility basics on the badge (`aria-pressed`, `aria-label`, keyboard focus ring)
  - native Chrome spellcheck is not used for counting/listing because that API is not exposed reliably in JavaScript
- `src/components/Editor/AttachmentBlockView.tsx` normalizes legacy mojibake attachment names in the UI, so old PDFs with broken accent encoding still render correctly
- `src/components/Terminal/TerminalDrawer.tsx` contains a deliberate viewport recovery workaround for `xterm`: when a terminal tab becomes active again, it may replay a fast `page_up` followed by `bottom` over Socket.IO to recover a visually blank viewport without restarting the session.
- This workaround exists because the terminal session is supposed to stay alive across internal tab switches; only closing the terminal tab or losing the browser/PWA window should end the session.

## Files worth knowing

- `src/App.tsx`
- `src/components/Sidebar/Sidebar.tsx`
- `src/components/Editor/Editor.tsx`
- `src/components/Infinite/InfiniteRenderer.tsx`
- `src/components/Terminal/TerminalDrawer.tsx`
- `src/hooks/useSocket.ts`

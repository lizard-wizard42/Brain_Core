# Brain Core Frontend - Testing & Coverage Status

Date: 2026-05-14

## What was done

- Removed custom text-review dependency path from editor flow and kept browser-native spellcheck toggle only.
- Added/expanded automated tests for routes, pages, hooks, sidebar, tabs, trash, terminal drawer, terminal session registry, and slash menu.
- Added quality scripts for test, coverage, dead-code and bundle inspection.

## Current baseline

- Test files: 15 passed
- Tests: 62 passed
- Coverage summary:
  - Statements: 32.91%
  - Branches: 26.92%
  - Functions: 29.03%
  - Lines: 35.37%

## Main coverage highlights

- `src/pages/RememberPage.tsx`: 77.77% lines
- `src/pages/SettingsPage.tsx`: 78.29% lines
- `src/components/Trash/TrashPanel.tsx`: 97.36% lines
- `src/components/Terminal/TerminalDrawer.tsx`: 59.62% lines
- `src/components/Terminal/terminalSessionRegistry.ts`: 96.29% lines
- `src/components/Sidebar/Sidebar.tsx`: 38.9% lines
- `src/App.tsx`: 44.24% lines

## Runbook

```bash
npm run test
npm run coverage
npm run quality
```

## Next step to reach ~40%+

- Add a minimal `Editor.tsx` interaction suite (spellcheck toggle + save status path).
- Add remaining `TerminalDrawer` error/timeout branches.

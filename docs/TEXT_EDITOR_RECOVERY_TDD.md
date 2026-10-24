# Text editor recovery — TDD evidence

Journeys were derived from the request to recover unsent text and test saving.
All examples use fictional accounts, pages and writing. No installation data is
used by the tests or browser demonstration.

## RED and GREEN checkpoints

| Guarantee | RED evidence | GREEN evidence |
| --- | --- | --- |
| Account/page-scoped IndexedDB drafts, immediate capture, debounced saves, failure/retry, recovery choices and conflicts | Storage and persistence tests referenced the missing implementation; both test targets failed to resolve the new modules (`a69624c`). | The same targets passed all 9 tests (`e1e9df0`). |
| Actual Tiptap integration restores complete content and title before editing, and preserves a rich code block through a failed save and retry | All 3 new editor integration tests failed against the original editor (`da20236`); recovery was absent and local draft writes were missing. | Editor, persistence and storage targets passed 14 tests (`39395ae`). |
| New edits survive an older save, including undo back to the previous server text and edits during IndexedDB cleanup | Two additional runtime tests failed (`da20236`). | Both pass with pending-save tracking and matching-snapshot acknowledgement (`39395ae`). |
| An editor snapshot retains its expected revision even if the API has cached a newer revision | API regression expected revision 3 but observed 8 (`b788c70`). | API and recovery targets passed 27 tests (`0405d14`). |
| Successful icon/cover edits can advance the base revision without treating another writer's content as a safe rebase | Two new metadata acknowledgement tests failed (`447d1a4`). | Persistence and header tests pass; the 5 relevant targets passed 32 tests (`c1d6184`). |

Checkpoint commits remain in the branch history. Additional tests cover session
end, missing account, server-read failure, icon-then-text editing and cover
acknowledgements.

## Validation targets

- `npm test --prefix frontend -- src/components/Editor/Editor.persistence.test.tsx src/components/Editor/useTextEditorPersistence.test.ts src/components/Editor/textEditorDrafts.test.ts src/components/Editor/PageHeader.test.tsx src/components/Editor/EditorCover.test.tsx src/api/client.test.ts --maxWorkers=2`
- `npm run coverage --prefix frontend -- --maxWorkers=2 --retry=1`
- Scoped ESLint for all changed TypeScript and TSX files.
- Canonical `./build.sh` and `npm run build:same-origin --prefix frontend`.
- Maintainer-required backend, disposable PostgreSQL, MCP, offline Memory and backup tests, plus the public-release check.

The browser check used the real Editor and real IndexedDB on an isolated demo
origin with a fictional in-memory server and socket stub. A failed save was
followed by reload, explicit recovery, a successful save and another reload.
The exact title and text persisted and the recovery prompt disappeared. The
fixture was removed and is not shipped with the product.

## Scope and limits

This work covers text document persistence. Notebook and Infinite formats keep
their own persistence paths. IndexedDB recovery depends on the same browser,
origin and account and available storage; it is not a server backup or a full
offline application. A stale recovery remains blocked from overwriting server
content and can be downloaded as JSON.

The repository-wide lint baseline was already failing before this feature;
this change checks touched files rather than suppressing unrelated errors.
Coverage improvements target persistence; existing untested menus and other
features are not claimed as fully covered. Final suite and coverage figures are
recorded in the pull request.

## Final local results

- Full frontend suite: 408 tests passed across 67 files, with coverage enabled.
- Overall frontend lines: 67.67% (baseline before this work: 62.44%). This is not
  a claim of 80% coverage for the existing application as a whole.
- Backend: 73; disposable PostgreSQL: 24; MCP: 2; offline Memory: 85;
  backup JavaScript: 3 and backup Python: 2 tests passed.
- All touched TypeScript/TSX files passed scoped ESLint; both production build
  targets passed, including the TypeScript build.
- Public-release check and diff whitespace check passed.

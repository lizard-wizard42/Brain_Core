# Page card movement validation

## Reproduced behavior

The editor could reorder document nodes but did not move page hierarchy when a
card was dropped onto another card. Native dragging also cleared the custom page
identity and could serialize a previous text selection instead of the page.
The default gap cursor used a black line without an explicit writing action.

## Red/green checkpoints

- Tests first required page identity, center nesting, editable/reference guards,
  writing insertion and save-before-move revision reconciliation.
- A native drag regression reproduced identity loss after the editor cleared the
  transfer store, including React node-view wrapper retargeting.
- A real Tiptap test reproduced a paragraph slice from a stale text selection.
  Selecting the page before native serialization changed the slice to the page
  node; the post-native bridge restores the custom transfer identity.
- Existing sidebar drag behavior remains covered by regression tests.

The focused tests cover failed saves, rejected moves, successful moves followed by
failed reloads, surrounding text preservation, and a subsequent save with the
updated parent revision. No database migration or new dependency is required.

## Browser verification

An independent agent used the actual editor in a disposable, fictional fixture
with mocked API responses and real browser IndexedDB. Native center dragging
moved Alpha into Beta and removed Alpha from the parent document while retaining
surrounding text. A failed move retained all cards and a subsequent retry worked.
Writing between cards and saving after a move used the reconciled revision.
Native edge dragging reordered Gamma before Alpha and Beta without changing their
parents or losing surrounding paragraphs. No personal notes or recordings were
used or modified during this verification.

Native drag behavior can vary by device/browser. This change does not claim
phone touch-drag support or simultaneous collaborative move guarantees.

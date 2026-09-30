import { describe, expect, it, vi } from 'vitest';
import { whenEditorViewReady } from './editorUtils';

function fakeEditor(initial: { isInitialized: boolean; isDestroyed?: boolean }) {
  const handlers = new Set<() => void>();
  return {
    isInitialized: initial.isInitialized,
    isDestroyed: initial.isDestroyed ?? false,
    on: vi.fn((_e: 'create', h: () => void) => { handlers.add(h); }),
    off: vi.fn((_e: 'create', h: () => void) => { handlers.delete(h); }),
    fireCreate: () => handlers.forEach((h) => h()),
    handlers,
  };
}

describe('whenEditorViewReady', () => {
  it('does not touch the view before the editor is mounted, then runs once on create', () => {
    const editor = fakeEditor({ isInitialized: false });
    const fn = vi.fn();
    whenEditorViewReady(editor, fn);
    expect(fn).not.toHaveBeenCalled();
    editor.fireCreate();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs immediately when the view already exists', () => {
    const editor = fakeEditor({ isInitialized: true });
    const fn = vi.fn();
    whenEditorViewReady(editor, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(editor.on).not.toHaveBeenCalled();
  });

  it('cleanup cancels a pending run and skips destroyed editors', () => {
    const editor = fakeEditor({ isInitialized: false });
    const fn = vi.fn();
    const cleanup = whenEditorViewReady(editor, fn);
    cleanup();
    editor.fireCreate();
    expect(fn).not.toHaveBeenCalled();
    expect(editor.handlers.size).toBe(0);

    const destroyed = fakeEditor({ isInitialized: true, isDestroyed: true });
    whenEditorViewReady(destroyed, fn);
    expect(fn).not.toHaveBeenCalled();
  });
});

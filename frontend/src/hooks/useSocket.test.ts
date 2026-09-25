import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocket } from './useSocket';

const on = vi.fn();
const off = vi.fn();
const emit = vi.fn();
const connect = vi.fn();

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    connected: true,
    connect,
    on,
    off,
    emit,
    io: { engine: { transport: { ws: { readyState: 1 } } } },
  })),
}));

describe('useSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers and unregisters listeners', () => {
    const { unmount } = renderHook(() => useSocket({ onSaved: vi.fn(), onError: vi.fn() }));
    expect(on).toHaveBeenCalledWith('page:saved', expect.any(Function));
    expect(on).toHaveBeenCalledWith('page:error', expect.any(Function));

    unmount();

    expect(off).toHaveBeenCalledWith('page:saved', expect.any(Function));
    expect(off).toHaveBeenCalledWith('page:error', expect.any(Function));
  });

  it('emits join/leave/save when connected', () => {
    const { result } = renderHook(() => useSocket());
    result.current.joinPage('p1');
    result.current.leavePage('p1');
    result.current.savePage('p1', { type: 'doc' }, 'Title');

    expect(emit).toHaveBeenCalledWith('page:join', { pageId: 'p1' });
    expect(emit).toHaveBeenCalledWith('page:leave', { pageId: 'p1' });
    expect(emit).toHaveBeenCalledWith('page:save', { pageId: 'p1', content: { type: 'doc' }, title: 'Title' });
  });
});

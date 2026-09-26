import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanLocalAudio,
  getNativeStatus,
  isNativeAndroidApp,
  isNativeBridgeAvailable,
  linkDevice,
  requestMicrophonePermission,
  unlinkDevice,
} from './nativeBridge';

type TestWindow = {
  brainCoreNativeBridge?: { _listener?: (event: unknown) => void; [key: string]: unknown };
  ResizeObserver?: unknown;
};

describe('nativeBridge', () => {
  const originalUserAgent = navigator.userAgent;

  beforeEach(() => {
    delete (window as unknown as TestWindow).brainCoreNativeBridge;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent });
    delete (window as unknown as TestWindow).brainCoreNativeBridge;
  });

  it('detecta ambiente nativo Android pelo user agent', () => {
    expect(isNativeAndroidApp()).toBe(false);
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 ... BrainCoreAndroid/1',
    });
    expect(isNativeAndroidApp()).toBe(true);
  });

  it('detecta se o bridge está injetado na window', () => {
    expect(isNativeBridgeAvailable()).toBe(false);
    window.brainCoreNativeBridge = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    expect(isNativeBridgeAvailable()).toBe(true);
  });

  it('consulta status do aparelho via bridge', async () => {
    let capturedListener: ((event: unknown) => void) | null = null;
    window.brainCoreNativeBridge = {
      postMessage: vi.fn((raw: string) => {
        const parsed = JSON.parse(raw);
        expect(parsed.action).toBe('getStatus');
        expect(parsed.requestId).toBeDefined();
        setTimeout(() => {
          capturedListener?.({
            data: JSON.stringify({
              action: 'status',
              requestId: parsed.requestId,
              linked: true,
              deviceId: 'dev-123',
              linkedUserId: 'user-1',
              recordingOwnerUserId: 'user-1',
              pendingChunks: 3,
              conflictChunks: 0,
              totalSessions: 1,
              totalChunks: 3,
              audioBytes: 3145728,
              freeSpaceBytes: 15000000000,
              isLowSpace: false,
              eligibleCleanupChunks: 2,
              eligibleCleanupBytes: 2097152,
              retentionDays: 30,
              claimableUnowned: 0,
              microphonePermission: 'granted',
            }),
          });
        }, 10);
      }),
      addEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => {
        capturedListener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    const status = await getNativeStatus();
    expect(status.linked).toBe(true);
    expect(status.pendingChunks).toBe(3);
    expect(status.freeSpaceBytes).toBe(15000000000);
    expect(status.microphonePermission).toBe('granted');
  });

  it('solicita vinculação passando expectedUserId e confirmSwitch', async () => {
    let capturedListener: ((event: unknown) => void) | null = null;
    window.brainCoreNativeBridge = {
      postMessage: vi.fn((raw: string) => {
        const parsed = JSON.parse(raw);
        expect(parsed.action).toBe('linkDevice');
        expect(parsed.expectedUserId).toBe('user-2');
        expect(parsed.confirmSwitch).toBe(true);
        setTimeout(() => {
          capturedListener?.({
            data: JSON.stringify({
              action: 'linkResult',
              requestId: parsed.requestId,
              success: true,
              deviceId: 'dev-456',
              userId: 'user-2',
            }),
          });
        }, 10);
      }),
      addEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => {
        capturedListener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    const res = await linkDevice('user-2', true);
    expect(res.success).toBe(true);
    expect(res.deviceId).toBe('dev-456');
    expect(res.userId).toBe('user-2');
  });

  it('solicita limpeza local de áudio', async () => {
    let capturedListener: ((event: unknown) => void) | null = null;
    window.brainCoreNativeBridge = {
      postMessage: vi.fn((raw: string) => {
        const parsed = JSON.parse(raw);
        expect(parsed.action).toBe('cleanLocal');
        expect(parsed.days).toBe(14);
        setTimeout(() => {
          capturedListener?.({
            data: JSON.stringify({
              action: 'cleanLocalResult',
              requestId: parsed.requestId,
              success: true,
              deletedChunks: 5,
              freedBytes: 5242880,
            }),
          });
        }, 10);
      }),
      addEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => {
        capturedListener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    const res = await cleanLocalAudio(14);
    expect(res.success).toBe(true);
    expect(res.deletedChunks).toBe(5);
    expect(res.freedBytes).toBe(5242880);
  });

  it('solicita desvinculação do aparelho', async () => {
    let capturedListener: ((event: unknown) => void) | null = null;
    window.brainCoreNativeBridge = {
      postMessage: vi.fn((raw: string) => {
        const parsed = JSON.parse(raw);
        expect(parsed.action).toBe('unlinkDevice');
        setTimeout(() => {
          capturedListener?.({
            data: JSON.stringify({
              action: 'unlinkResult',
              requestId: parsed.requestId,
              success: true,
            }),
          });
        }, 10);
      }),
      addEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => {
        capturedListener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    const res = await unlinkDevice();
    expect(res.success).toBe(true);
  });

  it('solicita permissão de microfone pelo Android', async () => {
    let capturedListener: ((event: unknown) => void) | null = null;
    window.brainCoreNativeBridge = {
      postMessage: vi.fn((raw: string) => {
        const parsed = JSON.parse(raw);
        expect(parsed.action).toBe('requestMicrophonePermission');
        setTimeout(() => {
          capturedListener?.({
            data: JSON.stringify({
              action: 'status',
              requestId: parsed.requestId,
              linked: true,
              deviceId: 'dev-1',
              linkedUserId: 'u-1',
              recordingOwnerUserId: 'u-1',
              pendingChunks: 0,
              conflictChunks: 0,
              totalSessions: 1,
              totalChunks: 1,
              audioBytes: 1024,
              freeSpaceBytes: 1000000000,
              isLowSpace: false,
              eligibleCleanupChunks: 0,
              eligibleCleanupBytes: 0,
              retentionDays: 30,
              claimableUnowned: 0,
              microphonePermission: 'granted',
            }),
          });
        }, 10);
      }),
      addEventListener: vi.fn((_type: string, listener: (event: unknown) => void) => {
        capturedListener = listener;
      }),
      removeEventListener: vi.fn(),
    };

    const updated = await requestMicrophonePermission();
    expect(updated.microphonePermission).toBe('granted');
  });

  it('rejeita com timeout caso a ponte nativa não responda', async () => {
    window.brainCoreNativeBridge = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    await expect(getNativeStatus()).rejects.toThrow();
  }, 10000);
});

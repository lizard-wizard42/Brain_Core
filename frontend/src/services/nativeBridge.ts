export interface NativeDeviceStatus {
  linked: boolean;
  deviceId: string | null;
  linkedUserId: string | null;
  recordingOwnerUserId: string | null;
  pendingChunks: number;
  conflictChunks: number;
  totalSessions: number;
  totalChunks: number;
  audioBytes: number;
  freeSpaceBytes: number;
  isLowSpace: boolean;
  eligibleCleanupChunks: number;
  eligibleCleanupBytes: number;
  retentionDays: number;
  claimableUnowned: number;
  microphonePermission: 'granted' | 'denied';
  nativeRecordingActive?: boolean;
}

export interface NativeCleanResult {
  success: boolean;
  deletedChunks?: number;
  freedBytes?: number;
  error?: string;
}

export interface NativeLinkResult {
  success: boolean;
  deviceId?: string;
  userId?: string;
  error?: string;
  message?: string;
  currentOwner?: string;
  targetOwner?: string;
}

interface BridgeMessageEvent {
  data: string;
}

interface WebMessagePortLike {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: (event: BridgeMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: BridgeMessageEvent) => void): void;
  onmessage?: ((event: BridgeMessageEvent) => void) | null;
}

declare global {
  interface Window {
    brainCoreNativeBridge?: WebMessagePortLike;
  }
}

export function isNativeAndroidApp(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('BrainCoreAndroid/1');
}

export function isNativeBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.brainCoreNativeBridge;
}

function sendBridgeRequest<T>(payload: Record<string, unknown>, timeoutMs = 6000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!isNativeBridgeAvailable()) {
      reject(new Error('Ponte nativa Android indisponível'));
      return;
    }

    const bridge = window.brainCoreNativeBridge!;
    const requestId = Math.random().toString(36).slice(2) + Date.now();
    const fullPayload = { ...payload, requestId };

    let timer: ReturnType<typeof setTimeout> | null = null;

    const listener = (event: BridgeMessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && (data.requestId === requestId || (!data.requestId && data.action === payload.action))) {
          cleanup();
          resolve(data as T);
        }
      } catch {
        // Ignora mensagens malformadas de outros canais
      }
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (typeof bridge.removeEventListener === 'function') {
        bridge.removeEventListener('message', listener);
      } else if (bridge.onmessage === listener) {
        bridge.onmessage = null;
      }
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Tempo limite excedido na comunicação com o Android'));
    }, timeoutMs);

    if (typeof bridge.addEventListener === 'function') {
      bridge.addEventListener('message', listener);
    } else {
      bridge.onmessage = listener;
    }

    try {
      bridge.postMessage(JSON.stringify(fullPayload));
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

export async function getNativeStatus(): Promise<NativeDeviceStatus> {
  return sendBridgeRequest<NativeDeviceStatus>({ action: 'getStatus' });
}

export async function cleanLocalAudio(days?: number): Promise<NativeCleanResult> {
  return sendBridgeRequest<NativeCleanResult>({ action: 'cleanLocal', days });
}

export async function linkDevice(expectedUserId: string, confirmSwitch = false): Promise<NativeLinkResult> {
  return sendBridgeRequest<NativeLinkResult>({
    action: 'linkDevice',
    expectedUserId,
    confirmSwitch,
  });
}

export async function unlinkDevice(): Promise<{ success: boolean }> {
  return sendBridgeRequest<{ success: boolean }>({ action: 'unlinkDevice' });
}

export async function requestMicrophonePermission(): Promise<NativeDeviceStatus> {
  return sendBridgeRequest<NativeDeviceStatus>({ action: 'requestMicrophonePermission' });
}

export interface NativeVoiceSampleResult { success: boolean; error?: string }

export function startNativeVoiceSample(): Promise<NativeVoiceSampleResult> {
  return sendBridgeRequest<NativeVoiceSampleResult>({ action: 'startVoiceSample' }, 15000);
}

export function stopNativeVoiceSample(): Promise<NativeVoiceSampleResult> {
  return sendBridgeRequest<NativeVoiceSampleResult>({ action: 'stopVoiceSample' }, 120000);
}

export function cancelNativeVoiceSample(): Promise<NativeVoiceSampleResult> {
  return sendBridgeRequest<NativeVoiceSampleResult>({ action: 'cancelVoiceSample' });
}

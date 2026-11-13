import React, { useEffect, useRef, useState } from 'react';
import { Mic, Send } from 'lucide-react';
import type { DisplayLanguage } from '../i18n';
import {
  MAX_RECORDING_MS,
  SttError,
  createSttAdapter,
  toSttLanguage,
  type SttLanguage,
  type SttResult,
  type TranscribeOptions,
} from '../services/sttAdapter';

export const speechPlaceholder = (language: DisplayLanguage): string =>
  language === 'zh' ? 'Your turn to speak...' : 'Your turn to speak...';

// ── Quick speech presets ────────────────────────────────────────────

interface QuickSpeechData {
  text: string;
  needsTarget: boolean;
  tone: 'neutral' | 'suspicion' | 'defend';
}

export interface QuickSpeechPreset {
  text: string;
  needsTarget: boolean;
  tone: 'neutral' | 'suspicion' | 'defend';
}

const PRESETS: QuickSpeechData[] = [
  { text: 'Pass', needsTarget: false, tone: 'neutral' },
  { text: "I'm a villager", needsTarget: false, tone: 'defend' },
  { text: 'Let me listen', needsTarget: false, tone: 'neutral' },
  { text: 'Player X is a werewolf', needsTarget: true, tone: 'suspicion' },
  { text: 'Player X is suspicious', needsTarget: true, tone: 'suspicion' },
  { text: 'Player X seems good', needsTarget: true, tone: 'defend' },
  { text: 'I trust Player X', needsTarget: true, tone: 'defend' },
];

export const buildQuickSpeeches = (_language: DisplayLanguage): QuickSpeechPreset[] =>
  PRESETS.map(({ text, needsTarget, tone }) => ({
    text,
    needsTarget,
    tone,
  }));

export const applyQuickTemplate = (preset: QuickSpeechPreset, playerId: number): string =>
  preset.text.replace('X', String(playerId));

// ── Voice input (push-to-talk, same-origin cloud ASR) ───────────────

export type VoiceStatus = 'idle' | 'recording' | 'transcribing';

export interface VoiceViewState {
  status: VoiceStatus;
  message: string | null;
}

/** English chrome; every failure maps to exactly one visible line. */
export const VOICE_MESSAGES = {
  recording: 'Recording…',
  transcribing: 'Transcribing…',
  permissionDenied: 'Microphone permission denied',
  unsupported: 'Voice input unavailable in this browser',
  noSpeech: 'No speech detected',
  transcriptionTimeout: 'Transcription timed out. Please type instead.',
  unavailable: 'Voice input is temporarily unavailable. Please type instead.',
} as const;

export interface VoiceStreamLike {
  getTracks: () => ReadonlyArray<{ stop: () => void }>;
}

export interface VoiceRecorderLike {
  mimeType?: string;
  state?: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export interface VoiceEnvironment {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<VoiceStreamLike>;
  createRecorder?: (stream: VoiceStreamLike) => VoiceRecorderLike;
}

export const browserVoiceEnvironment = (): VoiceEnvironment => {
  if (typeof navigator === 'undefined' || typeof MediaRecorder === 'undefined') return {};
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return {};
  return {
    getUserMedia: constraints => mediaDevices.getUserMedia(constraints),
    createRecorder: stream => new MediaRecorder(stream as unknown as MediaStream) as unknown as VoiceRecorderLike,
  };
};

/** `false` disables the microphone button and shows the unsupported line. */
export const voiceInputSupported = (environment: VoiceEnvironment = browserVoiceEnvironment()): boolean =>
  Boolean(environment.getUserMedia && environment.createRecorder);

/** 16 kHz mono PCM16 WAV: the most portable format for the ASR function. */
export const VOICE_WAV_SAMPLE_RATE = 16_000;

export const encodePcm16Wav = (
  samples: Float32Array,
  sampleRate = VOICE_WAV_SAMPLE_RATE,
): ArrayBuffer => {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
};

/**
 * Normalise MediaRecorder output (Chrome webm/opus, Safari mp4) to WAV via
 * WebAudio. If decoding is unavailable, the original recording is submitted
 * unchanged; the format support of the ASR model is unverified (see V-B report).
 */
export const prepareVoiceAudio = async (audio: Blob): Promise<Blob> => {
  if (audio.type === 'audio/wav'
    || typeof window === 'undefined'
    || typeof AudioContext === 'undefined'
    || typeof OfflineAudioContext === 'undefined') {
    return audio;
  }
  try {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await audio.arrayBuffer());
      const frames = Math.max(1, Math.ceil(decoded.duration * VOICE_WAV_SAMPLE_RATE));
      const offline = new OfflineAudioContext(1, frames, VOICE_WAV_SAMPLE_RATE);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      return new Blob([encodePcm16Wav(rendered.getChannelData(0))], { type: 'audio/wav' });
    } finally {
      void context.close().catch(() => undefined);
    }
  } catch {
    return audio;
  }
};

export interface VoiceCallbacks {
  onState: (status: VoiceStatus, message: string | null) => void;
  onTranscript: (text: string) => void;
}

export interface VoiceAdapterLike {
  transcribe: (audio: Blob, options?: TranscribeOptions) => Promise<SttResult>;
}

export interface VoiceControllerOptions {
  lang: SttLanguage;
  callbacks: VoiceCallbacks;
  createAdapter?: (lang: SttLanguage) => VoiceAdapterLike;
  prepareAudio?: (audio: Blob) => Promise<Blob>;
  environment?: VoiceEnvironment;
}

const messageForError = (error: unknown): string | null => {
  if (error instanceof SttError) {
    if (error.code === 'timeout') return VOICE_MESSAGES.transcriptionTimeout;
    if (error.code === 'aborted') return null;
  }
  return VOICE_MESSAGES.unavailable;
};

const messageForPermission = (error: unknown): string => {
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : null;
  return name === 'NotAllowedError' || name === 'SecurityError'
    ? VOICE_MESSAGES.permissionDenied
    : VOICE_MESSAGES.unavailable;
};

/**
 * Framework-free push-to-talk state machine (`idle → recording → transcribing
 * → idle`). The component owns rendering only, so every failure path is unit
 * testable without a DOM.
 */
export class VoiceInputController {
  private readonly options: VoiceControllerOptions;
  private readonly environment: VoiceEnvironment;
  private status: VoiceStatus = 'idle';
  private lang: SttLanguage;
  private disposed = false;
  private runId = 0;
  private stream: VoiceStreamLike | null = null;
  private recorder: VoiceRecorderLike | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;

  constructor(options: VoiceControllerOptions) {
    this.options = options;
    this.lang = options.lang;
    this.environment = options.environment ?? browserVoiceEnvironment();
  }

  getStatus = (): VoiceStatus => this.status;

  private isRecording(): boolean {
    return this.status === 'recording';
  }

  isSupported = (): boolean => voiceInputSupported(this.environment);

  /** Applies to the next recording; an in-flight one keeps its language. */
  setLanguage(lang: SttLanguage): void {
    this.lang = lang;
  }

  async start(): Promise<void> {
    if (this.disposed || this.status !== 'idle' || !this.isSupported()) return;

    const getUserMedia = this.environment.getUserMedia;
    const createRecorder = this.environment.createRecorder;
    if (!getUserMedia || !createRecorder) {
      this.setState('idle', VOICE_MESSAGES.unsupported);
      return;
    }

    const runId = ++this.runId;
    this.setState('recording', null);

    let stream: VoiceStreamLike;
    try {
      stream = await getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      if (this.disposed || this.runId !== runId) return;
      this.setState('idle', messageForPermission(error));
      return;
    }

    if (this.disposed || this.runId !== runId || !this.isRecording()) {
      stopTracks(stream);
      return;
    }

    this.stream = stream;
    try {
      const recorder = createRecorder(stream);
      this.recorder = recorder;
      this.chunks = [];
      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onstop = null;
      recorder.onerror = () => {
        if (this.runId !== runId) return;
        this.cancel();
        this.setState('idle', VOICE_MESSAGES.unavailable);
      };
      recorder.start();
      this.startedAt = Date.now();
      this.timer = setTimeout(() => this.stop(), MAX_RECORDING_MS);
    } catch {
      this.stopTracks();
      this.chunks = [];
      this.setState('idle', VOICE_MESSAGES.unsupported);
    }
  }

  /** Release: stop recording and transcribe once. Never auto-submits. */
  stop(): void {
    if (this.status !== 'recording') return;
    this.clearTimer();

    const recorder = this.recorder;
    this.recorder = null;
    const runId = this.runId;
    const durationMs = Math.min(
      MAX_RECORDING_MS,
      Math.max(0, Math.round(Date.now() - this.startedAt)),
    );
    this.setState('transcribing', null);

    if (!recorder) {
      this.stopTracks();
      this.setState('idle', null);
      return;
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.stopTracks();
      this.finishRecording(durationMs, runId);
    };
    recorder.onstop = finish;
    recorder.onerror = finish;
    try {
      if (recorder.state === 'inactive') finish();
      else recorder.stop();
    } catch {
      finish();
    }
    this.stopTracks();
  }

  /** User cancel / visibility loss: discard audio and any in-flight request. */
  cancel(): void {
    this.runId += 1;
    this.clearTimer();
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // The recorder is already gone; nothing to release.
      }
    }
    this.chunks = [];
    this.stopTracks();
    this.abortRequest();
    if (!this.disposed) this.setState('idle', null);
  }

  suspend(): void {
    this.cancel();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runId += 1;
    this.clearTimer();
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // Already inactive.
      }
    }
    this.chunks = [];
    this.stopTracks();
    this.abortRequest();
    this.status = 'idle';
  }

  private finishRecording(durationMs: number, runId: number): void {
    if (this.disposed || this.runId !== runId) return;
    const chunks = this.chunks;
    this.chunks = [];
    let blob: Blob;
    try {
      const type = chunks.find(chunk => chunk.type)?.type || 'audio/webm';
      blob = new Blob(chunks, { type });
    } catch {
      this.setState('idle', VOICE_MESSAGES.unavailable);
      return;
    }
    void this.transcribe(blob, durationMs, runId);
  }

  private async transcribe(blob: Blob, durationMs: number, runId: number): Promise<void> {
    if (blob.size === 0) {
      this.setState('idle', VOICE_MESSAGES.noSpeech);
      return;
    }

    const controller = new AbortController();
    this.request = controller;
    try {
      const prepared = await (this.options.prepareAudio ?? prepareVoiceAudio)(blob);
      if (this.disposed || this.runId !== runId) return;

      const createAdapter = this.options.createAdapter
        ?? ((lang: SttLanguage) => createSttAdapter({ lang }));
      const adapter = createAdapter(this.lang);
      const result = await adapter.transcribe(prepared, {
        signal: controller.signal,
        durationMs,
      });
      if (this.disposed || this.runId !== runId) return;

      const text = result.text.trim();
      if (!text) {
        this.setState('idle', VOICE_MESSAGES.noSpeech);
        return;
      }
      this.setState('idle', null);
      this.options.callbacks.onTranscript(text);
    } catch (error) {
      if (this.disposed || this.runId !== runId) return;
      this.setState('idle', messageForError(error));
    } finally {
      if (this.request === controller) this.request = null;
    }
  }

  private stopTracks(): void {
    if (this.stream) {
      stopTracks(this.stream);
      this.stream = null;
    }
  }

  private abortRequest(): void {
    this.request?.abort();
    this.request = null;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setState(status: VoiceStatus, message: string | null): void {
    this.status = status;
    if (!this.disposed) this.options.callbacks.onState(status, message);
  }
}

const stopTracks = (stream: VoiceStreamLike): void => {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // A released track must never break the turn.
    }
  }
};

export const createVoiceInputController = (options: VoiceControllerOptions): VoiceInputController =>
  new VoiceInputController(options);

// ── Voice control presentation ──────────────────────────────────────

export interface VoiceControlHandlers {
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  onPointerUp?: React.PointerEventHandler<HTMLButtonElement>;
  onPointerLeave?: React.PointerEventHandler<HTMLButtonElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLButtonElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  onKeyUp?: React.KeyboardEventHandler<HTMLButtonElement>;
}

export interface VoiceControlProps extends VoiceControlHandlers {
  supported: boolean;
  status: VoiceStatus;
  message: string | null;
  disabled?: boolean;
}

export const VoiceControl: React.FC<VoiceControlProps> = ({
  supported,
  status,
  message,
  disabled = false,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  onKeyDown,
  onKeyUp,
}) => {
  const recording = status === 'recording';
  const transcribing = status === 'transcribing';
  const label = recording
    ? 'Cancel voice input'
    : transcribing ? 'Transcribing' : 'Hold to record speech';

  return (
    <div className="game-voice-input flex w-full min-w-0 flex-wrap items-center gap-2" data-voice-status={status}>
      <button
        type="button"
        className="action-button voice-input-button shrink-0 px-3"
        aria-label={label}
        aria-pressed={recording}
        title={supported ? label : VOICE_MESSAGES.unsupported}
        disabled={!supported || disabled || transcribing}
        data-voice-control
        style={{ touchAction: 'none' }}
        onContextMenu={event => event.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <Mic className="w-4 h-4" />
      </button>
      {recording && <span role="status" className="text-xs text-red-300">{VOICE_MESSAGES.recording}</span>}
      {transcribing && <span role="status" className="text-xs text-zinc-300">{VOICE_MESSAGES.transcribing}</span>}
      {!supported && <span className="text-xs text-zinc-400">{VOICE_MESSAGES.unsupported}</span>}
      {message && <span role="status" aria-live="polite" className="text-xs text-amber-400">{message}</span>}
      {supported && !message && !recording && !transcribing && (
        <span className="text-[10px] text-zinc-500">
          Voice audio is sent to our speech service for transcription.
        </span>
      )}
    </div>
  );
};

// ── Component ───────────────────────────────────────────────────────

const SpeechInput = ({
  value,
  onChange,
  onSubmit,
  submitDisabled = false,
  visible,
  selectedPlayer,
  language = 'en',
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitDisabled?: boolean;
  visible: boolean;
  selectedPlayer?: { id: number; isAlive: boolean } | null;
  language?: DisplayLanguage;
}) => {
  const [pendingTemplate, setPendingTemplate] = useState<QuickSpeechPreset | null>(null);
  const [voice, setVoice] = useState<VoiceViewState>({ status: 'idle', message: null });
  const [voiceSupported] = useState(() => voiceInputSupported());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const controllerRef = useRef<VoiceInputController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createVoiceInputController({
      lang: toSttLanguage(language),
      callbacks: {
        onState: (status, message) => setVoice({ status, message }),
        onTranscript: text => onChangeRef.current(text),
      },
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controller.setLanguage(toSttLanguage(language));
  }, [controller, language]);

  // Losing the turn (or unmounting) silently discards audio and in-flight work.
  useEffect(() => {
    if (!visible) controller.suspend();
  }, [controller, visible]);

  // React StrictMode runs effects as setup → cleanup → setup on mount, so this
  // cleanup must NOT permanently dispose the controller (BUG-V-C-01). suspend()
  // already releases everything a real unmount needs to release: it stops the
  // MediaStream tracks, clears the 60s timer and aborts any in-flight request.
  // After a real unmount the controller has no live resources and is collected
  // with the component tree; a late getUserMedia/transcribe resolution is
  // ignored by the runId guard.
  useEffect(() => () => controller.suspend(), [controller]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') controller.suspend();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [controller]);

  // Escape cancels even if the pointer moved focus away from the microphone.
  useEffect(() => {
    if (voice.status !== 'recording' || typeof document === 'undefined') return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') controller.cancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [controller, voice.status]);

  // Apply a pending target template when a valid player is selected.
  useEffect(() => {
    if (!pendingTemplate) return;
    if (!selectedPlayer || !selectedPlayer.isAlive || selectedPlayer.id === 1) return;
    onChange(applyQuickTemplate(pendingTemplate, selectedPlayer.id));
    setPendingTemplate(null);
  }, [selectedPlayer, pendingTemplate, onChange]);

  // Discard any armed template when the input is no longer visible.
  useEffect(() => {
    if (!visible) setPendingTemplate(null);
  }, [visible]);

  if (!visible) return null;

  const speeches = buildQuickSpeeches(language);
  const showPendingHint = pendingTemplate !== null;

  const handlePresetClick = (preset: QuickSpeechPreset) => {
    if (!preset.needsTarget) {
      onChange(preset.text);
      setPendingTemplate(null);
      return;
    }
    // Target preset — fill immediately if a valid player is already selected.
    if (selectedPlayer && selectedPlayer.isAlive && selectedPlayer.id !== 1) {
      onChange(applyQuickTemplate(preset, selectedPlayer.id));
      setPendingTemplate(null);
    } else {
      setPendingTemplate(preset);
    }
  };

  const handleVoicePointerDown: React.PointerEventHandler<HTMLButtonElement> = event => {
    event.preventDefault();
    if (controller.getStatus() === 'recording') controller.cancel();
    else void controller.start();
  };

  const handleVoiceStop = () => controller.stop();

  const handleVoiceKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      controller.cancel();
      return;
    }
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.repeat) return;
    if (controller.getStatus() === 'recording') controller.cancel();
    else void controller.start();
  };

  const handleVoiceKeyUp: React.KeyboardEventHandler<HTMLButtonElement> = event => {
    if (event.key === ' ' || event.key === 'Enter') controller.stop();
  };

  return (
    <div className="game-speech-input mt-4 flex flex-col gap-2">
      {/* Quick speech buttons */}
      <div className="game-speech-presets flex flex-wrap gap-1.5">
        {speeches.map((preset, i) => (
          <button
            key={i}
            onClick={() => handlePresetClick(preset)}
            className={`game-quick-speech-button px-2.5 py-1 text-xs rounded-full border transition-colors ${
              preset.tone === 'suspicion'
                ? 'border-red-700/50 text-red-300 hover:bg-red-900/30'
                : preset.tone === 'defend'
                  ? 'border-emerald-700/50 text-emerald-300 hover:bg-emerald-900/30'
                  : 'border-zinc-600 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {preset.text}
          </button>
        ))}
      </div>

      {/* Pending-target hint */}
      {showPendingHint && (
        <div className="text-xs text-amber-400">
          Tap a player card to fill in the number
        </div>
      )}

      {/* Free-text input row */}
      <div className="flex w-full min-w-0 flex-wrap gap-2" data-speech-input-row>
        <input
          className="min-w-0 flex-[1_1_8rem] bg-black/70 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-zinc-200"
          value={value}
          data-ui-copy-category="USER_AUTHORED"
          data-ui-copy-allow="USER_SPEECH_INPUT"
          onChange={e => onChange(e.target.value)}
          placeholder={speechPlaceholder(language)}
          onKeyDown={e => { if (e.key === 'Enter' && !submitDisabled) onSubmit(); }}
        />
        <button onClick={onSubmit} disabled={submitDisabled} className="action-button shrink-0 px-3" aria-label="Send speech"><Send className="w-4 h-4" /></button>
      </div>

      <VoiceControl
        supported={voiceSupported}
        status={voice.status}
        message={voice.message}
        onPointerDown={handleVoicePointerDown}
        onPointerUp={handleVoiceStop}
        onPointerLeave={handleVoiceStop}
        onPointerCancel={handleVoiceStop}
        onKeyDown={handleVoiceKeyDown}
        onKeyUp={handleVoiceKeyUp}
      />
    </div>
  );
};

export default SpeechInput;

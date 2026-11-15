import React from 'react';
import { Power, Volume2, VolumeX } from 'lucide-react';

interface Props {
  voiceEnabled: boolean;
  volume: number;
  rate: number;
  muted: boolean;
  onVoiceChange: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onRateChange: (rate: number) => void;
  onMuteChange: (muted: boolean) => void;
}

export default function GameAudioControls({
  voiceEnabled, volume, rate, muted, onVoiceChange, onVolumeChange, onRateChange, onMuteChange,
}: Props) {
  return (
    <div className="game-room-audio-controls" role="group" aria-label="Audio settings">
      <button type="button" className="game-audio-switch" data-tour-target="game-voice"
        onClick={() => onVoiceChange(!voiceEnabled)} aria-pressed={voiceEnabled}
        title="Toggle AI voice" aria-label="Toggle AI voice">
        <span className="game-audio-label">AI Voice</span>
        <span className={voiceEnabled ? 'game-audio-state game-audio-state--on' : 'game-audio-state'}>
          <Power size={16} aria-hidden="true" />{voiceEnabled ? 'On' : 'Off'}
        </span>
      </button>
      <label className="game-audio-field" data-tour-target="game-volume">
        <span className="game-audio-label">Volume <span className="game-audio-value">{Math.round(volume * 100)}%</span></span>
        <input type="range" min={0} max={1} step={0.05} value={volume}
          onChange={event => onVolumeChange(Number(event.target.value))}
          className="game-audio-slider" title="Volume" aria-label="Volume"
          aria-valuetext={`${Math.round(volume * 100)} percent`} />
      </label>
      <label className="game-audio-field" data-tour-target="game-rate">
        <span className="game-audio-label">Speech rate <span className="game-audio-value">{rate.toFixed(1)}×</span></span>
        <input type="range" min={0.5} max={2} step={0.1} value={rate}
          onChange={event => onRateChange(Number(event.target.value))}
          className="game-audio-slider" title="Speech rate" aria-label="Speech rate"
          aria-valuetext={`${rate.toFixed(1)} times normal speed`} />
      </label>
      <button type="button" className="game-audio-switch" data-tour-target="game-mute"
        onClick={() => onMuteChange(!muted)} aria-pressed={muted}
        title="Mute or unmute" aria-label="Mute or unmute">
        <span className="game-audio-label">Sound</span>
        <span className="game-audio-state">
          {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
          {muted ? 'Muted' : 'On'}
        </span>
      </button>
    </div>
  );
}

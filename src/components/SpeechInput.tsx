import React, { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import type { DisplayLanguage } from '../i18n';

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

// ── Component ───────────────────────────────────────────────────────

const SpeechInput = ({
  value,
  onChange,
  onSubmit,
  visible,
  selectedPlayer,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  visible: boolean;
  selectedPlayer?: { id: number; isAlive: boolean } | null;
}) => {
  const language: DisplayLanguage = 'en';
  const [pendingTemplate, setPendingTemplate] = useState<QuickSpeechPreset | null>(null);

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
          onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
        />
        <button onClick={onSubmit} className="action-button shrink-0 px-3" aria-label="Send speech"><Send className="w-4 h-4" /></button>
      </div>
    </div>
  );
};

export default SpeechInput;

import React from 'react';
import { Send } from 'lucide-react';
import { useDisplayLanguage, type DisplayLanguage } from '../i18n';

export const speechPlaceholder = (language: DisplayLanguage): string =>
  language === 'zh' ? '轮到你发言...' : 'Your turn to speak...';

const SpeechInput = ({
  value,
  onChange,
  onSubmit,
  visible,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  visible: boolean;
}) => {
  const [language] = useDisplayLanguage();
  if (!visible) return null;
  return (
    <div className="mt-4 flex gap-2">
      <input
        className="flex-1 bg-black/70 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-zinc-200"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={speechPlaceholder(language)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
      />
      <button onClick={onSubmit} className="action-button px-3"><Send className="w-4 h-4" /></button>
    </div>
  );
};

export default SpeechInput;

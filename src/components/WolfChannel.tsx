import React from 'react';
import { Skull } from 'lucide-react';
import { WolfChatMessage } from '../types';

const WolfChannel = ({ wolfChat, isVisible }: { wolfChat: WolfChatMessage[]; isVisible: boolean }) => {
  if (!isVisible) return null;
  return (
    <div className="wolf-channel">
      <div className="flex items-center gap-2 text-sm font-bold mb-2"><Skull className="w-4 h-4" />Werewolf Night Chat</div>
      <div className="space-y-2">
        {wolfChat.map(item => (
          <div key={item.id} className="text-xs border border-red-950 bg-red-950/25 rounded p-2">
            <span className="text-red-200 font-bold">Player {item.speakerId} [<span data-ui-copy-category="AI_OR_PLAYER_SPEECH_OR_CHAT" data-ui-copy-allow="AI_WOLF_CHANNEL">{item.strategyTag}</span>]</span>
            <span className="text-zinc-200 ml-2" data-ui-copy-category="AI_OR_PLAYER_SPEECH_OR_CHAT" data-ui-copy-allow="AI_WOLF_CHANNEL">{item.message}</span>
          </div>
        ))}
        {wolfChat.length === 0 && <div className="text-xs text-zinc-500">The werewolves are planning their night strategy...</div>}
      </div>
    </div>
  );
};

export default WolfChannel;

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import BattlePassView, { getEligibleBattlePassTierIds } from './BattlePassView';
import FactionSupportView from './FactionSupportView';
import LobbyActivityView from './LobbyActivityView';
import LobbyFeatureMenu from './LobbyFeatureMenu';
import WolfVillagePreview from './WolfVillagePreview';
import LobbyActionButtons from './LobbyActionButtons';
import MatchSelection from './MatchSelection';

describe('standalone lobby feature surfaces', () => {
  it('renders explicit current and limited activity categories with login rewards', () => {
    const html = renderToStaticMarkup(
      <LobbyActivityView claimedActivityIds={['daily-roll-call']} onClaimActivity={() => undefined} />,
    );
    expect(html).toContain('Current Activities');
    expect(html).toContain('Limited Activities');
    expect(html).toContain('Seven-Day Login Reward');
    expect(html).toContain('Login reward · Day 3');
  });

  it('renders holiday events with countdown and deadline states', () => {
    const html = renderToStaticMarkup(
      <LobbyActivityView claimedActivityIds={[]} onClaimActivity={() => undefined} />,
    );
    expect(html).toContain('Full Moon Festival');
    expect(html).toContain('Festival event · Limited time');
    expect(html).toContain('Ends July 31 at 23:59');
    expect(html).toContain('7 days 05:42 remaining');
    expect(html).toContain('05:42:18 remaining');
  });

  it('retains local claim states and keeps real rewards unavailable', () => {
    const html = renderToStaticMarkup(
      <LobbyActivityView claimedActivityIds={['daily-roll-call']} onClaimActivity={() => undefined} />,
    );
    expect(html).toContain('Daily Roll Call');
    expect(html).toContain('Recorded Locally');
    expect(html).toContain('Real-Value Rewards');
    expect(html).toContain('Cannot Claim');
    expect(html).toContain('disabled=""');
  });

  it('renders GPT, Gemini, Claude, and DeepSeek introductions with local points', () => {
    const html = renderToStaticMarkup(
      <FactionSupportView
        contributions={{ gpt: 12_345, gemini: 50, claude: 7, deepseek: 3 }}
        onContribute={() => undefined}
      />,
    );
    for (const faction of ['GPT Faction', 'Gemini Faction', 'Claude Faction', 'DeepSeek Faction']) {
      expect(html).toContain(faction);
    }
    expect(html).toContain('Clear, structured reasoning');
    expect(html).toContain('Examines contradictions and focuses on logical analysis');
    expect(html).toContain('12,345');
    expect(html).toContain('Local Support Points');
  });

  it('renders support rewards, leaderboard, daily tasks, and contribution progress', () => {
    const html = renderToStaticMarkup(
      <FactionSupportView
        contributions={{ gpt: 4, gemini: 2, claude: 0, deepseek: 0 }}
        onContribute={() => undefined}
      />,
    );
    expect(html).toContain('Contribution Reward Progress');
    expect(html).toContain('Support reward previews');
    expect(html).toContain('Rookie Supporter Badge');
    expect(html).toContain('Local Support Leaderboard');
    expect(html).toContain('Daily Tasks');
    expect(html).toContain('Support 2 model factions');
    expect(html).toContain('Global Leaderboard and Real Rewards');
    expect(html).toContain('Cannot Contribute');
  });

  it('renders current level, explicit EXP, and free/premium reward previews', () => {
    const html = renderToStaticMarkup(
      <BattlePassView
        currentTier={2}
        currentExp={220}
        targetExp={500}
        claimedTierIds={['tier-1']}
        onClaimTier={() => undefined}
      />,
    );
    expect(html).toContain('Current Level');
    expect(html).toContain('EXP 220 / 500');
    expect(html).toContain('280 EXP to next level');
    expect(html).toContain('Free Reward Preview');
    expect(html).toContain('Premium Reward Preview');
    expect(html).toContain('Silver Moon Avatar Frame Preview');
    expect(html).toContain('Claimed Locally');
    expect(html).toContain('Locked');
  });

  it('offers one-click eligible local claims and disables premium upgrade purchase', () => {
    const html = renderToStaticMarkup(
      <BattlePassView currentTier={2} claimedTierIds={['tier-1']} onClaimTier={() => undefined} />,
    );
    expect(getEligibleBattlePassTierIds(2, ['tier-1'])).toEqual(['tier-2']);
    expect(html).toContain('Claim All Free Rewards (1)');
    expect(html).toContain('Premium Battle Pass');
    expect(html).toContain('The premium track is a reward preview only');
    expect(html).toContain('Upgrade Unavailable');
    expect(html).toContain('disabled=""');
  });

  it('normalizes invalid standalone numeric props', () => {
    const factionHtml = renderToStaticMarkup(
      <FactionSupportView
        contributions={{ gpt: Number.POSITIVE_INFINITY, gemini: Number.NaN, claude: -2, deepseek: 0 }}
        onContribute={() => undefined}
      />,
    );
    const passHtml = renderToStaticMarkup(
      <BattlePassView
        currentTier={Number.NaN}
        currentExp={Number.POSITIVE_INFINITY}
        targetExp={Number.NaN}
        claimedTierIds={[]}
        onClaimTier={() => undefined}
      />,
    );
    expect(factionHtml).not.toContain('Infinity');
    expect(factionHtml).not.toContain('NaN');
    expect(passHtml).not.toContain('NaN');
  });

  it('renders every feature-menu command and its disabled state', () => {
    const html = renderToStaticMarkup(
      <LobbyFeatureMenu onSelect={() => undefined} disabledItems={['mail', 'redeem-code']} />,
    );
    for (const label of ['Settings', 'Announcements', 'Mail', 'Support', 'Help', 'User Center', 'Redeem Code', 'About']) {
      expect(html).toContain(label);
    }
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it('previews friend, message, create-village, and join-village routes', () => {
    const html = renderToStaticMarkup(<WolfVillagePreview />);
    for (const route of ['Add Friends', 'Message Center', 'Create Village', 'Join Village']) {
      expect(html).toContain(route);
    }
    expect(html).toContain('Social Feature Preview');
    expect(html).toContain('Services are not connected');
  });

  it('keeps all social previews and multiplayer room actions visibly disabled', () => {
    const html = renderToStaticMarkup(<WolfVillagePreview />);
    expect(html).toContain('Live Multiplayer Rooms');
    expect(html).toContain('This page does not create rooms or connect to live matches');
    expect(html.match(/disabled=""/g)).toHaveLength(7);
    for (const action of ['Create', 'Join', 'Spectate']) expect(html).toContain(action);
  });

  it('keeps lobby build, join, and spectate native-disabled', () => {
    const html = renderToStaticMarkup(<LobbyActionButtons />);
    for (const action of ['Create', 'Join', 'Spectate']) expect(html).toContain(action);
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain('No room is created or connected here');
  });

  it('keeps multi-match and limited boards native-disabled', () => {
    const html = renderToStaticMarkup(
      <MatchSelection onBack={() => undefined} onSelectBoard={() => undefined} />,
    );
    expect(html).toContain('Multi-Board Match · Unavailable');
    expect(html).toContain('12-Player Awakened Dreamweaver');
    expect(html).toContain('9-Player Blood Moon Demon Hunter');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});

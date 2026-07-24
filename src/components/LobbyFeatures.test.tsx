import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import BattlePassView, { getEligibleBattlePassTierIds } from './BattlePassView';
import FactionSupportView from './FactionSupportView';
import LobbyActivityView from './LobbyActivityView';
import LobbyFeatureMenu from './LobbyFeatureMenu';
import WolfVillagePreview from './WolfVillagePreview';

describe('standalone lobby feature surfaces', () => {
  it('renders explicit current and limited activity categories with login rewards', () => {
    const html = renderToStaticMarkup(
      <LobbyActivityView claimedActivityIds={['daily-roll-call']} onClaimActivity={() => undefined} />,
    );
    expect(html).toContain('当前活动');
    expect(html).toContain('限时活动');
    expect(html).toContain('七日登录奖励');
    expect(html).toContain('登录奖励 · 第 3 天');
  });

  it('renders holiday events with countdown and deadline states', () => {
    const html = renderToStaticMarkup(
      <LobbyActivityView claimedActivityIds={[]} onClaimActivity={() => undefined} />,
    );
    expect(html).toContain('满月节庆典');
    expect(html).toContain('节日活动 · 限时开放');
    expect(html).toContain('7月31日 23:59 截止');
    expect(html).toContain('剩余 7天 05:42');
    expect(html).toContain('倒计时 05:42:18');
  });

  it('retains local claim states and keeps real rewards unavailable', () => {
    const html = renderToStaticMarkup(
      <LobbyActivityView claimedActivityIds={['daily-roll-call']} onClaimActivity={() => undefined} />,
    );
    expect(html).toContain('每日点名');
    expect(html).toContain('本地已记录');
    expect(html).toContain('真实经济奖励');
    expect(html).toContain('不可领取');
    expect(html).toContain('disabled=""');
  });

  it('renders GPT, Gemini, Claude, and DeepSeek introductions with local points', () => {
    const html = renderToStaticMarkup(
      <FactionSupportView
        contributions={{ gpt: 12_345, gemini: 50, claude: 7, deepseek: 3 }}
        onContribute={() => undefined}
      />,
    );
    for (const faction of ['GPT 阵营', 'Gemini 阵营', 'Claude 阵营', 'DeepSeek 阵营']) {
      expect(html).toContain(faction);
    }
    expect(html).toContain('条理清晰，擅长结构化推理');
    expect(html).toContain('深挖发言矛盾，专注逻辑分析');
    expect(html).toContain('12,345');
    expect(html).toContain('本地应援点');
  });

  it('renders support rewards, leaderboard, daily tasks, and contribution progress', () => {
    const html = renderToStaticMarkup(
      <FactionSupportView
        contributions={{ gpt: 4, gemini: 2, claude: 0, deepseek: 0 }}
        onContribute={() => undefined}
      />,
    );
    expect(html).toContain('贡献奖励进度');
    expect(html).toContain('应援奖励预览');
    expect(html).toContain('应援新秀徽记');
    expect(html).toContain('本地应援排行榜');
    expect(html).toContain('每日任务');
    expect(html).toContain('支持 2 个模型阵营');
    expect(html).toContain('全服排行榜与真实应援奖励');
    expect(html).toContain('不可贡献');
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
    expect(html).toContain('当前等级');
    expect(html).toContain('EXP 220 / 500');
    expect(html).toContain('距离下一级 280 EXP');
    expect(html).toContain('免费奖励预览');
    expect(html).toContain('高级奖励预览');
    expect(html).toContain('银月头像框预览');
    expect(html).toContain('本地已领取');
    expect(html).toContain('未解锁');
  });

  it('offers one-click eligible local claims and disables premium upgrade purchase', () => {
    const html = renderToStaticMarkup(
      <BattlePassView currentTier={2} claimedTierIds={['tier-1']} onClaimTier={() => undefined} />,
    );
    expect(getEligibleBattlePassTierIds(2, ['tier-1'])).toEqual(['tier-2']);
    expect(html).toContain('一键领取免费奖励 (1)');
    expect(html).toContain('高级通行证');
    expect(html).toContain('高级轨仅供奖励预览');
    expect(html).toContain('升级购买未开放');
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
    for (const label of ['设置', '公告', '邮件', '客服', '帮助', '用户中心', '兑换码', '关于游戏']) {
      expect(html).toContain(label);
    }
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it('previews friend, message, create-village, and join-village routes', () => {
    const html = renderToStaticMarkup(<WolfVillagePreview />);
    for (const route of ['添加好友', '消息中心', '创建狼村', '加入狼村']) {
      expect(html).toContain(route);
    }
    expect(html).toContain('社交功能预览');
    expect(html).toContain('暂未接入服务');
  });

  it('keeps all social previews and multiplayer room actions visibly disabled', () => {
    const html = renderToStaticMarkup(<WolfVillagePreview />);
    expect(html).toContain('真人多人房间');
    expect(html).toContain('本页面不创建房间、不连接真人对局');
    expect(html.match(/disabled=""/g)).toHaveLength(7);
    for (const action of ['建房', '跟房', '观战']) expect(html).toContain(action);
  });
});

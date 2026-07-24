import React from 'react';
import { ArrowLeft, Languages } from 'lucide-react';
import { UTILITY_DESTINATIONS, type UtilityDestination } from './UtilityMenu';

interface UtilityContent {
  title: string;
  kicker: string;
  description: string;
  detail: string;
}

export const UTILITY_CONTENT: Record<UtilityDestination, UtilityContent> = {
  settings: {
    title: '设置',
    kicker: '本机偏好',
    description: '调整当前设备上的显示语言。对局规则与账号资产不会在这里变更。',
    detail: '声音与对局内选项仍在游戏房间中管理。',
  },
  announcements: {
    title: '公告',
    kicker: '本地公告板',
    description: '当前版本为单人 AI 对局与社交路线预览。',
    detail: '真人多人房间尚未开放。',
  },
  mail: {
    title: '邮件',
    kicker: '消息预览',
    description: '暂无可领取邮件。本页面不会连接消息服务或发放真实奖励。',
    detail: '0 封未读邮件',
  },
  support: {
    title: '客服',
    kicker: '客户服务',
    description: '客服工单服务尚未接入。请勿在本地预览中提交个人或支付信息。',
    detail: '服务状态：预览',
  },
  help: {
    title: '帮助',
    kicker: '游戏指南',
    description: '标准单人场支持 9 人与 12 人板型，并提供新手、进阶、高手三档难度。',
    detail: '选择“开始游戏”并在最终确认后进入对局。',
  },
  'user-center': {
    title: '用户中心',
    kicker: '账号概览',
    description: '账号资料与本地大厅进度按当前用户隔离。',
    detail: '资料修改与社交管理尚未开放。',
  },
  'redeem-code': {
    title: '兑换码',
    kicker: '功能预览',
    description: '兑换服务尚未接入；本页面不会写入钱包、库存或服务器。',
    detail: '兑换入口暂未开放。',
  },
  about: {
    title: '关于游戏',
    kicker: 'AI Werewolf',
    description: '一名真人与 AI 玩家完成完整狼人杀对局的推理游戏。',
    detail: '当前阶段：单人 AI 对局与社交基础预览。',
  },
};

interface UtilityViewProps {
  destination: UtilityDestination;
  displayLanguage: 'zh' | 'en';
  onToggleLanguage: () => void;
  onBack: () => void;
}

const UtilityView: React.FC<UtilityViewProps> = ({
  destination,
  displayLanguage,
  onToggleLanguage,
  onBack,
}) => {
  const content = UTILITY_CONTENT[destination];
  const Icon = UTILITY_DESTINATIONS.find(item => item.id === destination)?.Icon;
  return (
    <main className="utility-page utility-detail" aria-labelledby="utility-view-title">
      <header className="app-page-header">
        <button className="app-page-back" type="button" onClick={onBack} aria-label="返回功能菜单" autoFocus>
          <ArrowLeft aria-hidden="true" />
          <span>返回</span>
        </button>
        <div>
          <p className="app-page-kicker">{content.kicker}</p>
          <h1 id="utility-view-title">{content.title}</h1>
        </div>
        {Icon && <Icon aria-hidden="true" />}
      </header>
      <section className="utility-detail-content">
        <p>{content.description}</p>
        <strong>{content.detail}</strong>
        {destination === 'settings' && (
          <button className="app-secondary-button" type="button" onClick={onToggleLanguage}>
            <Languages aria-hidden="true" />
            显示语言：{displayLanguage === 'zh' ? '中文' : 'English'}
          </button>
        )}
        {destination === 'redeem-code' && (
          <div className="utility-redeem-preview">
            <label htmlFor="utility-redeem-code">兑换码</label>
            <input id="utility-redeem-code" value="" placeholder="暂未开放" disabled readOnly />
            <button type="button" disabled>兑换未开放</button>
          </div>
        )}
      </section>
    </main>
  );
};

export default UtilityView;

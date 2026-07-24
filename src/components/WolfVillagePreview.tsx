import React from 'react';
import {
  ArrowLeft,
  Bot,
  DoorOpen,
  Eye,
  Home,
  Lock,
  MessageSquare,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import '../styles/lobby-features.css';

export interface WolfVillagePreviewProps {
  onBack?: () => void;
}

const VILLAGE_SOCIAL_PREVIEWS: readonly {
  title: string;
  status: string;
  Icon: LucideIcon;
}[] = [
  { title: '添加好友', status: '好友入口预告', Icon: UserPlus },
  { title: '消息中心', status: '私信与通知预告', Icon: MessageSquare },
  { title: '创建狼村', status: '社群创建预告', Icon: Home },
  { title: '加入狼村', status: '社群加入预告', Icon: DoorOpen },
] as const;

const WolfVillagePreview: React.FC<WolfVillagePreviewProps> = ({ onBack }) => (
  <main className="lobby-feature-page" aria-labelledby="wolf-village-title">
    <header className="lobby-feature-header">
      {onBack ? (
        <button className="lobby-feature-icon-button" type="button" onClick={onBack} aria-label="返回" title="返回">
          <ArrowLeft aria-hidden="true" />
        </button>
      ) : <span className="lobby-feature-header-spacer" />}
      <div>
        <h1 id="wolf-village-title">狼村</h1>
        <span className="lobby-feature-kicker">社交路线预告</span>
      </div>
      <Home className="lobby-feature-header-icon" aria-hidden="true" />
    </header>

    <div className="lobby-feature-status" role="status">
      <Bot aria-hidden="true" />
      <span>当前仅单人 AI 对局可用；以下为狼村社交预告</span>
    </div>

    <div className="lobby-feature-section-heading">
      <h2>社交功能预览</h2>
      <span>暂未接入服务</span>
    </div>
    <section className="lobby-village-social-grid" aria-label="狼村社交功能预览">
      {VILLAGE_SOCIAL_PREVIEWS.map(({ title, status, Icon }) => (
        <article className="lobby-feature-card lobby-village-social-preview" key={title}>
          <Icon aria-hidden="true" />
          <div><h3>{title}</h3><span>{status}</span></div>
          <button type="button" disabled><Lock aria-hidden="true" />预告</button>
        </article>
      ))}
    </section>

    <div className="lobby-feature-section-heading lobby-village-room-heading">
      <h2>真人多人房间</h2>
      <span>未来阶段</span>
    </div>

    <section className="lobby-village-room-actions" aria-label="多人房间操作">
      <button type="button" disabled title="多人房间未开放"><Home aria-hidden="true" />建房<span>未开放</span></button>
      <button type="button" disabled title="多人房间未开放"><Users aria-hidden="true" />跟房<span>未开放</span></button>
      <button type="button" disabled title="多人房间未开放"><Eye aria-hidden="true" />观战<span>未开放</span></button>
    </section>

    <div className="lobby-feature-status lobby-village-disabled-status" role="status">
      <Lock aria-hidden="true" />
      <span>本页面不创建房间、不连接真人对局</span>
    </div>
  </main>
);

export default WolfVillagePreview;

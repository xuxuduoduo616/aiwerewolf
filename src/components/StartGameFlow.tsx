import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Lock,
  Monitor,
  Play,
  Users,
} from 'lucide-react';
import { DIFFICULTY_CONFIGS, type Difficulty } from '../types';
import {
  mapGameSetupToConfig,
  type GameSetup,
  type LobbySubview,
} from '../lobbyFeatures';
import UnavailableNotice from './UnavailableNotice';

export type { GameSetup } from '../lobbyFeatures';

export type StartGameFlowStep =
  | 'mode-choice'
  | 'match-setup'
  | 'confirmation'
  | 'multiplayer-unavailable';

export const START_GAME_STEPS = [
  '开始游戏',
  '选择模式',
  '板型与难度',
  '最终确认',
] as const;

export const getPreviousStartGameStep = (
  step: StartGameFlowStep,
): StartGameFlowStep | 'home' => {
  if (step === 'confirmation') return 'match-setup';
  if (step === 'match-setup' || step === 'multiplayer-unavailable') return 'mode-choice';
  return 'home';
};

export const createSinglePlayerConfirmation = (
  onConfirm: (setup: GameSetup) => void,
): ((setup: unknown) => boolean) => {
  let confirmed = false;
  return setup => {
    if (confirmed || !mapGameSetupToConfig(setup)) return false;
    confirmed = true;
    onConfirm(setup as GameSetup);
    return true;
  };
};

interface StartGameFlowProps {
  initialStep?: StartGameFlowStep;
  initialSetup?: GameSetup;
  onSubviewChange?: (subview: LobbySubview) => void;
  onBackToLobby: () => void;
  onConfirm: (setup: GameSetup) => void;
}

const DEFAULT_SETUP: GameSetup = {
  mode: 'single',
  boardId: 'nine-player',
  difficulty: 'normal',
};

const BOARD_OPTIONS: readonly {
  id: GameSetup['boardId'];
  title: string;
  summary: string;
}[] = [
  { id: 'nine-player', title: '9人标准场', summary: '3民 / 3狼 / 预言家 / 女巫 / 猎人' },
  { id: 'twelve-player', title: '12人预女猎白', summary: '4民 / 4狼 / 预言家 / 女巫 / 猎人 / 白痴' },
] as const;

const DIFFICULTIES = Object.values(DIFFICULTY_CONFIGS) as readonly (typeof DIFFICULTY_CONFIGS)[Difficulty][];

const StartGameProgress: React.FC<{ step: StartGameFlowStep }> = ({ step }) => {
  const activeIndex = step === 'mode-choice' || step === 'multiplayer-unavailable'
    ? 1
    : step === 'match-setup' ? 2 : 3;
  return (
    <ol className="start-game-progress" aria-label="开始游戏进度">
      {START_GAME_STEPS.map((label, index) => (
        <li key={label} className={index <= activeIndex ? 'is-active' : ''} aria-current={index === activeIndex ? 'step' : undefined}>
          <span>{index + 1}</span>
          <small>{label}</small>
        </li>
      ))}
    </ol>
  );
};

const StartGameFlow: React.FC<StartGameFlowProps> = ({
  initialStep = 'mode-choice',
  initialSetup = DEFAULT_SETUP,
  onSubviewChange,
  onBackToLobby,
  onConfirm,
}) => {
  const [step, setStep] = useState<StartGameFlowStep>(initialStep);
  const [setup, setSetup] = useState<GameSetup>(initialSetup);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const confirmOnceRef = useRef<((candidate: unknown) => boolean) | null>(null);
  if (!confirmOnceRef.current) {
    confirmOnceRef.current = createSinglePlayerConfirmation(candidate => onConfirmRef.current(candidate));
  }

  const moveTo = (nextStep: StartGameFlowStep) => {
    setStep(nextStep);
    if (nextStep === 'mode-choice') onSubviewChange?.('mode-choice');
    if (nextStep === 'match-setup' || nextStep === 'confirmation') {
      onSubviewChange?.('match-setup');
    }
  };

  const goBack = () => {
    const previous = getPreviousStartGameStep(step);
    if (previous === 'home') {
      onBackToLobby();
      return;
    }
    moveTo(previous);
  };

  if (step === 'multiplayer-unavailable') {
    return (
      <div className="start-game-page">
        <StartGameProgress step={step} />
        <UnavailableNotice
          title="真人多人模式"
          description="多人房间属于 ADR-003 的后续路线。当前版本只启动本地单人 AI 对局，不会创建房间或连接真人服务。"
          onBack={goBack}
        />
      </div>
    );
  }

  return (
    <main className="start-game-page" aria-labelledby="start-game-title">
      <header className="app-page-header">
        <button className="app-page-back" type="button" onClick={goBack} aria-label="返回上一步">
          <ArrowLeft aria-hidden="true" />
          <span>返回</span>
        </button>
        <div>
          <p className="app-page-kicker">单人 AI 对局</p>
          <h1 id="start-game-title">开始游戏</h1>
        </div>
        <Play aria-hidden="true" />
      </header>

      <StartGameProgress step={step} />

      {step === 'mode-choice' && (
        <section className="start-game-panel" aria-labelledby="start-mode-title">
          <div className="app-section-heading">
            <div>
              <p className="app-page-kicker">第 2 步</p>
              <h2 id="start-mode-title">选择模式</h2>
            </div>
            <span>仅单人模式可启动</span>
          </div>
          <div className="start-mode-grid">
            <button
              className="start-mode-option is-enabled"
              type="button"
              onClick={() => {
                setSetup(DEFAULT_SETUP);
                moveTo('match-setup');
              }}
            >
              <Bot aria-hidden="true" />
              <strong>单人模式</strong>
              <span>与 AI 玩家完成完整对局</span>
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              className="start-mode-option"
              type="button"
              onClick={() => {
                setSetup(DEFAULT_SETUP);
                moveTo('multiplayer-unavailable');
              }}
              aria-label="真人多人模式，暂未开放"
            >
              <Users aria-hidden="true" />
              <strong>真人多人模式</strong>
              <span>路线预览 · 暂未开放</span>
              <Lock aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {step === 'match-setup' && (
        <section className="start-game-panel" aria-labelledby="match-setup-title">
          <div className="app-section-heading">
            <div>
              <p className="app-page-kicker">第 3 步</p>
              <h2 id="match-setup-title">选择板型与难度</h2>
            </div>
            <span>标准单人场</span>
          </div>

          <fieldset className="start-game-fieldset">
            <legend>板型</legend>
            <div className="start-board-grid">
              {BOARD_OPTIONS.map(board => (
                <label className={setup.boardId === board.id ? 'is-selected' : ''} key={board.id}>
                  <input
                    type="radio"
                    name="board"
                    value={board.id}
                    checked={setup.boardId === board.id}
                    onChange={() => setSetup(current => ({ ...current, boardId: board.id }))}
                  />
                  <Monitor aria-hidden="true" />
                  <strong>{board.title}</strong>
                  <span>{board.summary}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="start-game-fieldset">
            <legend>难度</legend>
            <div className="start-difficulty-grid">
              {DIFFICULTIES.map(difficulty => (
                <label className={setup.difficulty === difficulty.id ? 'is-selected' : ''} key={difficulty.id}>
                  <input
                    type="radio"
                    name="difficulty"
                    value={difficulty.id}
                    checked={setup.difficulty === difficulty.id}
                    onChange={() => setSetup(current => ({ ...current, difficulty: difficulty.id }))}
                  />
                  <strong>{difficulty.label}</strong>
                  <span>{difficulty.description}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <section className="start-unavailable-routes" aria-label="其他匹配方式">
            <button type="button" disabled><Lock aria-hidden="true" />多选匹配 · 未开放</button>
            <button type="button" disabled><Lock aria-hidden="true" />12人觉醒摄梦人 · 限时板未开放</button>
            <button type="button" disabled><Lock aria-hidden="true" />9人血月猎魔人 · 限时板未开放</button>
          </section>

          <button className="app-primary-button" type="button" onClick={() => moveTo('confirmation')}>
            检查配置
            <ChevronRight aria-hidden="true" />
          </button>
        </section>
      )}

      {step === 'confirmation' && (
        <section className="start-game-panel start-confirmation" aria-labelledby="start-confirm-title">
          <div className="app-section-heading">
            <div>
              <p className="app-page-kicker">第 4 步</p>
              <h2 id="start-confirm-title">最终确认</h2>
            </div>
            <Check aria-hidden="true" />
          </div>
          <dl>
            <div><dt>模式</dt><dd>单人 AI 对局</dd></div>
            <div><dt>板型</dt><dd>{BOARD_OPTIONS.find(board => board.id === setup.boardId)?.title}</dd></div>
            <div><dt>难度</dt><dd>{DIFFICULTY_CONFIGS[setup.difficulty].label}</dd></div>
          </dl>
          <p role="status">确认后才会创建本地对局。重复点击只会启动一次。</p>
          <button
            className="app-primary-button"
            type="button"
            onClick={event => {
              const accepted = confirmOnceRef.current?.(setup) ?? false;
              if (accepted) event.currentTarget.disabled = true;
            }}
          >
            <Play aria-hidden="true" />
            确认并开始
          </button>
        </section>
      )}
    </main>
  );
};

export default StartGameFlow;

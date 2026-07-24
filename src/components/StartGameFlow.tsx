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
  'Start',
  'Choose Mode',
  'Board and Difficulty',
  'Confirm',
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
  { id: 'nine-player', title: '9-Player Standard', summary: '3 Villagers / 3 Werewolves / Seer / Witch / Hunter' },
  { id: 'twelve-player', title: '12-Player Standard', summary: '4 Villagers / 4 Werewolves / Seer / Witch / Hunter / Idiot' },
] as const;

const DIFFICULTIES = Object.values(DIFFICULTY_CONFIGS) as readonly (typeof DIFFICULTY_CONFIGS)[Difficulty][];

const StartGameProgress: React.FC<{ step: StartGameFlowStep }> = ({ step }) => {
  const activeIndex = step === 'mode-choice' || step === 'multiplayer-unavailable'
    ? 1
    : step === 'match-setup' ? 2 : 3;
  return (
    <ol className="start-game-progress" aria-label="Start game progress">
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
          title="Live Multiplayer"
          description="Multiplayer rooms belong to a later stage of ADR-003. This version starts only local single-player AI matches and does not create rooms or connect to live player services."
          onBack={goBack}
        />
      </div>
    );
  }

  return (
    <main className="start-game-page" aria-labelledby="start-game-title">
      <header className="app-page-header">
        <button className="app-page-back" type="button" onClick={goBack} aria-label="Go back one step">
          <ArrowLeft aria-hidden="true" />
          <span>Back</span>
        </button>
        <div>
          <p className="app-page-kicker">Single-Player AI Match</p>
          <h1 id="start-game-title">Start Game</h1>
        </div>
        <Play aria-hidden="true" />
      </header>

      <StartGameProgress step={step} />

      {step === 'mode-choice' && (
        <section className="start-game-panel" aria-labelledby="start-mode-title">
          <div className="app-section-heading">
            <div>
              <p className="app-page-kicker">Step 2</p>
              <h2 id="start-mode-title">Choose Mode</h2>
            </div>
            <span>Only single-player can start</span>
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
              <strong>Single-Player</strong>
              <span>Play a complete match with AI players</span>
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              className="start-mode-option"
              type="button"
              onClick={() => {
                setSetup(DEFAULT_SETUP);
                moveTo('multiplayer-unavailable');
              }}
              aria-label="Live multiplayer, currently unavailable"
            >
              <Users aria-hidden="true" />
              <strong>Live Multiplayer</strong>
              <span>Roadmap preview · Unavailable</span>
              <Lock aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {step === 'match-setup' && (
        <section className="start-game-panel" aria-labelledby="match-setup-title">
          <div className="app-section-heading">
            <div>
              <p className="app-page-kicker">Step 3</p>
              <h2 id="match-setup-title">Choose Board and Difficulty</h2>
            </div>
            <span>Standard single-player match</span>
          </div>

          <fieldset className="start-game-fieldset">
            <legend>Board</legend>
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
            <legend>Difficulty</legend>
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
                  <strong>{difficulty.labelEn}</strong>
                  <span>{difficulty.descriptionEn}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <section className="start-unavailable-routes" aria-label="Other matchmaking options">
            <button type="button" disabled><Lock aria-hidden="true" />Multi-Board Match · Unavailable</button>
            <button type="button" disabled><Lock aria-hidden="true" />12-Player Awakened Dreamweaver · Limited board unavailable</button>
            <button type="button" disabled><Lock aria-hidden="true" />9-Player Blood Moon Demon Hunter · Limited board unavailable</button>
          </section>

          <button className="app-primary-button" type="button" onClick={() => moveTo('confirmation')}>
            Review Setup
            <ChevronRight aria-hidden="true" />
          </button>
        </section>
      )}

      {step === 'confirmation' && (
        <section className="start-game-panel start-confirmation" aria-labelledby="start-confirm-title">
          <div className="app-section-heading">
            <div>
              <p className="app-page-kicker">Step 4</p>
              <h2 id="start-confirm-title">Final Confirmation</h2>
            </div>
            <Check aria-hidden="true" />
          </div>
          <dl>
            <div><dt>Mode</dt><dd>Single-Player AI Match</dd></div>
            <div><dt>Board</dt><dd>{BOARD_OPTIONS.find(board => board.id === setup.boardId)?.title}</dd></div>
            <div><dt>Difficulty</dt><dd>{DIFFICULTY_CONFIGS[setup.difficulty].labelEn}</dd></div>
          </dl>
          <p role="status">The local match is created only after confirmation. Repeated clicks still start it once.</p>
          <button
            className="app-primary-button"
            type="button"
            onClick={event => {
              const accepted = confirmOnceRef.current?.(setup) ?? false;
              if (accepted) event.currentTarget.disabled = true;
            }}
          >
            <Play aria-hidden="true" />
            Confirm and Start
          </button>
        </section>
      )}
    </main>
  );
};

export default StartGameFlow;

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Lock,
  Monitor,
  Play,
  Users,
} from 'lucide-react';
import { DIFFICULTY_CONFIGS, type Difficulty } from '../types';
import {
  DEFAULT_EXPRESSION_MODEL,
  MIXED_POOL_MODEL_IDS,
  getExpressionModel,
  getAvailableExpressionModels,
  getRecommendedExpressionModel,
  type AIExpressionModel,
  type AIExpressionModelId,
} from '../ai/modelCatalog';
import { fetchAvailableExpressionModels } from '../ai/providerCapabilities';
import {
  mapGameSetupToConfig,
  type GameSetup,
  type LobbySubview,
} from '../lobbyFeatures';
import AccessibleDialog from './AccessibleDialog';
import UnavailableNotice from './UnavailableNotice';

export type { GameSetup } from '../lobbyFeatures';

export type StartGameFlowStep =
  | 'mode-choice'
  | 'match-setup'
  | 'multiplayer-unavailable';

export const START_GAME_STEPS = [
  'Choose Mode',
  'Board, Difficulty, and Model',
] as const;

export const getPreviousStartGameStep = (
  step: StartGameFlowStep,
): StartGameFlowStep | 'home' => {
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
  onConfirm: (setup: GameSetup, models?: readonly AIExpressionModel[]) => void;
}

const DEFAULT_SETUP: GameSetup = {
  mode: 'single',
  boardId: 'nine-player',
  difficulty: 'normal',
  expressionModel: DEFAULT_EXPRESSION_MODEL,
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

interface ExpressionModelSelectorProps {
  models: readonly AIExpressionModel[];
  selectedModel: AIExpressionModelId;
  onSelect: (model: AIExpressionModelId) => void;
}

export const ExpressionModelSelector: React.FC<ExpressionModelSelectorProps> = ({
  models,
  selectedModel,
  onSelect,
}) => {
  const renderChoice = (model: AIExpressionModel) => (
    <label className={selectedModel === model.id ? 'is-selected' : ''} key={model.id}>
      <input type="radio" name="expression-model" value={model.id} checked={selectedModel === model.id} onChange={() => onSelect(model.id)} />
      <strong>{model.label}</strong><span>{model.description}</span>
    </label>
  );
  const singleModels = models.filter(model => model.id !== 'multi-ai-model' && model.id !== DEFAULT_EXPRESSION_MODEL);
  return <fieldset className="start-game-fieldset">
    <legend>Dialogue Model</legend>
    <div className="start-model-grid">{models.filter(model => model.id === 'multi-ai-model' || model.id === DEFAULT_EXPRESSION_MODEL).map(renderChoice)}</div>
    {singleModels.length > 0 && <details className="start-single-models">
      <summary>Single-model options</summary>
      <div className="start-model-grid">{singleModels.map(renderChoice)}</div>
    </details>}
  </fieldset>;
};

const StartGameProgress: React.FC<{ step: StartGameFlowStep }> = ({ step }) => {
  const activeIndex = step === 'mode-choice' || step === 'multiplayer-unavailable'
    ? 0 : 1;
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
  const [isStarting, setIsStarting] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const modelsButtonRef = useRef<HTMLButtonElement>(null);
  const [setup, setSetup] = useState<GameSetup>(() => (
    initialSetup.expressionModel === DEFAULT_EXPRESSION_MODEL
      ? initialSetup
      : { ...initialSetup, expressionModel: DEFAULT_EXPRESSION_MODEL }
  ));
  const [availableExpressionModels, setAvailableExpressionModels] = useState<readonly AIExpressionModel[]>(
    getAvailableExpressionModels(null),
  );
  const modelsRef = useRef(availableExpressionModels);
  modelsRef.current = availableExpressionModels;
  const startingRef = useRef(false);
  const onConfirmRef = useRef(onConfirm);
  const modelWasSelected = useRef(false);
  onConfirmRef.current = onConfirm;
  const confirmOnceRef = useRef<((candidate: unknown) => boolean) | null>(null);
  if (!confirmOnceRef.current) {
    confirmOnceRef.current = createSinglePlayerConfirmation(candidate => onConfirmRef.current(candidate, modelsRef.current));
  }

  useEffect(() => {
    let active = true;
    void fetchAvailableExpressionModels().then(models => {
      if (!active || startingRef.current) return;
      setAvailableExpressionModels(models);
      setSetup(current => (
        modelWasSelected.current
          ? current
          : { ...current, expressionModel: getRecommendedExpressionModel(models) }
      ));
    });
    return () => {
      active = false;
    };
  }, []);

  const moveTo = (nextStep: StartGameFlowStep) => {
    setStep(nextStep);
    if (nextStep === 'mode-choice') onSubviewChange?.('mode-choice');
    if (nextStep === 'match-setup') {
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
              <p className="app-page-kicker">Step 1</p>
              <h2 id="start-mode-title">Choose Mode</h2>
            </div>
            <span>Only single-player can start</span>
          </div>
          <div className="start-mode-grid">
            <button
              className="start-mode-option is-enabled"
              data-tour-target="single-player"
              type="button"
              onClick={() => {
                modelWasSelected.current = false;
                setSetup({ ...DEFAULT_SETUP, expressionModel: getRecommendedExpressionModel(availableExpressionModels) });
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
        <section className="start-game-panel" aria-labelledby="match-setup-title" data-tour-target="match-setup">
          <div className="app-section-heading">
            <div>
              <p className="app-page-kicker">Step 2</p>
              <h2 id="match-setup-title">Choose Board, Difficulty, and Dialogue Model</h2>
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

          <ExpressionModelSelector
            models={availableExpressionModels}
            selectedModel={setup.expressionModel}
            onSelect={expressionModel => {
              modelWasSelected.current = true;
              setSetup(current => ({ ...current, expressionModel }));
            }}
          />
          <button ref={modelsButtonRef} className="start-model-details" type="button" onClick={() => setShowModels(true)}>
            View participating AI models
          </button>
          <p className="start-model-status" role="status">
            Models affect dialogue only. DeepSeek reasoning: Beginner · low, Intermediate · high, Expert · max.
            {' '}{setup.expressionModel === 'multi-ai-model'
              ? 'If no verified model gives a usable reply, that turn is skipped.'
              : 'This single-model option uses local dialogue if the model cannot respond.'}
          </p>
          <AccessibleDialog open={showModels} onClose={() => setShowModels(false)} title="Participating AI models"
            description="Each AI seat starts with a preferred model. If a reply fails, another verified model can take over. The seat shows the model that produced the accepted reply."
            closeLabel="Close participating AI models" returnFocusRef={modelsButtonRef}>
            <ul className="participating-model-list">
              {MIXED_POOL_MODEL_IDS.map(id => <li key={id}>
                <strong>{getExpressionModel(id).label}</strong>
                <span>{availableExpressionModels.some(model => model.id === id && model.available) ? 'Available' : 'Unavailable'}</span>
              </li>)}
            </ul>
            <p>Gemini 2.5 Flash can take over when verified and is also the default single-model option. If no verified model gives a usable reply, that turn is skipped.</p>
          </AccessibleDialog>

          <section className="start-unavailable-routes" aria-label="Other matchmaking options">
            <button type="button" disabled><Lock aria-hidden="true" />Multi-Board Match · Unavailable</button>
            <button type="button" disabled><Lock aria-hidden="true" />12-Player Awakened Dreamweaver · Limited board unavailable</button>
            <button type="button" disabled><Lock aria-hidden="true" />9-Player Blood Moon Demon Hunter · Limited board unavailable</button>
          </section>

          <button
            className="app-primary-button"
            type="button"
            disabled={isStarting}
            onClick={event => {
              startingRef.current = true;
              const accepted = confirmOnceRef.current?.(setup) ?? false;
              if (!accepted) startingRef.current = false;
              if (accepted) {
                event.currentTarget.disabled = true;
                setIsStarting(true);
              }
            }}
          >
            <Play aria-hidden="true" />
            {isStarting ? 'Starting game…' : 'Start Game'}
          </button>
        </section>
      )}
    </main>
  );
};

export default StartGameFlow;

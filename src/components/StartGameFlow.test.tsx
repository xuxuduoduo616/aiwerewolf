import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GAME_MODES } from '../constants';
import {
  AI_EXPRESSION_MODEL_IDS,
  AI_EXPRESSION_MODELS,
  DEFAULT_EXPRESSION_MODEL,
  getAvailableExpressionModels,
} from '../ai/modelCatalog';
import { mapGameSetupToConfig, type GameSetup } from '../lobbyFeatures';
import StartGameFlow, {
  ExpressionModelSelector,
  START_GAME_STEPS,
  createSinglePlayerConfirmation,
  getPreviousStartGameStep,
} from './StartGameFlow';

describe('single-player setup mapping', () => {
  it.each([
    ['nine-player', 'easy', '9-standard'],
    ['nine-player', 'normal', '9-standard'],
    ['nine-player', 'hard', '9-standard'],
    ['twelve-player', 'easy', '12-standard'],
    ['twelve-player', 'normal', '12-standard'],
    ['twelve-player', 'hard', '12-standard'],
  ] as const)('maps %s / %s to %s', (boardId, difficulty, expectedConfigId) => {
    const setup: GameSetup = {
      mode: 'single',
      boardId,
      difficulty,
      expressionModel: DEFAULT_EXPRESSION_MODEL,
    };
    const config = mapGameSetupToConfig(setup);
    expect(config?.id).toBe(expectedConfigId);
    expect(config).toBe(GAME_MODES.find(mode => mode.id === expectedConfigId));
    expect(setup.difficulty).toBe(difficulty);
  });

  it.each([
    null,
    { mode: 'multiplayer', boardId: 'nine-player', difficulty: 'normal' },
    { mode: 'single', boardId: 'limited-board', difficulty: 'normal' },
    { mode: 'single', boardId: 'nine-player', difficulty: 'impossible' },
    { mode: 'single', boardId: 'nine-player', difficulty: 'normal' },
    { mode: 'single', boardId: 'nine-player', difficulty: 'normal', expressionModel: 'invented-model' },
  ])('rejects invalid or unsupported setup %#', setup => {
    expect(mapGameSetupToConfig(setup)).toBeNull();
  });

  it.each(AI_EXPRESSION_MODEL_IDS)('accepts the exact expression model ID %s', expressionModel => {
    expect(mapGameSetupToConfig({
      mode: 'single',
      boardId: 'nine-player',
      difficulty: 'normal',
      expressionModel,
    })?.id).toBe('9-standard');
  });
});

describe('guarded confirmation', () => {
  it('calls final confirmation exactly once under rapid repeat activation', () => {
    const onConfirm = vi.fn();
    const confirm = createSinglePlayerConfirmation(onConfirm);
    const setup: GameSetup = {
      mode: 'single',
      boardId: 'twelve-player',
      difficulty: 'hard',
      expressionModel: 'gpt-5.6-luna',
    };

    expect(confirm(setup)).toBe(true);
    expect(confirm(setup)).toBe(false);
    expect(confirm(setup)).toBe(false);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(setup);
  });

  it('does not lock or invoke the callback for an invalid route', () => {
    const onConfirm = vi.fn();
    const confirm = createSinglePlayerConfirmation(onConfirm);
    expect(confirm({ mode: 'multiplayer' })).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();

    const valid: GameSetup = {
      mode: 'single',
      boardId: 'nine-player',
      difficulty: 'easy',
      expressionModel: DEFAULT_EXPRESSION_MODEL,
    };
    expect(confirm(valid)).toBe(true);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('StartGameFlow surfaces and navigation', () => {
  const callbacks = {
    onBackToLobby: () => undefined,
    onConfirm: () => undefined,
  };

  it('renders the visible four-step sequence and mode choice', () => {
    const html = renderToStaticMarkup(<StartGameFlow {...callbacks} />);
    for (const label of START_GAME_STEPS) expect(html).toContain(label);
    expect(html).toContain('Single-Player');
    expect(html).toContain('Live Multiplayer');
    expect(html).toContain('Roadmap preview · Unavailable');
  });

  it('renders both supported boards, every difficulty, and native-disabled routes', () => {
    const html = renderToStaticMarkup(<StartGameFlow {...callbacks} initialStep="match-setup" />);
    for (const label of ['9-Player Standard', '12-Player Standard', 'Beginner', 'Intermediate', 'Expert']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Multi-Board Match · Unavailable');
    expect(html).toContain('Limited board unavailable');
    expect(html).toContain('Gemini 2.5 Flash');
    expect(html).not.toContain('GPT-5.5');
    expect(html).not.toContain('GPT-5.6 Luna');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });

  it('renders final confirmation only with the selected setup', () => {
    const html = renderToStaticMarkup(
      <StartGameFlow
        {...callbacks}
        initialStep="confirmation"
        initialSetup={{
          mode: 'single',
          boardId: 'twelve-player',
          difficulty: 'hard',
          expressionModel: DEFAULT_EXPRESSION_MODEL,
        }}
      />,
    );
    expect(html).toContain('Final Confirmation');
    expect(html).toContain('12-Player Standard');
    expect(html).toContain('Expert');
    expect(html).toContain('Gemini 2.5 Flash');
    expect(html).toContain('Confirm and Start');
  });

  it('renders multiplayer as an unavailable preview without a start control', () => {
    const html = renderToStaticMarkup(
      <StartGameFlow {...callbacks} initialStep="multiplayer-unavailable" />,
    );
    expect(html).toContain('Live Multiplayer');
    expect(html).toContain('does not create rooms or connect to live player services');
    expect(html).not.toContain('Confirm and Start');
  });

  it('defines deterministic back navigation at every flow step', () => {
    expect(getPreviousStartGameStep('mode-choice')).toBe('home');
    expect(getPreviousStartGameStep('match-setup')).toBe('mode-choice');
    expect(getPreviousStartGameStep('confirmation')).toBe('match-setup');
    expect(getPreviousStartGameStep('multiplayer-unavailable')).toBe('mode-choice');
  });
});

describe('expression model capability gating', () => {
  const fullCapabilities = {
    default_model: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    ],
  };

  it('exposes both optional OpenAI choices only when both exact IDs are verified', () => {
    expect(getAvailableExpressionModels(fullCapabilities).map(model => model.id)).toEqual([
      'gemini-2.5-flash',
      'gpt-5.5',
      'gpt-5.6-luna',
    ]);

    for (const capabilities of [
      null,
      {},
      { ...fullCapabilities, models: fullCapabilities.models.slice(0, 2) },
      { ...fullCapabilities, models: fullCapabilities.models.slice(1) },
      { ...fullCapabilities, default_model: 'gpt-5.5' },
      { ...fullCapabilities, models: [{ id: 'gpt-5.5', label: 42 }] },
    ]) {
      expect(getAvailableExpressionModels(capabilities).map(model => model.id)).toEqual([
        DEFAULT_EXPRESSION_MODEL,
      ]);
    }
  });

  it('renders both GPT choices together and preserves an explicit selection', () => {
    const html = renderToStaticMarkup(
      <ExpressionModelSelector
        models={AI_EXPRESSION_MODELS}
        selectedModel="gpt-5.5"
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain('GPT-5.5');
    expect(html).toContain('GPT-5.6 Luna');
    expect(html).toMatch(/<input[^>]+checked=""[^>]+value="gpt-5\.5"/);
  });
});

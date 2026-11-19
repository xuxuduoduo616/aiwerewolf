import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GAME_MODES } from '../constants';
import {
  AI_EXPRESSION_MODEL_IDS,
  AI_EXPRESSION_MODELS,
  DEFAULT_EXPRESSION_MODEL,
  getAvailableExpressionModels,
  getRecommendedExpressionModel,
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
      expressionModel: 'gemini-3.6-flash',
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

  it('renders only the two real setup steps and mode choice', () => {
    const html = renderToStaticMarkup(<StartGameFlow {...callbacks} />);
    for (const label of START_GAME_STEPS) expect(html).toContain(label);
    expect(START_GAME_STEPS).toHaveLength(2);
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
    expect(html).not.toContain('Optional OpenAI models');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });

  it('offers direct start beside the selected setup without a review step', () => {
    const html = renderToStaticMarkup(
      <StartGameFlow
        {...callbacks}
        initialStep="match-setup"
        initialSetup={{
          mode: 'single',
          boardId: 'twelve-player',
          difficulty: 'hard',
          expressionModel: DEFAULT_EXPRESSION_MODEL,
        }}
      />,
    );
    expect(html).not.toContain('Final Confirmation');
    expect(html).toContain('12-Player Standard');
    expect(html).toContain('Expert');
    expect(html).toContain('Gemini 2.5 Flash');
    expect(html).toMatch(/class="app-primary-button" type="button"[^>]*>.*Start Game<\/button>/);
    expect(html).not.toContain('Review Setup');
    expect(html).not.toContain('<dl>');
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
    expect(getPreviousStartGameStep('multiplayer-unavailable')).toBe('mode-choice');
  });
});

describe('expression model capability gating', () => {
  const deepseekCapabilities = {
    default_model: 'deepseek-auto',
    models: [
      { id: 'deepseek-auto', label: 'Automatic' },
      { id: 'deepseek-flash', label: 'Flash' },
      { id: 'deepseek-v4-pro', label: 'Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini' },
    ],
  };
  it('recommends Multi AI Model with the verified DeepSeek subset', () => {
    const models = getAvailableExpressionModels(deepseekCapabilities);
    expect(models.map(model => model.id)).toEqual(['multi-ai-model', 'deepseek-auto', 'deepseek-flash', 'deepseek-v4-pro', 'gemini-2.5-flash']);
    expect(getRecommendedExpressionModel(models)).toBe('multi-ai-model');
    const html = renderToStaticMarkup(<ExpressionModelSelector models={models} selectedModel="multi-ai-model" onSelect={() => undefined} />);
    expect(html).toContain('Multi AI Model');
    expect(html).toContain('Single-model options');
    expect(html).toContain('DeepSeek V4.1 Flash');
    expect(html).toContain('DeepSeek V4 Pro');
  });
  it('fails closed for duplicate, unknown, invalid and inconsistent capability envelopes', () => {
    for (const capabilities of [
      null, {},
      { ...deepseekCapabilities, models: deepseekCapabilities.models.slice(1) },
      { ...deepseekCapabilities, models: [...deepseekCapabilities.models, deepseekCapabilities.models[0]] },
      { ...deepseekCapabilities, models: [...deepseekCapabilities.models, { id: 'deepseek-v4.1-flash', label: 'Wrong API ID' }] },
      { ...deepseekCapabilities, verified_models: 'malformed' },
      { ...deepseekCapabilities, verified_models: ['unimplemented-model'] },
    ]) {
      const models = getAvailableExpressionModels(capabilities);
      expect(models.map(model => model.id)).toEqual(['multi-ai-model', DEFAULT_EXPRESSION_MODEL]);
      expect(models.every(model => model.available === false)).toBe(true);
    }
  });
  it('accepts a single verified participating model and keeps backup availability truthful', () => {
    const models = getAvailableExpressionModels({ default_model: 'deepseek-flash', models: [{ id: 'deepseek-flash', label: 'Flash' }, { id: DEFAULT_EXPRESSION_MODEL, label: 'Backup' }], verified_models: ['deepseek-flash'] });
    expect(models.filter(model => model.available).map(model => model.id)).toEqual(['multi-ai-model', 'deepseek-flash']);
    expect(getRecommendedExpressionModel(models)).toBe('multi-ai-model');
  });

  it('renders both Gemini choices together and preserves an explicit selection', () => {
    const html = renderToStaticMarkup(
      <ExpressionModelSelector
        models={AI_EXPRESSION_MODELS}
        selectedModel="gemini-3.6-flash"
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain('Gemini 3.6 Flash');
    expect(html).toContain('Gemini 2.5 Flash');
    expect(html).toMatch(/<input[^>]+checked=""[^>]+value="gemini-3\.6-flash"/);
  });
});

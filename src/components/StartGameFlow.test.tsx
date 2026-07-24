import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GAME_MODES } from '../constants';
import { mapGameSetupToConfig, type GameSetup } from '../lobbyFeatures';
import StartGameFlow, {
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
    const setup: GameSetup = { mode: 'single', boardId, difficulty };
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
  ])('rejects invalid or unsupported setup %#', setup => {
    expect(mapGameSetupToConfig(setup)).toBeNull();
  });
});

describe('guarded confirmation', () => {
  it('calls final confirmation exactly once under rapid repeat activation', () => {
    const onConfirm = vi.fn();
    const confirm = createSinglePlayerConfirmation(onConfirm);
    const setup: GameSetup = { mode: 'single', boardId: 'twelve-player', difficulty: 'hard' };

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

    const valid: GameSetup = { mode: 'single', boardId: 'nine-player', difficulty: 'easy' };
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
    expect(html).toContain('单人模式');
    expect(html).toContain('真人多人模式');
    expect(html).toContain('路线预览 · 暂未开放');
  });

  it('renders both supported boards, every difficulty, and native-disabled routes', () => {
    const html = renderToStaticMarkup(<StartGameFlow {...callbacks} initialStep="match-setup" />);
    for (const label of ['9人标准场', '12人预女猎白', '新手', '进阶', '高手']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('多选匹配 · 未开放');
    expect(html).toContain('限时板未开放');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });

  it('renders final confirmation only with the selected setup', () => {
    const html = renderToStaticMarkup(
      <StartGameFlow
        {...callbacks}
        initialStep="confirmation"
        initialSetup={{ mode: 'single', boardId: 'twelve-player', difficulty: 'hard' }}
      />,
    );
    expect(html).toContain('最终确认');
    expect(html).toContain('12人预女猎白');
    expect(html).toContain('高手');
    expect(html).toContain('确认并开始');
  });

  it('renders multiplayer as an unavailable preview without a start control', () => {
    const html = renderToStaticMarkup(
      <StartGameFlow {...callbacks} initialStep="multiplayer-unavailable" />,
    );
    expect(html).toContain('真人多人模式');
    expect(html).toContain('不会创建房间或连接真人服务');
    expect(html).not.toContain('确认并开始');
  });

  it('defines deterministic back navigation at every flow step', () => {
    expect(getPreviousStartGameStep('mode-choice')).toBe('home');
    expect(getPreviousStartGameStep('match-setup')).toBe('mode-choice');
    expect(getPreviousStartGameStep('confirmation')).toBe('match-setup');
    expect(getPreviousStartGameStep('multiplayer-unavailable')).toBe('mode-choice');
  });
});

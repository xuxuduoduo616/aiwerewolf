import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import LobbyBgmPlayer from './LobbyBgmPlayer';
import RefinedLobby from './RefinedLobby';
import { ONBOARDING_STEPS } from './OnboardingSpotlight';
import {
  LOBBY_BGM_TRACKS,
  nextTrackIndex,
  normalizeTrackIndex,
  prevTrackIndex,
} from '../services/lobbyBgmTracks';
import { GAME_BGM_SOURCES, resolveMatchBgmMovement } from '../hooks/useGameBgm';
import { GamePhase } from '../types';
import * as speechAudio from '../services/speechAudio';

describe('LobbyBgmPlayer, draggable capsule & adaptive match soundtrack', () => {
  it('registers Red Dust Inn as initial track and wraps playlist indices cleanly', () => {
    expect(LOBBY_BGM_TRACKS.length).toBeGreaterThanOrEqual(1);
    expect(LOBBY_BGM_TRACKS[0]).toMatchObject({
      id: 'red-dust-inn',
      title: 'Red Dust Inn',
      src: '/assets/bgm/hongchen-kezhan.mp3',
    });

    expect(nextTrackIndex(0, 1)).toBe(0);
    expect(prevTrackIndex(0, 1)).toBe(0);
    expect(nextTrackIndex(0, 4)).toBe(1);
    expect(nextTrackIndex(3, 4)).toBe(0);
    expect(prevTrackIndex(0, 4)).toBe(3);
    expect(normalizeTrackIndex(-1, 3)).toBe(2);
  });

  it('renders exact "BGM" label (without "Jianghu"), draggable grip, and transport controls', () => {
    const controller = {
      track: LOBBY_BGM_TRACKS[0],
      trackIndex: 0,
      trackCount: 1,
      enabled: true,
      isPlaying: true,
      toggle: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
    };
    const playingHtml = renderToStaticMarkup(<LobbyBgmPlayer bgm={controller} />);
    expect(playingHtml).toContain('data-tour-target="bgm-player"');
    expect(playingHtml).toContain('data-bgm-draggable="true"');
    expect(playingHtml).toContain('data-bgm-playing="true"');
    expect(playingHtml).toContain('<span class="night-bgm-eyebrow">BGM</span>');
    expect(playingHtml).not.toContain('Jianghu BGM');
    expect(playingHtml).toContain('Red Dust Inn');
    expect(playingHtml).toContain('aria-label="Previous track"');
    expect(playingHtml).toContain('aria-label="Pause background music"');
    expect(playingHtml).toContain('aria-pressed="true"');
    expect(playingHtml).toContain('aria-label="Next track"');
    expect(playingHtml).not.toMatch(/[\p{Script=Han}]/u);

    const pausedHtml = renderToStaticMarkup(<LobbyBgmPlayer bgm={{ ...controller, isPlaying: false }} />);
    expect(pausedHtml).toContain('data-bgm-playing="false"');
    expect(pausedHtml).toContain('aria-label="Play background music"');
    expect(pausedHtml).toContain('aria-pressed="false"');
  });

  it('stacks guest sign-in CTA inside identity block and points Step 2 tour to bgm-player', () => {
    const noop = () => undefined;
    const html = renderToStaticMarkup(
      <RefinedLobby
        onStartGame={noop}
        onOpenTutorial={noop}
        identityName="Guest 9b44d2d5"
        identityHandle="guest:9b44d2d5"
        isGuest
        onSignIn={noop}
      />,
    );
    expect(html).toContain('class="night-lobby-header"');
    expect(html).toContain('class="night-text-button night-signin-cta"');
    expect(html).toContain('data-tour-target="bgm-player"');

    expect(ONBOARDING_STEPS[1].selector).toBe('[data-tour-target="bgm-player"]');
    expect(ONBOARDING_STEPS[1].title).toBe('Background Music');
  });

  it('maps game phases to distinct Night, Day, Exile Vote, and Epilogue Jianghu movements', () => {
    expect(resolveMatchBgmMovement(GamePhase.LOBBY)).toBeNull();
    expect(resolveMatchBgmMovement(GamePhase.NIGHT_START)).toBe('night');
    expect(resolveMatchBgmMovement(GamePhase.NIGHT_WEREWOLVES)).toBe('night');
    expect(resolveMatchBgmMovement(GamePhase.NIGHT_SEER)).toBe('night');
    expect(resolveMatchBgmMovement(GamePhase.NIGHT_WITCH)).toBe('night');
    expect(resolveMatchBgmMovement(GamePhase.DAY_ANNOUNCE)).toBe('day');
    expect(resolveMatchBgmMovement(GamePhase.DAY_DISCUSSION)).toBe('day');
    expect(resolveMatchBgmMovement(GamePhase.DAY_VOTING)).toBe('vote');
    expect(resolveMatchBgmMovement(GamePhase.DAY_HUNTER_CHECK)).toBe('vote');
    expect(resolveMatchBgmMovement(GamePhase.DAY_HUNTER_SHOT)).toBe('vote');
    expect(resolveMatchBgmMovement(GamePhase.GAME_OVER)).toBe('epilogue');

    expect(GAME_BGM_SOURCES.night).toBe('/assets/bgm/game-night-bgm.mp3');
    expect(GAME_BGM_SOURCES.day).toBe('/assets/bgm/game-day-bgm.mp3');
    expect(GAME_BGM_SOURCES.vote).toBe('/assets/bgm/game-vote-bgm.mp3');
    expect(GAME_BGM_SOURCES.epilogue).toBe('/assets/bgm/hongchen-kezhan.mp3');
  });

  it('broadcasts real-time speech activity events so match BGM ducks and shifts timbre during AI speech', async () => {
    speechAudio.__test.resetAll();
    const events: boolean[] = [];
    const unsubscribe = speechAudio.subscribeSpeechActivity(active => events.push(active));

    let capturedUtterance: speechAudio.UtteranceLike | null = null;
    class FakeUtterance implements speechAudio.UtteranceLike {
      text: string;
      lang = 'en-US';
      volume = 1;
      rate = 1;
      voice: speechAudio.VoiceLike | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
        capturedUtterance = this;
      }
    }

    speechAudio.__test.inject(
      {
        speak: () => undefined,
        cancel: () => undefined,
        getVoices: () => [{ name: 'Samantha', lang: 'en-US', voiceURI: 'samantha', default: true }],
      },
      FakeUtterance,
    );
    speechAudio.setEnabled(true);

    const pending = speechAudio.enqueue('Player four hesitated before voting.', 'en-US', 2, 'log-duck-1');
    expect(speechAudio.isAudiblySpeaking()).toBe(true);
    expect(events).toEqual([true]);

    capturedUtterance!.onend?.();
    await pending;
    expect(speechAudio.isAudiblySpeaking()).toBe(false);
    expect(events).toEqual([true, false]);

    unsubscribe();
    speechAudio.__test.resetAll();
  });
});

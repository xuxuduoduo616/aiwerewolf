import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  advanceToHumanSpeech,
  enterGuestLobby,
  leaveGameToLobby,
  startNinePlayerGame,
  watchProviderRequests,
} from './helpers/game';

/**
 * V-C: Chromium fake-media smoke test for the click-to-toggle voice input.
 *
 * What this spec proves:
 * - the microphone button only exists on the human's own day-discussion turn;
 * - first click → `recording` (`aria-pressed="true"`, dimmed), second click →
 *   `transcribing` and then back to `idle`;
 * - the recording is POSTed exactly once to the same-origin
 *   `/.netlify/functions/asr-transcribe` endpoint, which is mocked with
 *   `page.route` (fixed text) so no real `QWEN_API_KEY` or upstream ASR is
 *   involved;
 * - no request leaves the dev-server origin to reach an ASR/provider host, no
 *   `provider-adapter` / `bailian-tts` Function is called, and the input is
 *   only written from the mocked response (never asserted as real speech).
 *
 * The fake device emits a synthetic tone, so the recognized text would be
 * meaningless: this spec never asserts real recognition content.
 *
 * Pre-existing third-party assets: `index.html` loads Google Fonts, the login
 * page loads the Cloudflare Turnstile script, and player seats load DiceBear
 * avatars. Those are application assets unrelated to voice. The catch-all
 * route below aborts every non-local request before any network I/O, so no
 * third-party host ever receives or answers a request; the audit then proves
 * that the voice flow itself adds none of them, that no external request
 * carries a POST body (audio is uploaded as a POST body), and that the only
 * allowed request body destination is the mocked same-origin ASR endpoint.
 */

const ASR_PATH = '/.netlify/functions/asr-transcribe';
const ASR_URL_PATTERN = `**${ASR_PATH}`;
const MOCK_TRANSCRIPT = 'I trust Player 4.';
const MAX_MATCH_ATTEMPTS = 4;
const ADVANCE_TIMEOUT_MS = 45_000;
const PRE_EXISTING_STATIC_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'challenges.cloudflare.com',
  'api.dicebear.com',
]);
const ASR_PROVIDER_URL = /qwen|dashscope|aliyuncs|bailian/i;

/**
 * Long-recording boundary (V-C follow-up): a full 60s recording through the
 * real MediaRecorder → WAV normalise → overlapping-chunk upload chain.
 *
 * The chunk window/step mirror `WAV_CHUNK_MS` / `WAV_OVERLAP_MS` in
 * `src/services/sttAdapter.ts` (3,200ms window, 200ms overlap ⇒ 3,000ms step).
 * `src/services/sttAdapter.test.ts` asserts the exact synthetic-60s plan; this
 * spec asserts the real-browser chain produces the same shape.
 */
const CHUNK_WINDOW_MS = 3_200;
const CHUNK_STEP_MS = 3_000;
/** Wait past the 60s hard stop, then let the split upload finish. */
const HARD_STOP_WAIT_MS = 60_500;
const LONG_RECORDING_MIN_MS = 55_000;

/** Same fake-media launch flags as a manual Chromium voice smoke run. */
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

interface NetworkAudit {
  /** Every request to a host other than the local dev server. */
  external: string[];
  /** External requests that carry a body (the only thing audio could ride on). */
  externalWithBody: string[];
  /** Responses actually delivered by a host other than the local dev server. */
  externalResponses: string[];
  /** `/.netlify/functions/*` paths, in request order. */
  functions: string[];
  /** Any request URL that names an ASR/provider host (qwen / dashscope / aliyuncs / bailian). */
  asrProviderHosts: string[];
}

const watchNetwork = (page: Page, localHost: string): NetworkAudit => {
  const audit: NetworkAudit = {
    external: [],
    externalWithBody: [],
    externalResponses: [],
    functions: [],
    asrProviderHosts: [],
  };
  page.on('request', request => {
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.pathname.startsWith('/.netlify/functions/')) audit.functions.push(url.pathname);
    if (ASR_PROVIDER_URL.test(request.url())) audit.asrProviderHosts.push(request.url());
    if (url.host !== localHost) {
      audit.external.push(request.url());
      if (request.postData()) audit.externalWithBody.push(request.url());
    }
  });
  page.on('response', response => {
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    if (url.host !== localHost) audit.externalResponses.push(response.url());
  });
  return audit;
};

/** Records the microphone start without touching the product code. */
const instrumentRecorderStart = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const prototype = window.MediaRecorder && window.MediaRecorder.prototype;
    if (!prototype) return;
    const originalStart = prototype.start;
    prototype.start = function patchedStart(...args: unknown[]): void {
      (originalStart as (...options: unknown[]) => void).apply(this, args);
      (window as unknown as { __voiceRecorderStarted?: boolean }).__voiceRecorderStarted = true;
    };
  });
};

/**
 * Plays the first night and, when the human was eliminated overnight or the
 * turn was skipped, restarts the match — same retry contract as the single
 * request case. Kept as a helper so the long-recording case does not duplicate
 * the restart logic (the single-request case keeps its own inline copy).
 */
const reachHumanSpeechTurn = async (page: Page, testInfo: TestInfo): Promise<void> => {
  let reachedHumanTurn = false;
  for (let attempt = 1; attempt <= MAX_MATCH_ATTEMPTS && !reachedHumanTurn; attempt += 1) {
    await startNinePlayerGame(page);
    let status = 'stalled';
    try {
      status = await advanceToHumanSpeech(page, ADVANCE_TIMEOUT_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : 'unknown error';
      testInfo.annotations.push({
        type: 'match-retry',
        description: `attempt ${attempt}: advancement stalled (${message})`,
      });
    }
    if (status === 'human') {
      reachedHumanTurn = true;
      break;
    }
    if (status !== 'stalled') {
      testInfo.annotations.push({
        type: 'match-retry',
        description: `attempt ${attempt}: human day-1 speech unavailable (${status})`,
      });
    }
    await leaveGameToLobby(page).catch(() => undefined);
  }
  expect(reachedHumanTurn, 'human survived to the day-1 speech turn').toBe(true);
};

test.describe('click-to-toggle voice input', () => {
  test('records only on the human turn and uploads once to the mocked same-origin ASR', async ({ page }, testInfo) => {
    test.setTimeout(300_000);

    const configuredBaseURL = testInfo.project.use.baseURL;
    const baseURL = typeof configuredBaseURL === 'string' ? configuredBaseURL : 'http://127.0.0.1:5173';
    const baseOrigin = new URL(baseURL).origin;
    const localHost = new URL(baseURL).host;

    // Another card may edit this shared worktree while the spec runs; a stubbed
    // HMR socket keeps a dev-server file change from reloading the session.
    await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:5173\//, () => undefined);

    const audit = watchNetwork(page, localHost);
    const providerRequests = watchProviderRequests(page);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    // No third-party host is contacted at all: everything non-local is aborted
    // before the network. The audit below still records the attempted static
    // assets so the report can enumerate them honestly.
    await page.route(url => url.origin !== baseOrigin, route => route.abort());

    // The same-origin ASR endpoint is mocked and held open until the test has
    // observed `transcribing`; the response then delivers fixed text.
    let asrCalls = 0;
    const asrBodies: string[] = [];
    let releaseAsr: (() => void) | null = null;
    const asrGate = new Promise<void>(resolve => {
      releaseAsr = resolve;
    });
    await page.route(ASR_URL_PATTERN, async route => {
      asrCalls += 1;
      asrBodies.push(route.request().postData() ?? '');
      await asrGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: MOCK_TRANSCRIPT, model: 'mock-asr', durationMs: 1000 }),
      });
    });

    await instrumentRecorderStart(page);

    await enterGuestLobby(page);

    let reachedHumanTurn = false;
    for (let attempt = 1; attempt <= MAX_MATCH_ATTEMPTS && !reachedHumanTurn; attempt += 1) {
      await startNinePlayerGame(page);
      let status = 'stalled';
      try {
        // Same H1-B helper used by the first-day spec; the shorter timeout only
        // turns its rare night-action stall into a fresh-match retry.
        status = await advanceToHumanSpeech(page, ADVANCE_TIMEOUT_MS);
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : 'unknown error';
        testInfo.annotations.push({
          type: 'match-retry',
          description: `attempt ${attempt}: advancement stalled (${message})`,
        });
      }
      if (status === 'human') {
        reachedHumanTurn = true;
        break;
      }
      if (status !== 'stalled') {
        testInfo.annotations.push({
          type: 'match-retry',
          description: `attempt ${attempt}: human day-1 speech unavailable (${status})`,
        });
      }
      await leaveGameToLobby(page).catch(() => undefined);
    }
    expect(reachedHumanTurn, 'human survived to the day-1 speech turn').toBe(true);

    await expect(page.getByText('It is your turn to speak publicly.')).toBeVisible();
    expect(audit.functions, 'no Function request before the microphone is used').toEqual([]);

    const voiceControl = page.locator('[data-voice-control]');
    const voiceStatus = page.locator('[data-voice-status]');
    await expect(voiceControl, 'the microphone exists on the human turn').toBeVisible();
    await expect(voiceControl).toBeEnabled();
    await expect(voiceStatus).toHaveAttribute('data-voice-status', 'idle');

    // ── First click: start recording ─────────────────────────────────────
    await voiceControl.click();
    await expect(voiceControl).toHaveAttribute('aria-pressed', 'true');
    await expect(voiceControl).toHaveClass(/opacity-50/);
    await expect(voiceStatus).toHaveAttribute('data-voice-status', 'recording');
    await expect(page.getByText('Recording…')).toBeVisible();
    await page.waitForFunction(
      () => (window as unknown as { __voiceRecorderStarted?: boolean }).__voiceRecorderStarted === true,
      undefined,
      { timeout: 10_000 },
    );

    // Keep recording across one application-visible speech-clock tick instead
    // of a fixed timeout, so the MediaRecorder emits a non-empty recording.
    const speechClock = page.locator('.game-action-console .timer-pill').first();
    await expect(speechClock).toBeVisible();
    const clockAtPress = Number((await speechClock.innerText()).replace(/\D/g, ''));
    await expect
      .poll(
        async () => Number((await speechClock.innerText().catch(() => '')).replace(/\D/g, '')),
        { timeout: 10_000, intervals: [100, 200] },
      )
      .toBeLessThan(clockAtPress);

    // ── Second click: stop recording and transcribe ──────────────────────
    await voiceControl.click();
    await expect(voiceStatus).toHaveAttribute('data-voice-status', 'transcribing');
    await expect(page.getByText('Transcribing…')).toBeVisible();

    await expect.poll(() => asrCalls, { timeout: 10_000 }).toBe(1);
    expect(asrBodies, 'one recording produces one same-origin request').toHaveLength(1);
    const asrBody = JSON.parse(asrBodies[0]) as {
      audio: string;
      durationMs: number;
      lang: string;
    };
    expect(Object.keys(asrBody).sort(), 'only audio + language + duration are sent').toEqual([
      'audio',
      'durationMs',
      'lang',
    ]);
    expect(asrBody.lang).toBe('en-US');
    expect(asrBody.durationMs).toBeGreaterThan(0);
    expect(asrBody.durationMs).toBeLessThanOrEqual(60_000);
    expect(asrBody.audio).toMatch(/^data:audio\/[\w.-]+(?:;[^,]*)?;base64,[A-Za-z0-9+/=]+$/i);

    expect(releaseAsr, 'the ASR mock gate is ready').not.toBeNull();
    releaseAsr?.();

    await expect(voiceStatus).toHaveAttribute('data-voice-status', 'idle');
    await expect(voiceControl).toBeEnabled();
    await expect(page.locator('[data-speech-input-row] input')).toHaveValue(MOCK_TRANSCRIPT);

    // ── End the human turn: no microphone afterwards ─────────────────────
    // The next phase is an AI speech or the night action depending on seat
    // order; in both cases SpeechInput is unmounted, so only the absence of the
    // control is asserted (no fixed wait for a particular next phase).
    await page.getByRole('button', { name: 'Send speech' }).click();
    await expect(page.locator('[data-speech-input-row]')).toHaveCount(0);
    await expect(voiceControl, 'no microphone outside the human turn').toHaveCount(0);

    // ── Network boundary ─────────────────────────────────────────────────
    expect(asrCalls, 'the same-origin ASR mock is hit exactly once').toBe(1);
    expect(
      audit.functions.filter(path => path === ASR_PATH),
      'the only Function path used by the voice flow',
    ).toHaveLength(1);
    expect(
      audit.functions.filter(path => path !== ASR_PATH),
      'no provider-adapter / bailian-tts / other Function request',
    ).toEqual([]);
    expect(providerRequests, 'no external AI/TTS Function request').toEqual([]);
    expect(audit.asrProviderHosts, 'no qwen / dashscope / aliyuncs / bailian URL').toEqual([]);
    expect(audit.externalWithBody, 'no external request carries an audio body').toEqual([]);
    expect(audit.externalResponses, 'no third-party host answers any request').toEqual([]);

    const unexpectedExternal = audit.external.filter(url => {
      try {
        return !PRE_EXISTING_STATIC_HOSTS.has(new URL(url).hostname);
      } catch {
        return true;
      }
    });
    expect(
      unexpectedExternal,
      'the only attempted external requests are the pre-existing static assets',
    ).toEqual([]);

    testInfo.annotations.push({
      type: 'network-audit',
      description: JSON.stringify({
        asrMockHits: asrCalls,
        functionPaths: audit.functions,
        blockedExternalAttempts: audit.external.length,
        blockedExternalHosts: [...new Set(audit.external.map(url => new URL(url).hostname))],
        externalResponses: audit.externalResponses.length,
        externalWithBody: audit.externalWithBody.length,
        asrProviderHosts: audit.asrProviderHosts,
        providerRequests,
      }),
    });

    expect(pageErrors, 'no uncaught page error during the voice flow').toEqual([]);
  });
});

/**
 * V-C long-recording case: one real 60s fake-microphone capture (full hard
 * stop), split client-side into overlapping WAV chunks, uploaded in parallel to
 * the same-origin ASR endpoint (mocked) and merged back into the draft input.
 *
 * The in-game speech clock is paused for the capture so the 60s turn clock
 * cannot expire mid-recording; the microphone timer is independent of pause and
 * still fires the 60s hard stop. No real microphone, key, provider or external
 * host is involved. The fake device emits a synthetic tone, so this case never
 * asserts real recognition content — only the transport/merge/UI chain.
 */
test.describe('long voice recording (60s hard stop)', () => {
  test('splits a full 60s capture into parallel same-origin chunks and merges the text once', async ({ page }, testInfo) => {
    test.setTimeout(420_000);

    const configuredBaseURL = testInfo.project.use.baseURL;
    const baseURL = typeof configuredBaseURL === 'string' ? configuredBaseURL : 'http://127.0.0.1:5173';
    const baseOrigin = new URL(baseURL).origin;
    const localHost = new URL(baseURL).host;

    // Keep a same-worktree edit from reloading the session mid-recording.
    await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:5173\//, () => undefined);

    const audit = watchNetwork(page, localHost);
    const providerRequests = watchProviderRequests(page);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.route(url => url.origin !== baseOrigin, route => route.abort());

    // Same-origin ASR mock: one fixed sentence per chunk (the chunk index is
    // the request order), held open until the test has observed the parallel
    // burst and the `transcribing` state. No real ASR key is involved.
    let asrCalls = 0;
    const asrBodies: string[] = [];
    let releaseAsr: (() => void) | null = null;
    const asrGate = new Promise<void>(resolve => {
      releaseAsr = resolve;
    });
    await page.route(ASR_URL_PATTERN, async route => {
      const chunkIndex = asrCalls;
      asrCalls += 1;
      asrBodies.push(route.request().postData() ?? '');
      await asrGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: `Voice ${chunkIndex} segment`, model: 'mock-asr', durationMs: 1000 }),
      });
    });

    await instrumentRecorderStart(page);
    await enterGuestLobby(page);
    await reachHumanSpeechTurn(page, testInfo);

    await expect(page.getByText('It is your turn to speak publicly.')).toBeVisible();
    expect(audit.functions, 'no Function request before the microphone is used').toEqual([]);

    const voiceControl = page.locator('[data-voice-control]');
    const voiceStatus = page.locator('[data-voice-status]');
    const pauseButton = page.locator('.game-pause-button');
    const pauseStatus = page.locator('.game-pause-status');
    const transcriptInput = page.locator('[data-speech-input-row] input');
    await expect(voiceControl, 'the microphone exists on the human turn').toBeVisible();
    await expect(voiceControl).toBeEnabled();
    await expect(voiceStatus).toHaveAttribute('data-voice-status', 'idle');

    // ── Full 60s capture: hard stop, no second click ─────────────────────
    await voiceControl.click();
    await expect(voiceControl).toHaveAttribute('aria-pressed', 'true');
    await expect(voiceStatus).toHaveAttribute('data-voice-status', 'recording');
    await expect(page.getByText('Recording…')).toBeVisible();
    await page.waitForFunction(
      () => (window as unknown as { __voiceRecorderStarted?: boolean }).__voiceRecorderStarted === true,
      undefined,
      { timeout: 10_000 },
    );

    // Freeze the 60s in-game speech clock so the day turn cannot end first.
    // The microphone timer is independent of pause, so the hard stop below is
    // still the product's own 60s safety boundary; the capture itself remains
    // real wall-clock audio from the fake device.
    await pauseButton.click();
    await expect(pauseButton).toContainText('Resume');
    await expect(pauseStatus).toContainText('AI Paused');

    // The captured interval is the measurement itself, so this is a real
    // wall-clock wait rather than a state wait: exceed the 60s hard stop (and
    // leave room for MediaRecorder's start lag) before inspecting the result.
    await page.waitForTimeout(HARD_STOP_WAIT_MS);

    // ── Hard stop fired: transcribing, then the parallel chunk burst ─────
    await expect(voiceStatus).toHaveAttribute('data-voice-status', 'transcribing', { timeout: 10_000 });
    await expect.poll(() => asrCalls, { timeout: 90_000 }).toBeGreaterThan(1);
    expect(releaseAsr, 'the ASR mock gate is ready').not.toBeNull();
    releaseAsr?.();
    await expect(voiceStatus).toHaveAttribute('data-voice-status', 'idle', { timeout: 30_000 });
    await expect(voiceControl).toBeEnabled();

    // ── Chunk plan and per-request contract ──────────────────────────────
    expect(asrCalls, 'a full capture is split into many chunks').toBeGreaterThan(1);
    const bodies = asrBodies.map(raw => JSON.parse(raw) as {
      audio: string;
      durationMs: number;
      lang: string;
    });
    expect(bodies, 'one same-origin request per chunk').toHaveLength(asrCalls);
    for (const body of bodies) {
      expect(Object.keys(body).sort(), 'only audio + language + duration are sent').toEqual([
        'audio',
        'durationMs',
        'lang',
      ]);
      expect(body.lang).toBe('en-US');
      expect(body.audio).toMatch(/^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/);
      expect(body.durationMs).toBeGreaterThan(0);
      expect(body.durationMs).toBeLessThanOrEqual(CHUNK_WINDOW_MS);
    }

    const chunkDurations = bodies.map(body => body.durationMs);
    expect(
      chunkDurations.slice(0, -1),
      `every non-final chunk is the ${CHUNK_WINDOW_MS}ms window`,
    ).toEqual(Array.from({ length: asrCalls - 1 }, () => CHUNK_WINDOW_MS));
    const lastChunkMs = chunkDurations[chunkDurations.length - 1];
    expect(lastChunkMs).toBeGreaterThan(0);
    expect(lastChunkMs).toBeLessThanOrEqual(CHUNK_STEP_MS);

    // Derive the recorded length from the chunk plan: chunk i starts at
    // i * 3,000ms and covers `durationMs`. The ±1 chunk tolerance in the card
    // is unnecessary because the expected count is derived from the measured
    // audio length; the MediaRecorder start lag is what makes it 19 or 20.
    const recordedMs = Math.max(
      ...chunkDurations.map((durationMs, index) => index * CHUNK_STEP_MS + durationMs),
    );
    expect(recordedMs, 'a real 55s+ capture was recorded').toBeGreaterThanOrEqual(LONG_RECORDING_MIN_MS);
    expect(recordedMs).toBeLessThanOrEqual(60_000);
    expect(asrCalls, 'chunk count follows the 3s-step / 3.2s-window formula')
      .toBe(Math.floor((recordedMs - 1) / CHUNK_STEP_MS) + 1);

    // ── Merged draft: written once, ordered, never auto-submitted ────────
    const expectedTranscript = Array.from(
      { length: asrCalls },
      (_, index) => `Voice ${index} segment`,
    ).join(' ');
    await expect(transcriptInput, 'the merged text lands in the draft input').toHaveValue(expectedTranscript);
    await expect(page.locator('[data-speech-input-row]')).toBeVisible();

    const logFeed = page.locator('.game-log-feed').first();
    await expect(logFeed).toBeAttached();
    expect(
      await logFeed.innerText(),
      'the transcript is only a draft until the player presses Send speech',
    ).not.toContain(expectedTranscript);

    // ── Resume and submit explicitly ─────────────────────────────────────
    await pauseButton.click();
    await expect(pauseButton).toContainText('Pause');
    await expect.poll(async () => (await pauseStatus.innerText()).trim()).toBe('');
    await page.getByRole('button', { name: 'Send speech' }).click();
    await expect(page.locator('[data-speech-input-row]')).toHaveCount(0);
    await expect
      .poll(async () => (await page.locator('.game-log-feed').first().innerText()))
      .toContain(expectedTranscript);

    // ── Network boundary ─────────────────────────────────────────────────
    expect(
      audit.functions.filter(path => path === ASR_PATH),
      'the only Function path used by the long voice flow',
    ).toHaveLength(asrCalls);
    expect(
      audit.functions.filter(path => path !== ASR_PATH),
      'no provider-adapter / bailian-tts / other Function request',
    ).toEqual([]);
    expect(providerRequests, 'no external AI/TTS Function request').toEqual([]);
    expect(audit.asrProviderHosts, 'no qwen / dashscope / aliyuncs / bailian URL').toEqual([]);
    expect(audit.externalWithBody, 'no external request carries an audio body').toEqual([]);
    expect(audit.externalResponses, 'no third-party host answers any request').toEqual([]);

    const unexpectedExternal = audit.external.filter(url => {
      try {
        return !PRE_EXISTING_STATIC_HOSTS.has(new URL(url).hostname);
      } catch {
        return true;
      }
    });
    expect(unexpectedExternal, 'the only attempted external requests are the pre-existing static assets')
      .toEqual([]);

    testInfo.annotations.push({
      type: 'long-recording-audit',
      description: JSON.stringify({
        asrMockHits: asrCalls,
        recordedMs,
        chunkDurations,
        functionPaths: audit.functions,
        blockedExternalAttempts: audit.external.length,
        externalResponses: audit.externalResponses.length,
        externalWithBody: audit.externalWithBody.length,
        asrProviderHosts: audit.asrProviderHosts,
        providerRequests,
      }),
    });

    expect(pageErrors, 'no uncaught page error during the long voice flow').toEqual([]);
  });
});

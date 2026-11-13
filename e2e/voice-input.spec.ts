import { expect, test, type Page } from '@playwright/test';
import {
  advanceToHumanSpeech,
  enterGuestLobby,
  leaveGameToLobby,
  startNinePlayerGame,
  watchProviderRequests,
} from './helpers/game';

/**
 * V-C: Chromium fake-media smoke test for the push-to-talk voice input.
 *
 * What this spec proves:
 * - the microphone button only exists on the human's own day-discussion turn;
 * - press → `recording` (`aria-pressed="true"`), release → `transcribing` and
 *   then back to `idle`;
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

test.describe('push-to-talk voice input', () => {
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

    // ── Press ────────────────────────────────────────────────────────────
    // Real pointer events (not a synthetic dispatch) so the push-to-talk
    // pointerdown/pointerup handlers receive the same sequence a user does.
    const voiceBox = await voiceControl.boundingBox();
    expect(voiceBox, 'the microphone button has a layout box').not.toBeNull();
    if (!voiceBox) throw new Error('The microphone button has no layout box.');
    await page.mouse.move(voiceBox.x + voiceBox.width / 2, voiceBox.y + voiceBox.height / 2);
    await page.mouse.down();
    await expect(voiceControl).toHaveAttribute('aria-pressed', 'true');
    await expect(voiceStatus).toHaveAttribute('data-voice-status', 'recording');
    await expect(page.getByText('Recording…')).toBeVisible();
    await page.waitForFunction(
      () => (window as unknown as { __voiceRecorderStarted?: boolean }).__voiceRecorderStarted === true,
      undefined,
      { timeout: 10_000 },
    );

    // Hold across one application-visible speech-clock tick instead of a fixed
    // timeout, so the MediaRecorder emits a non-empty recording before release.
    const speechClock = page.locator('.game-action-console .timer-pill').first();
    await expect(speechClock).toBeVisible();
    const clockAtPress = Number((await speechClock.innerText()).replace(/\D/g, ''));
    await expect
      .poll(
        async () => Number((await speechClock.innerText().catch(() => '')).replace(/\D/g, '')),
        { timeout: 10_000, intervals: [100, 200] },
      )
      .toBeLessThan(clockAtPress);

    // ── Release ──────────────────────────────────────────────────────────
    await page.mouse.up();
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

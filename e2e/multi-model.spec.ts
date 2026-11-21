import { test, expect, type Page } from '@playwright/test';
import { enterGuestLobby, advanceToHumanSpeech, advanceToVoting, skipMatchIntro } from './helpers/game';
import path from 'node:path';

// Explicit HTTP mock provenance: these are browser routing/accessibility tests,
// not evidence of actual vendor availability or generation.
test.use({ baseURL: 'http://127.0.0.1:5176' });
const models = ['gemini-3.6-flash', 'deepseek-flash', 'deepseek-v4-pro'] as const;
const labels = ['Gemini 3.6 Flash', 'DeepSeek V4.1 Flash', 'DeepSeek V4 Pro'];
const evidence = path.resolve(process.env.MULTI_MODEL_EVIDENCE_DIR || 'test-results/multi-model');
type RequestBody = { model: string; prompt: string; difficulty: string };
const prepare = async (page: Page, available = true, discoveryGate?: Promise<void>, failover = false) => {
  await page.addInitScript(() => {
    Math.random = () => 0.9999; // Identity Fisher–Yates deal: the guest and seats 2–3 are wolves.
    localStorage.setItem('werewolf_audio_prefs', JSON.stringify({ enabled: false, volume: 0, rate: 1 }));
  });
  const posts: RequestBody[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname !== '/.netlify/functions/provider-adapter') return route.continue();
    if (route.request().method() === 'GET' && discoveryGate) await discoveryGate;
    if (route.request().method() === 'GET') return route.fulfill({ json: available
      ? { default_model: 'gemini-3.6-flash', models: [...models, 'gemini-2.5-flash'].map(id => ({ id, label: id })), verified_models: [...models, 'gemini-2.5-flash'] }
      : { default_model: 'gemini-2.5-flash', models: [{ id: 'gemini-2.5-flash', label: 'Backup' }], verified_models: [] } });
    const body = route.request().postDataJSON() as RequestBody;
    posts.push(body);
    const speakers = /Requested AI speakers only: ([^\n]+)/.exec(body.prompt)?.[1];
    const failed = failover && body.model === models[0] && (speakers === 'Player 2' || /Your true identity: [^\n]+ \(Player 2\)/.test(body.prompt));
    if (failed) return route.fulfill({ status: 503, json: { error: 'simulated provider failure' } });
    const content = speakers ? { messages: [...speakers.matchAll(/Player (\d+)/g)].map(match => ({ speakerId: Number(match[1]), message: 'We should compare the risks before choosing Player 4. I will keep my assigned role and listen to the team.', strategyTag: '补位' })) }
      : { en: 'Player 4 needs to explain that vote clearly before the village decides, because a consistent account will help everyone compare the evidence.' };
    await route.fulfill({ json: { text: JSON.stringify(content), model_used: body.model, fallback_used: false, cost_estimate: 0 } });
  });
  await enterGuestLobby(page);
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await page.getByRole('button', { name: /Single-Player/ }).click();
  if (await page.locator('.onboarding-panel').isVisible()) await page.locator('.onboarding-panel').getByRole('button', { name: 'Skip', exact: true }).click();
  return posts;
};

const assertBadgesFit = async (page: Page) => {
  await expect(page.locator('.game-player-seat').first().locator('[data-model-badge]')).toHaveCount(0);
  const badges = await page.locator('[data-model-badge]').evaluateAll(nodes => nodes.map(node => {
    const badge = node as HTMLElement;
    const style = getComputedStyle(badge);
    const range = document.createRange();
    range.selectNodeContents(badge);
    const text = range.getBoundingClientRect();
    const bounds = badge.getBoundingClientRect();
    return {
      name: badge.textContent?.trim(),
      title: badge.title,
      label: badge.getAttribute('aria-label'),
      fits: text.left >= bounds.left - 1 && text.right <= bounds.right + 1
        && text.top >= bounds.top - 1 && text.bottom <= bounds.bottom + 1,
      noEllipsis: style.textOverflow !== 'ellipsis' && style.whiteSpace === 'normal',
    };
  }));
  for (const { name, title, label, fits, noEllipsis } of badges) {
    expect(name).not.toMatch(/Assigned|Local dialogue/);
    expect(title).toBe(name);
    expect(label).toBe(name);
    expect(fits && noEllipsis).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
};

for (const width of [1440, 390]) {
  test(`participating list keyboard and stable HTTP seat routing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const failover = width === 390;
    const posts = await prepare(page, true, undefined, failover);
    await expect(page.getByRole('radio', { name: /^Multi-AI Models/ })).toBeChecked();
    const details = page.getByRole('button', { name: 'View participating AI models' });
    await details.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Participating AI models' });
    await expect(dialog).toBeVisible();
    for (const label of labels) await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    await expect(dialog.getByText('Available', { exact: true })).toHaveCount(3);
    await expect(dialog.getByRole('listitem')).toHaveCount(7);
    for (const label of ['Gemini 3.8 Flash', 'Doubao Seed 1.6 Flash', 'Doubao Seed Character', 'Doubao Seed 2.1 Lite']) {
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(dialog.getByText('Unavailable', { exact: true })).toHaveCount(4);
    const close = dialog.getByRole('button', { name: 'Close participating AI models' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab'); await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(close).toBeFocused();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(width === 390 ? 844 : 900);
    await page.screenshot({ path: path.join(evidence, `mock-model-list-${width}.png`), fullPage: false });
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(details).toBeFocused();
    await details.click(); await close.click(); await expect(details).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('radio', { name: /^Multi-AI Models/ })).toBeChecked();
    await page.screenshot({ path: path.join(evidence, `mock-model-setup-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Start Game', exact: true }).click();
    await expect(page.locator('.game-room')).toBeVisible();
    await skipMatchIntro(page);
    await expect(page.locator('.onboarding-panel')).toBeVisible();
    await page.locator('.onboarding-panel').getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.locator('[data-model-badge]')).toHaveCount(8);
    for (let seat = 2; seat <= 9; seat++) {
      await expect(page.locator('.game-player-seat').nth(seat - 1).locator('[data-model-badge]')).toHaveAttribute('aria-label', labels[(seat - 2) % 3]);
    }
    await assertBadgesFit(page);
    await page.screenshot({ path: path.join(evidence, `mock-assigned-seats-${width}.png`), fullPage: true });
    await expect(page.getByRole('textbox', { name: 'Message your pack' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Message your pack' }).fill('Player 2, please lead. Player 3, support the plan.');
    await page.getByRole('button', { name: 'Send to pack' }).click();
    await expect.poll(() => posts.length).toBe(failover ? 3 : 2);
    expect(posts.map(body => body.model)).toEqual(failover ? [models[0], models[1], models[1]] : [models[0], models[1]]);
    for (const [index, body] of posts.entries()) {
      const seat = index === posts.length - 1 ? 3 : 2;
      expect(body.prompt).toContain(`Requested AI speakers only: Player ${seat}`);
      expect(body.difficulty).toBe('normal');
    }
    await expect(page.locator('.game-player-seat').nth(1).locator('[data-model-badge]')).toHaveAttribute('aria-label', failover ? labels[1] : labels[0]);
    await expect(page.locator('.game-player-seat').nth(2).locator('[data-model-badge]')).toHaveAttribute('aria-label', labels[1]);
    await assertBadgesFit(page);
    await page.screenshot({ path: path.join(evidence, `mock-accepted-seats-${width}.png`), fullPage: true });
    await page.locator('.game-player-seat').nth(3).getByRole('button').click();
    await page.getByRole('button', { name: 'KILL', exact: true }).click();
    await page.getByRole('button', { name: 'Skip night chat', exact: true }).click();
    expect(await advanceToHumanSpeech(page)).toBe('human');
    await page.locator('[data-speech-input-row] input').fill('I will compare the evidence before deciding where to vote.');
    await page.getByRole('button', { name: 'Send speech' }).click();
    expect(await advanceToVoting(page)).toBe('voting');
    const dayPosts = posts.filter(body => !body.prompt.includes('Requested AI speakers only:'));
    expect(dayPosts.length).toBeGreaterThanOrEqual(3);
    for (const body of dayPosts) {
      const seat = Number(/Your true identity: [^\n]+ \(Player (\d+)\)/.exec(body.prompt)![1]);
      if (!failover || seat !== 2) expect(body.model).toBe(models[(seat - 2) % 3]);
      expect(body.difficulty).toBe('normal');
    }
    const seatTwoAttempts = dayPosts.filter(body => /Your true identity: [^\n]+ \(Player 2\)/.test(body.prompt));
    expect(seatTwoAttempts.map(body => body.model)).toEqual(failover ? [models[0], models[1]] : [models[0]]);
    if (failover) expect(seatTwoAttempts[0].prompt).toBe(seatTwoAttempts[1].prompt);
  });
}

test('twelve-player setup keeps the complete stable pool across all eleven seats', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.getByRole('radio', { name: /12-Player Standard/ }).check();
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(page.locator('.game-room')).toBeVisible();
  await skipMatchIntro(page);
  await expect(page.locator('.onboarding-panel')).toBeVisible();
  await page.locator('.onboarding-panel').getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.locator('[data-model-badge]')).toHaveCount(11);
  for (let seat = 2; seat <= 12; seat++) await expect(page.locator('.game-player-seat').nth(seat - 1).locator('[data-model-badge]')).toHaveAttribute('aria-label', labels[(seat - 2) % 3]);
  await assertBadgesFit(page);
  await page.screenshot({ path: path.join(evidence, 'mock-12-player-seats-390.png'), fullPage: true });
});

test('offline capability list distinguishes backup from available participants', async ({ page }) => {
  await prepare(page, false);
  await page.getByRole('button', { name: 'View participating AI models' }).click();
  await expect(page.getByRole('dialog').getByText('Unavailable', { exact: true })).toHaveCount(7);
  await expect(page.getByRole('dialog')).toContainText('that turn is skipped');
});

test('late discovery preserves an explicitly selected safe model and expand/collapse keeps selection', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await prepare(page, true, gate);
  const singleEntry = page.locator('.start-single-models-summary');
  await expect(singleEntry).toBeVisible();
  await singleEntry.click();
  const safe = page.getByRole('radio', { name: /^Gemini 2\.5 Flash/ });
  await safe.check();
  // A real change event requires selecting another choice before returning.
  await page.getByRole('radio', { name: /^Multi-AI Models/ }).check();
  await safe.check();
  release();
  await expect(page.getByText('Single-Model Options', { exact: true })).toBeVisible();
  await expect(safe).toBeChecked();
  // Collapse and verify selection summary remains visible, then expand again.
  await singleEntry.click();
  await expect(page.locator('.start-single-models')).toHaveClass(/is-selected/);
  await expect(singleEntry).toContainText('Selected: Gemini 2.5 Flash');
  await singleEntry.click();
  await expect(safe).toBeChecked();
});

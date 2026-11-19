import { test, expect, type Page } from '@playwright/test';
import { enterGuestLobby, advanceToHumanSpeech, advanceToVoting } from './helpers/game';
import path from 'node:path';

// Explicit HTTP mock provenance: these are browser routing/accessibility tests,
// not evidence of actual vendor availability or generation.
test.use({ baseURL: 'http://127.0.0.1:5176' });
const models = ['gemini-3.6-flash', 'deepseek-flash', 'deepseek-v4-pro'] as const;
const labels = ['Gemini 3.6 Flash', 'DeepSeek V4.1 Flash', 'DeepSeek V4 Pro'];
const evidence = path.resolve(process.env.MULTI_MODEL_EVIDENCE_DIR || 'test-results/multi-model');
type RequestBody = { model: string; prompt: string; difficulty: string };
const prepare = async (page: Page, available = true, discoveryGate?: Promise<void>) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
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

for (const width of [1440, 390]) {
  test(`participating list keyboard and stable HTTP seat routing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const posts = await prepare(page);
    await expect(page.getByRole('radio', { name: /^Multi AI Model/ })).toBeChecked();
    const details = page.getByRole('button', { name: 'View participating AI models' });
    await details.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Participating AI models' });
    await expect(dialog).toBeVisible();
    for (const label of labels) await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    await expect(dialog.getByText('Available', { exact: true })).toHaveCount(3);
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
    await expect(page.getByRole('radio', { name: /^Multi AI Model/ })).toBeChecked();
    await page.screenshot({ path: path.join(evidence, `mock-model-setup-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Start Game', exact: true }).click();
    await expect(page.locator('.game-room')).toBeVisible();
    await expect(page.locator('.onboarding-panel')).toBeVisible();
    await page.locator('.onboarding-panel').getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.locator('[data-model-badge]')).toHaveCount(8);
    for (let seat = 2; seat <= 9; seat++) {
      await expect(page.locator('.game-player-seat').nth(seat - 1).locator('[data-model-badge]')).toHaveAttribute('aria-label', `Assigned ${labels[(seat - 2) % 3]}`);
    }
    await expect(page.getByRole('textbox', { name: 'Message your pack' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Message your pack' }).fill('Player 2, please lead. Player 3, support the plan.');
    await page.getByRole('button', { name: 'Send to pack' }).click();
    await expect.poll(() => posts.length).toBe(2);
    expect(posts.map(body => body.model)).toEqual(['gemini-3.6-flash', 'deepseek-flash']);
    for (const [index, body] of posts.entries()) {
      expect(body.prompt).toContain(`Requested AI speakers only: Player ${index + 2}`);
      expect(body.difficulty).toBe('normal');
      await expect(page.locator('.game-player-seat').nth(index + 1).locator('[data-model-badge]')).toHaveAttribute('aria-label', `${labels[index]} · Assigned ${labels[index]}`);
    }
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
      expect(body.model).toBe(models[(seat - 2) % 3]);
      expect(body.difficulty).toBe('normal');
    }
  });
}

test('twelve-player setup keeps the complete stable pool across all eleven seats', async ({ page }) => {
  await prepare(page);
  await page.getByRole('radio', { name: /12-Player Standard/ }).check();
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(page.locator('.game-room')).toBeVisible();
  await expect(page.locator('.onboarding-panel')).toBeVisible();
  await page.locator('.onboarding-panel').getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.locator('[data-model-badge]')).toHaveCount(11);
  for (let seat = 2; seat <= 12; seat++) await expect(page.locator('.game-player-seat').nth(seat - 1).locator('[data-model-badge]')).toHaveAttribute('aria-label', `Assigned ${labels[(seat - 2) % 3]}`);
});

test('offline capability list distinguishes backup from available participants', async ({ page }) => {
  await prepare(page, false);
  await page.getByRole('button', { name: 'View participating AI models' }).click();
  await expect(page.getByRole('dialog').getByText('Unavailable', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('dialog')).toContainText('Local dialogue');
});

test('late discovery preserves an explicitly selected safe model', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await prepare(page, true, gate);
  const safe = page.getByRole('radio', { name: /^Gemini 2.5 Flash/ });
  await safe.check();
  // A real change event requires selecting another choice before returning.
  await page.getByRole('radio', { name: /^Multi AI Model/ }).check();
  await safe.check();
  release();
  await expect(page.getByText('Single-model options', { exact: true })).toBeVisible();
  await expect(safe).toBeChecked();
});

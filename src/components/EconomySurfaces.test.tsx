import React from 'react';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ActivityBanner, { ACTIVITY_BANNERS, activateActivityBanner } from './ActivityBanner';
import BackpackPanel, { BACKPACK_CATEGORIES, BACKPACK_ITEMS } from './BackpackPanel';
import CoinStore from './CoinStore';
import DailyCheckInView from './DailyCheckInView';
import EconomyBalances from './EconomyBalances';
import OnlineQualifierView from './OnlineQualifierView';
import SkinStore from './SkinStore';
import {
  ONBOARDING_STEPS,
  OnboardingSpotlightLayer,
  acquireOnboardingModalBoundary,
  findAvailableOnboardingStep,
  getOnboardingArrowLayout,
  getOnboardingFocusLoopTarget,
  isOnboardingViewportPlanReady,
  planOnboardingViewport,
  scrollOnboardingDocumentTo,
  type OnboardingModalDocument,
} from './OnboardingSpotlight';
import { CHECK_IN_MILESTONES, createEmptyGuestEconomyState } from '../economy/ledger';

const state = createEmptyGuestEconomyState();
const noopMutation = () => ({ ok: false, code: 'invalid-request' as const, state });

const textContent = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!React.isValidElement(node)) return '';
  return textContent((node.props as { children?: React.ReactNode }).children);
};

const collectButtons = (node: React.ReactNode): React.ReactElement[] => {
  if (!React.isValidElement(node)) return [];
  const own = node.type === 'button' ? [node] : [];
  const children = React.Children.toArray((node.props as { children?: React.ReactNode }).children);
  return own.concat(children.flatMap(collectButtons));
};

const reducedMotionDeclarations = (css: string, selector: string): Record<string, string> => {
  const declarations: Record<string, string> = {};
  postcss.parse(css).walkAtRules('media', atRule => {
    if (!atRule.params.includes('prefers-reduced-motion')) return;
    atRule.walkRules(rule => {
      if (!rule.selectors.includes(selector)) return;
      rule.walkDecls(declaration => {
        declarations[declaration.prop] = declaration.value;
      });
    });
  });
  return declarations;
};

const fakeElement = (
  initialAttributes: Record<string, string> = {},
  initialStyle: Partial<CSSStyleDeclaration> = {},
) => {
  const attributes = new Map(Object.entries(initialAttributes));
  const focus = vi.fn();
  const remove = vi.fn();
  const element = {
    style: { overflow: '', overscrollBehavior: '', touchAction: '', scrollBehavior: '', ...initialStyle },
    isConnected: true,
    focus,
    hasAttribute: (name: string) => attributes.has(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    removeAttribute: (name: string) => { attributes.delete(name); },
    remove,
  };
  return { element, attributes, focus, remove };
};

describe('economy entry surfaces', () => {
  it('renders the three ordered promotions as native 44px-target buttons with exact names', () => {
    const html = renderToStaticMarkup(
      <ActivityBanner onOpenTidalStore={vi.fn()} onOpenQualifier={vi.fn()} onOpenDailyCheckIn={vi.fn()} />,
    );
    expect(ACTIVITY_BANNERS.map(item => item.title)).toEqual([
      'Tidal Season Exclusive',
      'Online Qualifier',
      'Daily Check-In',
    ]);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html.indexOf('Tidal Season Exclusive')).toBeLessThan(html.indexOf('Online Qualifier'));
    expect(html.indexOf('Online Qualifier')).toBeLessThan(html.indexOf('Daily Check-In'));
    expect(html).toContain('data-tour-target="promotions"');
    expect(html).toContain('height:72px');
    expect(html.match(/class="wol-activity-dot(?: is-active)?"/g)).toHaveLength(3);

    const handlers = { onOpenTidalStore: vi.fn(), onOpenQualifier: vi.fn(), onOpenDailyCheckIn: vi.fn() };
    activateActivityBanner('tidal', handlers);
    activateActivityBanner('qualifier', handlers);
    activateActivityBanner('check-in', handlers);
    expect(handlers.onOpenTidalStore).toHaveBeenCalledOnce();
    expect(handlers.onOpenQualifier).toHaveBeenCalledOnce();
    expect(handlers.onOpenDailyCheckIn).toHaveBeenCalledOnce();
  });

  it('exposes exactly Coins Basic and Crystals Premium as named balances', () => {
    const balances = renderToStaticMarkup(<EconomyBalances coins={123} crystals={4} />);
    const store = renderToStaticMarkup(
      <CoinStore coins={123} coupons={999} crystals={4} onPurchase={vi.fn()} />,
    );
    const backpack = renderToStaticMarkup(<BackpackPanel />);
    const html = `${balances}${store}${backpack}`;
    expect(html).toContain('123 Coins, Basic currency');
    expect(html).toContain('4 Crystals, Premium currency');
    expect(html).not.toContain('Coupons');
    expect(html).not.toContain('Shards');
    expect(html).not.toContain('redeem a skin');
    expect(html).not.toContain('999');
    expect(html).not.toContain('XP');
    expect(BACKPACK_CATEGORIES.map(item => item.label)).toEqual(['Gifts', 'Chests', 'Items']);
    expect(Object.keys(BACKPACK_ITEMS)).toEqual(['gift', 'chest', 'item']);
    expect(store.match(/class="wol-store-wallet-item /g)).toHaveLength(2);
  });

  it('renders the 7-day track and all five milestone reward descriptions', () => {
    const html = renderToStaticMarkup(
      <DailyCheckInView
        state={state}
        coins={0}
        crystals={0}
        isGuest
        ledgerCorrupt={false}
        feedback=""
        onCheckIn={noopMutation}
        onOpenHistory={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    for (const value of [30, 40, 50, 60, 70, 100, 250]) expect(html).toContain(`${value} Coins`);
    for (const milestone of CHECK_IN_MILESTONES) {
      expect(html).toContain(`Day ${milestone.day}`);
      expect(html).toContain(milestone.label);
    }
    expect(html.match(/<progress/g)).toHaveLength(5);
  });

  it('states that qualifier registration and every live service are unavailable', () => {
    const onBack = vi.fn();
    const view = OnlineQualifierView({ onBack });
    const html = renderToStaticMarkup(view);
    expect(html).toContain('Registration is unavailable');
    expect(html).toContain('does not register players');
    expect(html).toContain('No live entrants');
    expect(html).toContain('no account, wallet, tournament, or network mutation');
    for (const button of collectButtons(view)) {
      (button.props as { onClick?: () => void }).onClick?.();
    }
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});

describe('cosmetic and tutorial contracts', () => {
  it('renders both cosmetic tiers, every price tier, preview/prompt metadata, and no remote image URL', () => {
    const html = renderToStaticMarkup(
      <SkinStore
        state={state}
        coins={0}
        crystals={0}
        isGuest
        ledgerCorrupt={false}
        filter="all"
        feedback=""
        onFilterChange={vi.fn()}
        onUnlock={noopMutation}
        onEquip={noopMutation}
        onOpenHistory={vi.fn()}
      />,
    );
    for (const label of ['Basic · Coins', 'Premium · Crystals', '800 Coins', '1,400 Coins', '2,200 Coins', '3,200 Coins', '20 Crystals', '40 Crystals', '80 Crystals']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Art prompt metadata');
    expect(html).toContain('never change rules, AI decisions, rewards, hit areas, or hidden information');
    expect(html).not.toMatch(/<img[^>]+https?:\/\//);
  });

  it('keeps authenticated unlock and equip mutations visibly unavailable', () => {
    const html = renderToStaticMarkup(
      <SkinStore
        state={state}
        coins={999999}
        crystals={999}
        isGuest={false}
        ledgerCorrupt={false}
        filter="all"
        feedback=""
        onFilterChange={vi.fn()}
        onUnlock={noopMutation}
        onEquip={noopMutation}
        onOpenHistory={vi.fn()}
      />,
    );
    expect(html).toContain('Account rewards and cosmetic changes are unavailable');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it('renders a target-bound arrow and preserves Back/Next/Skip/Finish behavior', () => {
    expect(ONBOARDING_STEPS).toHaveLength(4);
    expect(ONBOARDING_STEPS.map(step => step.id)).toEqual(['wallet', 'promotions', 'start-game', 'navigation']);
    expect(findAvailableOnboardingStep(0, 1, selector => selector.includes('start-game'))).toBe(2);
    expect(findAvailableOnboardingStep(3, -1, () => false)).toBeNull();

    const handlers = { back: vi.fn(), next: vi.fn(), skip: vi.fn(), finish: vi.fn() };
    const rect = { top: 180, left: 80, width: 160, height: 44 };
    const layer = OnboardingSpotlightLayer({
      step: ONBOARDING_STEPS[2],
      stepIndex: 2,
      rect,
      viewportHeight: 700,
      isFirst: false,
      isLast: true,
      onBack: handlers.back,
      onNext: handlers.next,
      onSkip: handlers.skip,
      onFinish: handlers.finish,
    });
    const html = renderToStaticMarkup(layer);
    const arrow = getOnboardingArrowLayout(rect, 700);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-target-step="start-game"');
    expect(html).toContain('class="onboarding-direction-arrow onboarding-direction-arrow--above"');
    expect(html).toContain('aria-label="Arrow pointing to Start a local match"');
    expect(html).toContain(`top:${arrow.top}px`);
    expect(html).toContain(`left:${arrow.left}px`);

    const buttons = collectButtons(layer);
    expect(buttons.map(button => textContent(button))).toEqual(['Back', 'Next', 'Skip', 'Finish']);
    for (const label of ['Back', 'Next', 'Skip']) {
      const button = buttons.find(candidate => textContent(candidate) === label);
      (button?.props as { onClick?: () => void }).onClick?.();
      expect(handlers.finish).not.toHaveBeenCalled();
    }
    (buttons.find(button => textContent(button) === 'Finish')?.props as { onClick?: () => void }).onClick?.();
    expect(handlers.back).toHaveBeenCalledOnce();
    expect(handlers.next).toHaveBeenCalledOnce();
    expect(handlers.skip).toHaveBeenCalledOnce();
    expect(handlers.finish).toHaveBeenCalledOnce();
  });

  it('establishes and exactly restores the tutorial modal boundary', () => {
    const body = fakeElement({}, { overflow: 'scroll', overscrollBehavior: 'contain', touchAction: 'pan-y' });
    const root = fakeElement({}, { overflow: 'clip', overscrollBehavior: 'auto', touchAction: 'manipulation' });
    const shell = fakeElement({ 'aria-hidden': 'false', inert: 'legacy' });
    const priorFocus = fakeElement();
    const spacer = fakeElement();
    const appendChild = vi.fn();
    Object.assign(body.element, { appendChild });
    const scrollState = { x: 17, y: 91 };
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      scrollState.x = options.left ?? scrollState.x;
      scrollState.y = options.top ?? scrollState.y;
    });
    const view = {
      get scrollX() { return scrollState.x; },
      get scrollY() { return scrollState.y; },
      innerHeight: 844,
      scrollTo,
    };
    const modalDocument = {
      activeElement: priorFocus.element as unknown as Element,
      body: body.element as unknown as HTMLElement,
      documentElement: root.element as unknown as HTMLElement,
      querySelector: () => shell.element,
      defaultView: view,
      createElement: () => spacer.element,
    } as unknown as OnboardingModalDocument;
    const restore = acquireOnboardingModalBoundary(modalDocument);

    expect(shell.attributes.get('aria-hidden')).toBe('true');
    expect(shell.attributes.get('inert')).toBe('');
    expect(body.element.style).toMatchObject({ overflow: 'hidden', overscrollBehavior: 'none', touchAction: 'none' });
    expect(root.element.style).toMatchObject({ overflow: 'hidden', overscrollBehavior: 'none', touchAction: 'none' });
    expect(appendChild).toHaveBeenCalledWith(spacer.element);
    expect(spacer.element.style.height).toBe('844px');

    scrollOnboardingDocumentTo(modalDocument, 17, 388);
    expect(scrollState).toEqual({ x: 17, y: 388 });
    expect(body.element.style.overflow).toBe('hidden');
    expect(root.element.style.overflow).toBe('hidden');

    restore();
    restore();
    expect(shell.attributes.get('aria-hidden')).toBe('false');
    expect(shell.attributes.get('inert')).toBe('legacy');
    expect(body.element.style).toMatchObject({ overflow: 'scroll', overscrollBehavior: 'contain', touchAction: 'pan-y' });
    expect(root.element.style).toMatchObject({ overflow: 'clip', overscrollBehavior: 'auto', touchAction: 'manipulation' });
    expect(scrollState).toEqual({ x: 17, y: 91 });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 17, top: 91, behavior: 'auto' });
    expect(spacer.remove).toHaveBeenCalledOnce();
    expect(priorFocus.focus).toHaveBeenCalledOnce();
    expect(priorFocus.focus).toHaveBeenCalledWith({ preventScroll: true });

    const absentShell = fakeElement();
    const absentBody = fakeElement();
    const absentSpacer = fakeElement();
    Object.assign(absentBody.element, { appendChild: vi.fn() });
    const absentDocument = {
      activeElement: null,
      body: absentBody.element as unknown as HTMLElement,
      documentElement: fakeElement().element as unknown as HTMLElement,
      querySelector: (() => absentShell.element) as unknown as OnboardingModalDocument['querySelector'],
      defaultView: null,
      createElement: () => absentSpacer.element,
    } as unknown as OnboardingModalDocument;
    const restoreAbsentAttributes = acquireOnboardingModalBoundary(absentDocument);
    restoreAbsentAttributes();
    expect(absentShell.attributes.has('aria-hidden')).toBe(false);
    expect(absentShell.attributes.has('inert')).toBe(false);
  });

  it.each([
    {
      name: '390x844 long-page navigation',
      viewportWidth: 390,
      viewportHeight: 844,
      target: { top: 1063, left: 234, width: 78, height: 64 },
      panel: { top: 18, left: 15, width: 360, height: 286 },
    },
    {
      name: '720x450 zoomed promotions',
      viewportWidth: 720,
      viewportHeight: 450,
      target: { top: 577, left: 24, width: 672, height: 92 },
      panel: { top: 6, left: 80, width: 560, height: 174 },
    },
    {
      name: '720x450 zoomed start-game',
      viewportWidth: 720,
      viewportHeight: 450,
      target: { top: 679, left: 24, width: 672, height: 158 },
      panel: { top: 6, left: 80, width: 560, height: 174 },
    },
    {
      name: '720x450 zoomed navigation control',
      viewportWidth: 720,
      viewportHeight: 450,
      target: { top: 228, left: 8, width: 72, height: 64 },
      panel: { top: 6, left: 80, width: 560, height: 174 },
    },
  ])('positions a target inside a panel-safe visible region: $name', ({
    viewportWidth, viewportHeight, target, panel,
  }) => {
    const plan = planOnboardingViewport(target, panel, 'top', viewportWidth, viewportHeight);
    if (target.top > viewportHeight) expect(plan.scrollDeltaY).toBeGreaterThan(0);
    expect(isOnboardingViewportPlanReady(plan)).toBe(true);
    expect(plan.targetRect.top).toBeGreaterThanOrEqual(plan.safeTop);
    expect(plan.targetRect.top + plan.targetRect.height).toBeLessThanOrEqual(plan.safeBottom);
    expect(plan.highlightRect.top).toBeGreaterThanOrEqual(0);
    expect(plan.highlightRect.top + plan.highlightRect.height).toBeLessThanOrEqual(viewportHeight);
    expect(plan.arrow.top).toBeGreaterThanOrEqual(0);
    expect(plan.arrow.top + plan.arrow.height).toBeLessThanOrEqual(viewportHeight);
    expect(plan.avoidsPanel).toBe(true);
  });

  it('loops tutorial focus at both modal edges and redirects outside focus', () => {
    const first = fakeElement().element as unknown as HTMLElement;
    const last = fakeElement().element as unknown as HTMLElement;
    const outside = fakeElement().element as unknown as HTMLElement;
    expect(getOnboardingFocusLoopTarget([first, last], last, false)).toBe(first);
    expect(getOnboardingFocusLoopTarget([first, last], first, true)).toBe(last);
    expect(getOnboardingFocusLoopTarget([first, last], outside, false)).toBe(first);
  });

  it('removes marquee, activity-dot, tutorial, and card motion under reduced motion', () => {
    const css = readFileSync(new URL('../styles/economy.css', import.meta.url), 'utf8');
    const shellCss = readFileSync(new URL('../styles/mobile-shell.css', import.meta.url), 'utf8');
    expect(reducedMotionDeclarations(css, '.wol-activity-dot')).toMatchObject({
      animation: 'none', transition: 'none',
    });
    expect(reducedMotionDeclarations(css, '.onboarding-spotlight *')).toMatchObject({
      animation: 'none', transition: 'none',
    });
    expect(reducedMotionDeclarations(css, '.wol-activity-card')).toMatchObject({
      animation: 'none', transition: 'none',
    });
    expect(reducedMotionDeclarations(shellCss, '.wol-marquee-track')).toMatchObject({
      animation: 'none', transform: 'none',
    });
  });
});

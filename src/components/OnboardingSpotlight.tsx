import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getFocusLoopTarget } from './AccessibleDialog';
import { UI_PRESENTATION } from '../uiPresentation';

export interface OnboardingStep {
  id: string;
  selector: string;
  title: string;
  description: string;
  actionLabel?: string;
  wholePanel?: boolean;
  /** Keep the instruction when its control is hidden or cannot be highlighted. */
  allowUnhighlighted?: boolean;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'wallet',
    selector: UI_PRESENTATION.showLegacyLobby ? '[data-tour-target="wallet"]' : '[data-tour-target="identity"]',
    title: 'Welcome to the village',
    description: 'Play as a guest, or sign in to save your match history.',
  },
  {
    id: 'promotions',
    selector: UI_PRESENTATION.showLegacyLobby ? '[data-tour-target="promotions"]' : '[data-tour-target="bgm-player"]',
    title: UI_PRESENTATION.showLegacyLobby ? 'You and the AI village' : 'Background Music',
    description: UI_PRESENTATION.showLegacyLobby
      ? 'Play Werewolf with AI players on a 9- or 12-player board.'
      : 'Play, pause, or switch Jianghu instrumental tracks anytime here.',
  },
  {
    id: 'navigation',
    selector: '[data-tour-target="navigation"]',
    title: 'Shop',
    description: 'Browse skins and customize your look.',
  },
  {
    id: 'start-game',
    selector: '[data-tour-target="start-game"]',
    title: 'Start Game',
    description: 'Ready to play? Start your first match.',
    actionLabel: 'Start Game',
  },
] as const;

export const SINGLE_PLAYER_GUIDE: readonly OnboardingStep[] = [{
  id: 'single-player',
  selector: '[data-tour-target="single-player"]',
  title: 'Single-Player',
  description: 'Select Single-Player to try a match with AI players.',
  actionLabel: 'Single-Player',
}];

export const MATCH_SETUP_GUIDE: readonly OnboardingStep[] = [{
  id: 'match-setup',
  selector: '[data-tour-target="match-setup"]',
  title: 'Make it your game',
  description: 'Choose your board, difficulty, and dialogue model.',
  wholePanel: true,
}];

interface Props {
  open: boolean;
  onSkip: () => void;
  onFinish: () => void;
  steps?: readonly OnboardingStep[];
  stepOffset?: number;
  totalSteps?: number;
}

export interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type OnboardingPanelPlacement = 'top' | 'bottom';

export interface OnboardingArrowLayout {
  top: number;
  left: number;
  width: number;
  height: number;
  placement: 'above' | 'below';
}

export interface OnboardingViewportPlan {
  panelPlacement: OnboardingPanelPlacement;
  scrollDeltaY: number;
  targetRect: HighlightRect;
  highlightRect: HighlightRect;
  arrow: OnboardingArrowLayout;
  safeTop: number;
  safeBottom: number;
  targetVisible: boolean;
  highlightVisible: boolean;
  arrowVisible: boolean;
  avoidsPanel: boolean;
}

interface AttributeSnapshot {
  present: boolean;
  value: string | null;
}

interface StyleSnapshot {
  overflow: string;
  overscrollBehavior: string;
  touchAction: string;
}

export type OnboardingModalDocument = Pick<
  Document,
  'activeElement' | 'body' | 'documentElement' | 'querySelector' | 'defaultView' | 'createElement'
>;

const HIGHLIGHT_PADDING = 6;
const VIEWPORT_EDGE = 8;
const PANEL_GAP = 12;
const ARROW_WIDTH = 40;
const ARROW_HEIGHT = 46;
const MAX_POSITION_ATTEMPTS = 4;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

const rectBottom = (rect: HighlightRect): number => rect.top + rect.height;
const rectRight = (rect: HighlightRect): number => rect.left + rect.width;

const rectsOverlap = (first: HighlightRect, second: HighlightRect): boolean =>
  first.left < rectRight(second)
  && rectRight(first) > second.left
  && first.top < rectBottom(second)
  && rectBottom(first) > second.top;

const rectIsInsideViewport = (
  rect: HighlightRect,
  viewportWidth: number,
  viewportHeight: number,
): boolean => rect.top >= 0
  && rect.left >= 0
  && rectBottom(rect) <= viewportHeight
  && rectRight(rect) <= viewportWidth;

const toHighlightRect = (
  rect: Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>,
): HighlightRect => ({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });

export const findAvailableOnboardingStep = (
  startIndex: number,
  direction: 1 | -1,
  hasTarget: (selector: string) => boolean,
  steps: readonly OnboardingStep[] = ONBOARDING_STEPS,
): number | null => {
  for (let index = startIndex; index >= 0 && index < steps.length; index += direction) {
    if (steps[index].allowUnhighlighted || hasTarget(steps[index].selector)) return index;
  }
  return null;
};

export const getOnboardingPanelPlacement = (
  _rect: HighlightRect,
  _viewportHeight: number,
): OnboardingPanelPlacement => 'bottom';

export const getOnboardingArrowLayout = (
  rect: HighlightRect,
  viewportHeight: number,
  options: {
    viewportWidth?: number;
    safeTop?: number;
    safeBottom?: number;
  } = {},
): OnboardingArrowLayout => {
  const viewportWidth = options.viewportWidth ?? Number.POSITIVE_INFINITY;
  const safeTop = clamp(options.safeTop ?? VIEWPORT_EDGE, 0, viewportHeight);
  const safeBottom = clamp(options.safeBottom ?? viewportHeight - VIEWPORT_EDGE, safeTop, viewportHeight);
  const aboveTop = rect.top - ARROW_HEIGHT - 8;
  const belowTop = rectBottom(rect) + 8;
  let top: number;
  let placement: OnboardingArrowLayout['placement'];

  if (aboveTop >= safeTop && aboveTop + ARROW_HEIGHT <= safeBottom) {
    top = aboveTop;
    placement = 'above';
  } else if (belowTop >= safeTop && belowTop + ARROW_HEIGHT <= safeBottom) {
    top = belowTop;
    placement = 'below';
  } else {
    top = clamp(rect.top + (rect.height - ARROW_HEIGHT) / 2, safeTop, safeBottom - ARROW_HEIGHT);
    placement = top + ARROW_HEIGHT / 2 <= rect.top + rect.height / 2 ? 'above' : 'below';
  }

  const maximumLeft = Number.isFinite(viewportWidth)
    ? Math.max(VIEWPORT_EDGE, viewportWidth - ARROW_WIDTH - VIEWPORT_EDGE)
    : Number.POSITIVE_INFINITY;
  return {
    top,
    left: clamp(rect.left + rect.width / 2 - ARROW_WIDTH / 2, VIEWPORT_EDGE, maximumLeft),
    width: ARROW_WIDTH,
    height: ARROW_HEIGHT,
    placement,
  };
};

export const getOnboardingHighlightRect = (
  rect: HighlightRect,
  viewportWidth: number,
  viewportHeight: number,
): HighlightRect => {
  const top = Math.max(0, rect.top - HIGHLIGHT_PADDING);
  const left = Math.max(0, rect.left - HIGHLIGHT_PADDING);
  const bottom = Math.min(viewportHeight, rectBottom(rect) + HIGHLIGHT_PADDING);
  const right = Math.min(viewportWidth, rectRight(rect) + HIGHLIGHT_PADDING);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
};

/** Plans one generic scroll so the real target and every spotlight visual avoid the measured panel. */
export const planOnboardingViewport = (
  targetRect: HighlightRect,
  panelRect: HighlightRect,
  panelPlacement: OnboardingPanelPlacement,
  viewportWidth: number,
  viewportHeight: number,
): OnboardingViewportPlan => {
  const safeTop = panelPlacement === 'top'
    ? Math.min(viewportHeight, rectBottom(panelRect) + PANEL_GAP)
    : 0;
  const safeBottom = panelPlacement === 'bottom'
    ? Math.max(safeTop, panelRect.top - PANEL_GAP)
    : viewportHeight - VIEWPORT_EDGE - HIGHLIGHT_PADDING;
  const desiredTop = clamp(targetRect.top, safeTop, safeBottom - targetRect.height);
  const scrollDeltaY = targetRect.top - desiredTop;
  const projectedTarget = { ...targetRect, top: targetRect.top - scrollDeltaY };
  const highlightRect = getOnboardingHighlightRect(projectedTarget, viewportWidth, viewportHeight);
  const arrow = getOnboardingArrowLayout(projectedTarget, viewportHeight, {
    viewportWidth,
    safeTop: panelPlacement === 'top' ? rectBottom(panelRect) + VIEWPORT_EDGE : VIEWPORT_EDGE,
    safeBottom: panelPlacement === 'bottom' ? panelRect.top - VIEWPORT_EDGE : viewportHeight - VIEWPORT_EDGE,
  });
  const targetVisible = rectIsInsideViewport(projectedTarget, viewportWidth, viewportHeight)
    && projectedTarget.top >= safeTop
    && rectBottom(projectedTarget) <= safeBottom;
  const highlightVisible = rectIsInsideViewport(highlightRect, viewportWidth, viewportHeight);
  const arrowVisible = rectIsInsideViewport(arrow, viewportWidth, viewportHeight);
  const avoidsPanel = !rectsOverlap(projectedTarget, panelRect)
    && !rectsOverlap(highlightRect, panelRect)
    && !rectsOverlap(arrow, panelRect);

  return {
    panelPlacement,
    scrollDeltaY,
    targetRect: projectedTarget,
    highlightRect,
    arrow,
    safeTop,
    safeBottom,
    targetVisible,
    highlightVisible,
    arrowVisible,
    avoidsPanel,
  };
};

export const isOnboardingViewportPlanReady = (plan: OnboardingViewportPlan): boolean =>
  plan.targetVisible && plan.highlightVisible && plan.arrowVisible && plan.avoidsPanel;

export const getOnboardingFocusLoopTarget = (
  focusable: readonly HTMLElement[],
  current: HTMLElement | null,
  shiftKey: boolean,
): HTMLElement | null | undefined => getFocusLoopTarget(focusable, current, shiftKey);

const readAttribute = (element: Element, name: string): AttributeSnapshot => ({
  present: element.hasAttribute(name),
  value: element.getAttribute(name),
});

const restoreAttribute = (element: Element, name: string, snapshot: AttributeSnapshot): void => {
  if (snapshot.present) element.setAttribute(name, snapshot.value ?? '');
  else element.removeAttribute(name);
};

const readStyle = (element: HTMLElement): StyleSnapshot => ({
  overflow: element.style.overflow,
  overscrollBehavior: element.style.overscrollBehavior,
  touchAction: element.style.touchAction,
});

const restoreStyle = (element: HTMLElement, snapshot: StyleSnapshot): void => {
  element.style.overflow = snapshot.overflow;
  element.style.overscrollBehavior = snapshot.overscrollBehavior;
  element.style.touchAction = snapshot.touchAction;
};

/** Temporarily unlocks overflow within one JS turn for deterministic script-only scrolling. */
export const scrollOnboardingDocumentTo = (
  activeDocument: OnboardingModalDocument,
  left: number,
  top: number,
): void => {
  const view = activeDocument.defaultView;
  if (!view) return;
  const bodyOverflow = activeDocument.body.style.overflow;
  const rootOverflow = activeDocument.documentElement.style.overflow;
  const bodyScrollBehavior = activeDocument.body.style.scrollBehavior;
  const rootScrollBehavior = activeDocument.documentElement.style.scrollBehavior;
  try {
    activeDocument.body.style.overflow = 'auto';
    activeDocument.documentElement.style.overflow = 'auto';
    activeDocument.body.style.scrollBehavior = 'auto';
    activeDocument.documentElement.style.scrollBehavior = 'auto';
    view.scrollTo({ left, top: Math.max(0, top), behavior: 'auto' });
  } finally {
    activeDocument.body.style.overflow = bodyOverflow;
    activeDocument.documentElement.style.overflow = rootOverflow;
    activeDocument.body.style.scrollBehavior = bodyScrollBehavior;
    activeDocument.documentElement.style.scrollBehavior = rootScrollBehavior;
  }
};

/** Establishes a real modal boundary and returns an exact, idempotent restore. */
export const acquireOnboardingModalBoundary = (
  activeDocument: OnboardingModalDocument,
): (() => void) => {
  const shell = activeDocument.querySelector<HTMLElement>('.wol-shell')
    ?? activeDocument.querySelector<HTMLElement>('.game-room');
  const activeElement = activeDocument.activeElement as (Element & {
    focus?: (options?: FocusOptions) => void;
    isConnected?: boolean;
  }) | null;
  const previousFocus = typeof activeElement?.focus === 'function' ? activeElement : null;
  const bodyStyle = readStyle(activeDocument.body);
  const rootStyle = readStyle(activeDocument.documentElement);
  const shellAriaHidden = shell ? readAttribute(shell, 'aria-hidden') : null;
  const shellInert = shell ? readAttribute(shell, 'inert') : null;
  const openingScroll = activeDocument.defaultView
    ? { left: activeDocument.defaultView.scrollX, top: activeDocument.defaultView.scrollY }
    : null;
  const scrollSpacer = activeDocument.createElement('div');
  scrollSpacer.setAttribute('aria-hidden', 'true');
  scrollSpacer.setAttribute('data-onboarding-scroll-spacer', '');
  scrollSpacer.style.display = 'block';
  scrollSpacer.style.width = '1px';
  scrollSpacer.style.height = `${Math.max(320, activeDocument.defaultView?.innerHeight ?? 0)}px`;
  scrollSpacer.style.flex = '0 0 auto';
  scrollSpacer.style.opacity = '0';
  scrollSpacer.style.pointerEvents = 'none';
  activeDocument.body.appendChild(scrollSpacer);

  if (shell) {
    shell.setAttribute('aria-hidden', 'true');
    shell.setAttribute('inert', '');
  }
  for (const element of [activeDocument.body, activeDocument.documentElement]) {
    element.style.overflow = 'hidden';
    element.style.overscrollBehavior = 'none';
    element.style.touchAction = 'none';
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (shell && shellAriaHidden && shellInert) {
      restoreAttribute(shell, 'aria-hidden', shellAriaHidden);
      restoreAttribute(shell, 'inert', shellInert);
    }
    restoreStyle(activeDocument.body, bodyStyle);
    restoreStyle(activeDocument.documentElement, rootStyle);
    if (openingScroll) scrollOnboardingDocumentTo(activeDocument, openingScroll.left, openingScroll.top);
    scrollSpacer.remove();
    if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
  };
};

interface LayerProps {
  step: OnboardingStep;
  stepIndex: number;
  rect: HighlightRect;
  viewportWidth?: number;
  viewportHeight: number;
  panelPlacement?: OnboardingPanelPlacement;
  highlightRect?: HighlightRect;
  arrowLayout?: OnboardingArrowLayout;
  showTarget?: boolean;
  positioning?: boolean;
  isFirst: boolean;
  stepCount?: number;
  panelRef?: React.RefObject<HTMLDivElement>;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onTargetAction?: () => void;
}

/** Presentational layer exported so semantic controls can be DOM-rendered in tests. */
export const OnboardingSpotlightLayer: React.FC<LayerProps> = ({
  step,
  stepIndex,
  rect,
  viewportWidth = Number.POSITIVE_INFINITY,
  viewportHeight,
  panelPlacement = getOnboardingPanelPlacement(rect, viewportHeight),
  highlightRect = getOnboardingHighlightRect(rect, viewportWidth, viewportHeight),
  arrowLayout = getOnboardingArrowLayout(rect, viewportHeight, { viewportWidth }),
  showTarget = true,
  positioning = false,
  isFirst,
  stepCount = ONBOARDING_STEPS.length,
  panelRef,
  onBack,
  onNext,
  onSkip,
  onTargetAction,
}) => (
  <div
    className={`onboarding-spotlight${positioning ? ' onboarding-spotlight--positioning' : ''}${showTarget ? '' : ' onboarding-spotlight--unhighlighted'}`}
    role="dialog"
    aria-modal="true"
    aria-busy={positioning}
    aria-labelledby="onboarding-title"
    aria-describedby="onboarding-description onboarding-position"
    data-target-step={step.id}
    data-positioning={positioning ? 'true' : 'false'}
  >
    {showTarget && <div
      key={`highlight-${step.id}-${positioning ? 'positioning' : 'ready'}`}
      className="onboarding-highlight"
      style={highlightRect}
      aria-hidden="true"
    />}
    {showTarget && step.actionLabel && onTargetAction && !positioning && (
      <button
        type="button"
        className="onboarding-target-action"
        style={rect}
        aria-label={step.actionLabel}
        onClick={onTargetAction}
      />
    )}
    {showTarget && <svg
      key={`arrow-${step.id}-${positioning ? 'positioning' : 'ready'}`}
      className={`onboarding-direction-arrow onboarding-direction-arrow--${arrowLayout.placement}`}
      style={{ top: arrowLayout.top, left: arrowLayout.left }}
      viewBox="0 0 40 46"
      role="img"
      aria-label={`Arrow pointing to ${step.title}`}
    >
      <path className="onboarding-direction-arrow__stroke" d="M20 4c-7 7-7 16 0 25" />
      <path className="onboarding-direction-arrow__stroke" d="M10 24l10 12 10-12" />
      <circle cx="7" cy="10" r="2" />
      <circle cx="33" cy="15" r="1.5" />
    </svg>}
    <div
      ref={panelRef}
      className={`onboarding-panel onboarding-panel--${panelPlacement}`}
    >
      <p id="onboarding-position" className="economy-eyebrow">Step {stepIndex + 1} of {stepCount}</p>
      <h2 id="onboarding-title">{step.title}</h2>
      <p id="onboarding-description">{step.description}</p>
      <div className="onboarding-actions">
        <button type="button" onClick={onBack} disabled={positioning || isFirst}>Back</button>
        <button type="button" className="economy-primary-action" onClick={onNext} disabled={positioning}>Next</button>
        <button type="button" onClick={onSkip}>Skip</button>
      </div>
    </div>
  </div>
);

interface SpotlightLayout {
  rect: HighlightRect;
  viewportWidth: number;
  viewportHeight: number;
  panelPlacement: OnboardingPanelPlacement;
  positioning: boolean;
  showTarget?: boolean;
  highlightRect?: HighlightRect;
  arrow?: OnboardingArrowLayout;
}

const OnboardingSpotlight: React.FC<Props> = ({ open, onSkip, onFinish, steps = ONBOARDING_STEPS, stepOffset = 0, totalSteps = steps.length }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [layout, setLayout] = useState<SpotlightLayout | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const step = steps[stepIndex];
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    return acquireOnboardingModalBoundary(document);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    setLayout(null);
    const element = document.querySelector<HTMLElement>(step.selector);
    targetRef.current = element;
    if (!element && !step.allowUnhighlighted) {
      const next = findAvailableOnboardingStep(stepIndex + 1, 1, selector => Boolean(document.querySelector(selector)), steps);
      if (next === null) onSkipRef.current();
      else setStepIndex(next);
      return undefined;
    }

    const originalTargetStyle = element
      ? { maxHeight: element.style.maxHeight, overflowY: element.style.overflowY, scrollTop: element.scrollTop }
      : null;
    const beginPositioning = () => {
      const bounds = element ? toHighlightRect(element.getBoundingClientRect()) : { top: 0, left: 0, width: 0, height: 0 };
      const showTarget = bounds.width > 0 && bounds.height > 0;
      setLayout({
        rect: bounds,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        panelPlacement: getOnboardingPanelPlacement(bounds, window.innerHeight),
        positioning: showTarget || !step.allowUnhighlighted,
        showTarget: showTarget || !step.allowUnhighlighted,
      });
    };
    const shell = document.querySelector<HTMLElement>('.wol-shell');
    shell?.setAttribute('data-onboarding-step', step.id);
    beginPositioning();
    window.addEventListener('resize', beginPositioning);
    return () => {
      targetRef.current = null;
      if (element && originalTargetStyle) {
        element.style.maxHeight = originalTargetStyle.maxHeight;
        element.style.overflowY = originalTargetStyle.overflowY;
        element.scrollTop = originalTargetStyle.scrollTop;
      }
      shell?.removeAttribute('data-onboarding-step');
      shell?.style.removeProperty('--onboarding-panel-space');
      window.removeEventListener('resize', beginPositioning);
    };
  }, [open, step.selector, stepIndex, steps]);

  useLayoutEffect(() => {
    if (!open || !layout?.positioning || !panelRef.current || !targetRef.current) return undefined;
    let cancelled = false;
    const animationFrames: number[] = [];

    const afterLayout = (callback: () => void) => {
      const first = window.requestAnimationFrame(() => {
        const second = window.requestAnimationFrame(callback);
        animationFrames.push(second);
      });
      animationFrames.push(first);
    };

    const positionTarget = (attempt: number) => {
      if (cancelled || !panelRef.current || !targetRef.current) return;
      const shell = document.querySelector<HTMLElement>('.wol-shell');
      shell?.style.setProperty('--onboarding-panel-space', `${window.innerHeight - panelRef.current.getBoundingClientRect().top + 18}px`);
      const panelRect = toHighlightRect(panelRef.current.getBoundingClientRect());
      if (step.wholePanel) {
        // Bound the actual form, rather than cutting its highlight through a control.
        // The sticky launch button remains fully visible when the options need scrolling.
        const arrowSpace = ARROW_HEIGHT + VIEWPORT_EDGE + 8;
        targetRef.current.style.maxHeight = `${Math.max(44, panelRect.top - PANEL_GAP - HIGHLIGHT_PADDING - arrowSpace)}px`;
        targetRef.current.style.overflowY = 'auto';
      }
      const targetRect = toHighlightRect(targetRef.current.getBoundingClientRect());
      const plan = planOnboardingViewport(
        targetRect,
        panelRect,
        layout.panelPlacement,
        window.innerWidth,
        window.innerHeight,
      );

      if (isOnboardingViewportPlanReady(plan) && Math.abs(plan.scrollDeltaY) < 0.5) {
        setLayout({
          rect: targetRect,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          panelPlacement: layout.panelPlacement,
          positioning: false,
          highlightRect: plan.highlightRect,
          arrow: plan.arrow,
        });
        return;
      }

      // Desktop-only tips still count on narrow or short boards. Avoid moving
      // the entire match when the target cannot fit above the hint.
      if (step.allowUnhighlighted) {
        setLayout({ ...layout, rect: targetRect, positioning: false, showTarget: false });
        return;
      }

      if (attempt >= MAX_POSITION_ATTEMPTS || Math.abs(plan.scrollDeltaY) < 0.5) {
        onSkipRef.current();
        return;
      }

      scrollOnboardingDocumentTo(document, window.scrollX, window.scrollY + plan.scrollDeltaY);
      afterLayout(() => positionTarget(attempt + 1));
    };

    positionTarget(0);
    return () => {
      cancelled = true;
      for (const frame of animationFrames) window.cancelAnimationFrame(frame);
    };
  }, [layout?.panelPlacement, layout?.positioning, open, stepIndex, step.wholePanel]);

  useEffect(() => {
    if (!open || !layout || layout.positioning) return undefined;
    const animationFrame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [layout, open, stepIndex]);

  const actions = {
    back: () => {
      const previous = findAvailableOnboardingStep(stepIndex - 1, -1, selector => Boolean(document.querySelector(selector)), steps);
      if (previous !== null) setStepIndex(previous);
    },
    next: () => {
      if (step.actionLabel) {
        if (step.id === 'start-game') onFinish();
        targetRef.current?.click();
        return;
      }
      const next = findAvailableOnboardingStep(stepIndex + 1, 1, selector => Boolean(document.querySelector(selector)), steps);
      if (next !== null) setStepIndex(next);
      else onFinish();
    },
  };

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onSkip();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.parentElement!.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = getOnboardingFocusLoopTarget(focusable, current, event.shiftKey);
      if (target !== undefined) {
        event.preventDefault();
        (target ?? panelRef.current).focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onSkip, open]);

  if (!open || !layout || typeof document === 'undefined') return null;
  const isFirst = findAvailableOnboardingStep(stepIndex - 1, -1, selector => Boolean(document.querySelector(selector)), steps) === null;

  return createPortal(
    <OnboardingSpotlightLayer
      step={step}
      stepIndex={stepIndex + stepOffset}
      rect={layout.rect}
      viewportWidth={layout.viewportWidth}
      viewportHeight={layout.viewportHeight}
      panelPlacement={layout.panelPlacement}
      positioning={layout.positioning}
      highlightRect={layout.highlightRect}
      arrowLayout={layout.arrow}
      showTarget={layout.showTarget}
      isFirst={isFirst}
      stepCount={totalSteps}
      panelRef={panelRef}
      onBack={actions.back}
      onNext={actions.next}
      onSkip={onSkip}
      onTargetAction={actions.next}
    />,
    document.body,
  );
};

export default OnboardingSpotlight;

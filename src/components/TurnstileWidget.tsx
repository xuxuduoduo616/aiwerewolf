import React, { useEffect, useRef } from 'react';

export interface TurnstileWidgetProps {
  siteKey: string;
  onVerify: (token: string) => void;
  onError?: () => void;
  onExpired?: () => void;
}

export interface TurnstileRenderOptions {
  sitekey: string;
  theme: 'dark';
  language: 'en';
  size?: 'normal' | 'compact';
  callback: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
}

export const createTurnstileRenderOptions = ({
  siteKey,
  onVerify,
  onError,
  onExpired,
}: TurnstileWidgetProps): TurnstileRenderOptions => ({
  sitekey: siteKey,
  theme: 'dark',
  language: 'en',
  callback: onVerify,
  'error-callback': onError,
  'expired-callback': onExpired,
});

/**
 * Cloudflare Turnstile widget wrapper.
 * Renders the Turnstile captcha and calls onVerify with the token on success.
 */
const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({ siteKey, onVerify, onError, onExpired }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onVerify, onError, onExpired });
  callbacks.current = { onVerify, onError, onExpired };

  useEffect(() => {
    let disposed = false;
    let widgetId: string | undefined;
    let widgetSize: 'normal' | 'compact' | undefined;

    const container = containerRef.current;
    if (!container) return;

    // Load Turnstile script once
    const existingScript = document.querySelector('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]');
    const loadWidget = () => {
      if (!disposed && window.turnstile) {
        const size = (container.parentElement?.clientWidth ?? 300) < 300 ? 'compact' : 'normal';
        if (widgetId && widgetSize === size) return;
        if (widgetId) { window.turnstile.remove(widgetId); callbacks.current.onExpired?.(); }
        widgetSize = size;
        container.style.minHeight = size === 'compact' ? '140px' : '65px';
        widgetId = window.turnstile.render(container, { ...createTurnstileRenderOptions({
          siteKey,
          onVerify: token => callbacks.current.onVerify(token),
          onError: () => callbacks.current.onError?.(),
          onExpired: () => callbacks.current.onExpired?.(),
        }), size });
      }
    };

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.addEventListener('load', loadWidget);
      script.addEventListener('error', () => callbacks.current.onError?.(), { once: true });
      document.head.appendChild(script);
    } else if (window.turnstile) {
      loadWidget();
    } else {
      existingScript.addEventListener('load', loadWidget);
    }

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(loadWidget) : null;
    if (container.parentElement) resizeObserver?.observe(container.parentElement);

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      document.querySelector('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]')?.removeEventListener('load', loadWidget);
      if (widgetId && window.turnstile) {
        try { window.turnstile.remove(widgetId); } catch { /* ignore */ }
      }
    };
  }, [siteKey]);

  return <div ref={containerRef} style={{ minHeight: 65 }} />;
};

// Extend Window interface for turnstile
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

export default TurnstileWidget;

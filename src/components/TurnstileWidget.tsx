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
  const mounted = useRef(false);

  useEffect(() => {
    // Prevent double-render in StrictMode
    if (mounted.current) return;
    mounted.current = true;

    const container = containerRef.current;
    if (!container) return;

    // Load Turnstile script once
    const existingScript = document.querySelector('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]');
    const loadWidget = () => {
      if (window.turnstile) {
        window.turnstile.render(container, createTurnstileRenderOptions({
          siteKey,
          onVerify,
          onError,
          onExpired,
        }));
      }
    };

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = loadWidget;
      document.head.appendChild(script);
    } else if (window.turnstile) {
      loadWidget();
    } else {
      existingScript.addEventListener('load', loadWidget);
    }

    return () => {
      // Cleanup: try to remove the widget if still mounted
      if (container && window.turnstile) {
        try { window.turnstile.remove(container); } catch { /* ignore */ }
      }
    };
  }, [siteKey, onVerify, onError, onExpired]);

  return <div ref={containerRef} style={{ minHeight: 65 }} />;
};

// Extend Window interface for turnstile
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
      remove: (el: HTMLElement) => void;
      reset: (widgetId: string) => void;
    };
  }
}

export default TurnstileWidget;

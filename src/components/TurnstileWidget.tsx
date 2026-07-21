import React, { useEffect, useRef } from 'react';

interface Props {
  siteKey: string;
  onVerify: (token: string) => void;
  onError?: () => void;
  onExpired?: () => void;
}

/**
 * Cloudflare Turnstile widget wrapper.
 * Renders the Turnstile captcha and calls onVerify with the token on success.
 */
const TurnstileWidget: React.FC<Props> = ({ siteKey, onVerify, onError, onExpired }) => {
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
        window.turnstile.render(container, {
          sitekey: siteKey,
          theme: 'dark',
          callback: onVerify,
          'error-callback': onError,
          'expired-callback': onExpired,
        });
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
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (el: HTMLElement) => void;
      reset: (widgetId: string) => void;
    };
  }
}

export default TurnstileWidget;

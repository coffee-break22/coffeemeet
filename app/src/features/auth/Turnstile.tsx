import { useEffect, useId, useRef } from "react";

declare global { interface Window { turnstile?: { render: (container: HTMLElement, options: Record<string, unknown>) => string; remove: (widgetId: string) => void; reset: (widgetId: string) => void; }; } }
const SCRIPT_ID = "cloudflare-turnstile";
export function Turnstile({ onToken, resetKey }: { onToken: (token: string) => void; resetKey?: number }) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
  const elementId = useId().replace(/:/g, ""), widget = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    const mount = () => { const target = document.getElementById(elementId); if (cancelled || !target || !window.turnstile || widget.current) return; widget.current = window.turnstile.render(target, { sitekey: siteKey, theme: "light", language: "es", callback: (token: string) => onToken(token), "expired-callback": () => onToken(""), "error-callback": () => onToken("") }); };
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) { script = document.createElement("script"); script.id = SCRIPT_ID; script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; script.async = true; script.defer = true; document.head.appendChild(script); }
    script.addEventListener("load", mount); mount();
    return () => { cancelled = true; script?.removeEventListener("load", mount); if (widget.current && window.turnstile) window.turnstile.remove(widget.current); widget.current = undefined; };
  }, [elementId, onToken, siteKey]);
  useEffect(() => { if (widget.current && window.turnstile) { window.turnstile.reset(widget.current); onToken(""); } }, [onToken, resetKey]);
  if (!siteKey) return null;
  return <div className="turnstile-wrap" id={elementId} aria-label="Verificación de seguridad" />;
}

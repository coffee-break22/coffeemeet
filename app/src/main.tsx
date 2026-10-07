import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AuthProvider } from "./features/auth/AuthContext.tsx";
import { logoUrl } from "./brandAssets.ts";
import { ToastProvider } from "./features/feedback/ToastProvider.tsx";

if (logoUrl) {
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) {
    favicon.href = logoUrl;
    favicon.type = logoUrl.endsWith(".svg")
      ? "image/svg+xml"
      : logoUrl.endsWith(".webp")
        ? "image/webp"
        : logoUrl.match(/\.jpe?g$/)
          ? "image/jpeg"
          : "image/png";
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
);

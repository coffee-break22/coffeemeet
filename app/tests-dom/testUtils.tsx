import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { AuthProvider } from "../src/features/auth/AuthContext.tsx";
import { ToastProvider } from "../src/features/feedback/ToastProvider.tsx";

export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions,
) {
  return render(
    <AuthProvider>
      <ToastProvider>{ui}</ToastProvider>
    </AuthProvider>,
    options,
  );
}

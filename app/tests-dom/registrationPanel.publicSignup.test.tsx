import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "./mocks/supabaseClient.ts";
import { RegistrationPanel } from "../src/features/registration/RegistrationPanel.tsx";
import { renderWithProviders } from "./testUtils.tsx";

vi.mock("../src/infrastructure/supabase/client.ts", async () => {
  const { createSupabaseMock } = await import("./mocks/supabaseClient.ts");
  const mock = createSupabaseMock();
  (globalThis as Record<string, unknown>).__supabaseMock = mock;
  return { isSupabaseConfigured: true, supabase: mock.client };
});

function getMock() {
  return (globalThis as Record<string, unknown>)
    .__supabaseMock as ReturnType<typeof createSupabaseMock>;
}

afterEach(() => {
  getMock().client.rpc.mockClear();
  getMock().client.auth.signUp.mockClear();
});

describe("RegistrationPanel · alta pública con Supabase simulado", () => {
  it(
    "crea la cuenta y guarda la inscripción vía submit_weekly_registration_v2",
    async () => {
      const mock = getMock();
      mock.setSignUpUser({
        id: "user-ana",
        email: "ana@example.com",
        user_metadata: { full_name: "Ana Pérez" },
        app_metadata: { provider: "email" },
        identities: [{ id: "identity-1" }],
      });
      mock.setRpc("submit_weekly_registration_v2", () => ({
        data: null,
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<RegistrationPanel publicSignup />);

      await user.type(screen.getByLabelText("Nombre completo"), "Ana Pérez");
      await user.type(
        screen.getByPlaceholderText("300 123 4567"),
        "3001234567",
      );
      await user.type(screen.getByLabelText(/^Correo/), "ana@example.com");
      await user.type(screen.getByLabelText(/^Contraseña/), "supersecreta");
      await user.type(
        screen.getByLabelText(/^LinkedIn/),
        "https://linkedin.com/in/ana",
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /Siguiente/ }),
        ).toBeEnabled(),
      );
      await user.click(screen.getByRole("button", { name: /Siguiente/ }));

      await user.click(screen.getByText("Bogotá"));
      await user.click(screen.getByText("Café Centro"));
      await user.click(screen.getByRole("button", { name: /Siguiente/ }));

      await user.click(screen.getByText("Martes"));
      await user.click(screen.getByText("08:00"));
      await user.click(screen.getByRole("button", { name: /Siguiente/ }));

      await user.click(
        screen.getByRole("button", { name: /Confirmar inscripción/ }),
      );

      await waitFor(() => {
        expect(mock.client.auth.signUp).toHaveBeenCalledWith(
          expect.objectContaining({
            email: "ana@example.com",
            password: "supersecreta",
          }),
        );
      });
      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "submit_weekly_registration_v2",
          expect.objectContaining({
            p_full_name: "Ana Pérez",
            p_contact_email: "ana@example.com",
            p_city: "Bogotá",
            p_week_code: "2026-W36",
          }),
        );
      });
      await screen.findByText(/Quedaste inscrito/i);
    },
    15000,
  );
});

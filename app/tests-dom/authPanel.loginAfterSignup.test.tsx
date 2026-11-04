import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "./mocks/supabaseClient.ts";
import { AuthPanel } from "../src/features/auth/AuthPanel.tsx";
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

describe("AuthPanel · iniciar sesión justo después de un registro público", () => {
  it(
    "cambia a 'Mi cuenta' en vez de quedarse atascado en la landing (regresión 2026-09-24)",
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
      renderWithProviders(<AuthPanel showAccess />);

      await waitFor(() =>
        expect(screen.queryByText("Cargando sesión…")).not.toBeInTheDocument(),
      );
      const wizard = document.querySelector(".wizard-card") as HTMLElement;
      const registrationForm = within(wizard);

      await user.type(
        registrationForm.getByLabelText("Nombre completo"),
        "Ana Pérez",
      );
      await user.type(
        registrationForm.getByPlaceholderText("300 123 4567"),
        "3001234567",
      );
      await user.type(
        registrationForm.getByLabelText(/^Correo/),
        "ana@example.com",
      );
      await user.type(
        registrationForm.getByLabelText(/^Contraseña/),
        "supersecreta",
      );
      await user.type(
        registrationForm.getByLabelText(/^LinkedIn/),
        "https://linkedin.com/in/ana",
      );
      await waitFor(() =>
        expect(
          registrationForm.getByRole("button", { name: /Siguiente/ }),
        ).toBeEnabled(),
      );
      await user.click(
        registrationForm.getByRole("button", { name: /Siguiente/ }),
      );
      await user.click(registrationForm.getByText("Bogotá"));
      await user.click(registrationForm.getByText("Café Centro"));
      await user.click(
        registrationForm.getByRole("button", { name: /Siguiente/ }),
      );
      await user.click(registrationForm.getByText("Martes"));
      await user.click(registrationForm.getByText("08:00"));
      await user.click(
        registrationForm.getByRole("button", { name: /Siguiente/ }),
      );
      await user.click(
        registrationForm.getByRole("button", {
          name: /Confirmar inscripción/,
        }),
      );

      await screen.findByText(/Quedaste inscrito/i);
      // Landing sigue visible pese a que auth.user ya está definido:
      // keepLanding sigue en true justo después del alta pública.
      expect(screen.queryByText("Mi cuenta")).not.toBeInTheDocument();

      const accessSection = document.getElementById("acceso") as HTMLElement;
      const loginForm = within(accessSection);
      await user.type(loginForm.getByLabelText("Correo"), "ana@example.com");
      await user.type(loginForm.getByLabelText("Contraseña"), "supersecreta");
      await user.click(
        loginForm.getByRole("button", { name: /Iniciar sesión/ }),
      );

      await screen.findByText("Mi cuenta");
    },
    15000,
  );
});

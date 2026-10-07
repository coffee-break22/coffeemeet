import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "./mocks/supabaseClient.ts";
import {
  getSupabaseMock,
  installSupabaseMock,
} from "./mocks/installSupabaseMock.ts";
import { ProfilePanel } from "../src/features/registration/ProfilePanel.tsx";
import { renderWithProviders } from "./testUtils.tsx";

vi.mock("../src/infrastructure/supabase/client.ts", () =>
  installSupabaseMock(),
);

function getMock() {
  return getSupabaseMock() as ReturnType<typeof createSupabaseMock>;
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    full_name: "Ana Pérez",
    email: "ana@example.com",
    alumni_email: "ana@example.com",
    phone: "+573001234567",
    linkedin_url: "https://linkedin.com/in/ana",
    school: "harvard",
    graduation_year: 2020,
    verification_status: "approved",
    headline: "",
    bio: "",
    industry: "",
    current_role: "",
    interests: [],
    can_help_with: [],
    looking_for: [],
    avatar_url: "",
    profile_visibility: { email: true, phone: true, linkedin: true },
    ...overrides,
  };
}

describe("ProfilePanel · modo remoto (usuario real autenticado)", () => {
  it(
    "carga el perfil vía profiles.select y guarda con profiles.update",
    async () => {
      const mock = getMock();
      mock.setRpc("current_user_is_admin", () => ({
        data: false,
        error: null,
      }));
      mock.setLoggedIn({
        id: "user-1",
        email: "ana@example.com",
        user_metadata: {},
        app_metadata: {},
      });
      mock.setTable("profiles", () => ({
        data: profileRow(),
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<ProfilePanel />);

      await screen.findByRole("heading", { name: "Ana Pérez" });
      await user.type(
        screen.getByLabelText("Titular profesional (opcional)"),
        "Product Manager",
      );
      await user.click(screen.getByRole("button", { name: "Guardar perfil" }));

      await screen.findByText("Perfil guardado.");
      await waitFor(() =>
        expect(mock.client.from).toHaveBeenCalledWith("profiles"),
      );
    },
    15000,
  );

  it(
    "borrar cuenta pide confirmación, llama delete_account y cierra sesión",
    async () => {
      const mock = getMock();
      mock.setRpc("current_user_is_admin", () => ({
        data: false,
        error: null,
      }));
      mock.setLoggedIn({
        id: "user-1",
        email: "ana@example.com",
        user_metadata: {},
        app_metadata: {},
      });
      mock.setTable("profiles", () => ({
        data: profileRow(),
        error: null,
      }));
      mock.setRpc("delete_account", () => ({ data: null, error: null }));

      const user = userEvent.setup();
      renderWithProviders(<ProfilePanel />);

      await screen.findByText("Borrar tu cuenta");
      await user.click(screen.getByRole("button", { name: /Borrar cuenta/ }));
      await screen.findByText("Borrar cuenta", { selector: ".cm-swal-title" });
      await user.click(
        screen.getByRole("button", { name: "Sí, borrar mi cuenta" }),
      );

      await waitFor(() => {
        expect(
          mock.client.rpc.mock.calls.some((call) => call[0] === "delete_account"),
        ).toBe(true);
      });
      await waitFor(() =>
        expect(mock.client.auth.signOut).toHaveBeenCalled(),
      );
    },
    15000,
  );
});

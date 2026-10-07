import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "../mocks/supabaseClient.ts";
import {
  getSupabaseMock,
  installSupabaseMock,
  signInAsAdmin,
} from "../mocks/installSupabaseMock.ts";
import { ParticipantsPanel } from "../../src/features/admin/ParticipantsPanel.tsx";
import { renderWithProviders } from "../testUtils.tsx";

vi.mock("../../src/infrastructure/supabase/client.ts", () =>
  installSupabaseMock(),
);

function getMock() {
  return getSupabaseMock() as ReturnType<typeof createSupabaseMock>;
}

describe("ParticipantsPanel · modo remoto (admin autenticado)", () => {
  it(
    "pestaña Registrados carga get_admin_participants_page y borra con admin_delete_account",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_participants_page", () => ({
        data: {
          items: [
            {
              id: "user-1",
              fullName: "Ana Pérez",
              email: "ana@example.com",
              alumniEmail: "ana@example.com",
              phone: "+573001234567",
              linkedinUrl: "",
              school: "harvard",
              graduationYear: 2020,
              createdAt: "2026-09-01T00:00:00.000Z",
            },
          ],
          total: 1,
        },
        error: null,
      }));
      mock.setRpc("admin_delete_account", () => ({ data: null, error: null }));

      const user = userEvent.setup();
      renderWithProviders(<ParticipantsPanel />);

      await screen.findByText("Ana Pérez");
      await user.click(screen.getByText("Ana Pérez"));
      await user.click(screen.getByRole("button", { name: /Borrar cuenta/ }));
      const confirmButton = await screen.findByRole("button", {
        name: "Sí, borrar esta cuenta",
      });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "admin_delete_account",
          { p_user_id: "user-1" },
        );
      });
    },
    15000,
  );

  it(
    "pestaña 'semana previa' carga get_admin_confirmed_previous_week_page y filtra con chips",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_confirmed_previous_week_page", () => ({
        data: {
          items: [
            {
              id: "user-1",
              fullName: "Ana Pérez",
              email: "ana@example.com",
              phone: "+573001234567",
              school: "harvard",
              linkedin: "",
              status: "confirmed",
              confirmedAt: "2026-09-21T10:00:00.000Z",
            },
          ],
          total: 1,
          previousWeekCode: "2026-W38",
          previousWeekMonday: "2026-09-21",
          counts: { confirmed: 1, notConfirmed: 2, withdrawn: 0 },
        },
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<ParticipantsPanel />);
      await user.click(
        screen.getByRole("button", { name: /Confirmados — semana previa/ }),
      );

      await screen.findByText("Ana Pérez");
      expect(screen.getByText("Confirmaron")).toBeInTheDocument();

      mock.client.rpc.mockClear();
      await user.click(screen.getByText("Confirmaron"));

      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "get_admin_confirmed_previous_week_page",
          expect.objectContaining({ p_filter: "confirmed" }),
        );
      });
    },
    15000,
  );

  it(
    "pestaña 'en vivo' fuera de ventana muestra el aviso y no la lista",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_live_confirmations_page", () => ({
        data: {
          windowOpen: false,
          items: [],
          total: 0,
          counts: { confirmed: 0, pending: 0, withdrawn: 0 },
          opensAt: "",
          closesAt: "",
        },
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<ParticipantsPanel />);
      await user.click(
        screen.getByRole("button", {
          name: /Confirmaciones en vivo — semana actual/,
        }),
      );

      await screen.findByText(/Fuera de la ventana de confirmación/);
    },
    15000,
  );

  it(
    "pestaña 'en vivo' abierta permite retirar con admin_withdraw_weekly_participation",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_live_confirmations_page", () => ({
        data: {
          windowOpen: true,
          items: [
            {
              id: "user-1",
              fullName: "Ana Pérez",
              email: "ana@example.com",
              phone: "+573001234567",
              school: "harvard",
              status: "confirmed",
              confirmedAt: "2026-09-27T19:30:00.000Z",
            },
          ],
          total: 1,
          counts: { confirmed: 1, pending: 0, withdrawn: 0 },
          opensAt: "2026-09-27T19:00:00.000Z",
          closesAt: "2026-09-28T10:00:00.000Z",
        },
        error: null,
      }));
      mock.setRpc("admin_withdraw_weekly_participation", () => ({
        data: null,
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<ParticipantsPanel />);
      await user.click(
        screen.getByRole("button", {
          name: /Confirmaciones en vivo — semana actual/,
        }),
      );
      await user.click(await screen.findByText("Ana Pérez"));
      await user.click(
        screen.getByRole("button", { name: /Retirar de esta semana/ }),
      );
      const confirmButton = await screen.findByRole("button", {
        name: "Sí, retirar de esta semana",
      });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "admin_withdraw_weekly_participation",
          expect.objectContaining({ p_user_id: "user-1" }),
        );
      });
    },
    15000,
  );
});

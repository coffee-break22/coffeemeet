import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "../mocks/supabaseClient.ts";
import {
  getSupabaseMock,
  installSupabaseMock,
} from "../mocks/installSupabaseMock.ts";
import { AdminDashboard } from "../../src/features/admin/AdminDashboard.tsx";
import { renderWithProviders } from "../testUtils.tsx";

vi.mock("../../src/infrastructure/supabase/client.ts", () =>
  installSupabaseMock(),
);

function getMock() {
  return getSupabaseMock() as ReturnType<typeof createSupabaseMock>;
}

describe("AdminDashboard", () => {
  it(
    "sin Supabase configurado muestra el resumen vacío y navega con los botones de acción",
    async () => {
      const onNavigate = vi.fn();
      const user = userEvent.setup();
      renderWithProviders(<AdminDashboard onNavigate={onNavigate} />);

      await waitFor(() =>
        expect(
          screen.getByText(/Todavía no había participantes registrados/),
        ).toBeInTheDocument(),
      );
      expect(
        screen.getByText(
          "Se necesitan al menos 2 participantes confirmados la semana previa para calcularla.",
        ),
      ).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: /Revisar solicitudes/ }),
      );
      expect(onNavigate).toHaveBeenCalledWith("validations");

      await user.click(
        screen.getByRole("button", { name: /Ver participantes/ }),
      );
      expect(onNavigate).toHaveBeenCalledWith("participants");
    },
    15000,
  );

  it(
    "con datos remotos muestra los números y la ecuación de sostenibilidad",
    async () => {
      const mock = getMock();
      mock.setRpc("get_admin_overview", () => ({
        data: {
          approved: 20,
          pending: 3,
          rejected: 1,
          communityMembers: 30,
          previousWeekCode: "2026-W38",
          previousWeekMonday: "2026-09-21",
          configuredWeekStart: "2026-09-28",
          configuredWeekEnd: "2026-10-04",
          registeredAtCutoff: 18,
          confirmedLastWeek: {
            confirmed: 10,
            notConfirmed: 5,
            withdrawn: 3,
            registeredAtCutoff: 18,
          },
          meetingsLastWeek: { pairs: 4, people: 8, confirmedParticipants: 10 },
          sustainability: {
            confirmedParticipants: 10,
            possiblePairs: 45,
            completedPairs: 12,
            newPairsRemaining: 33,
            weeksLow: 4,
            weeksHigh: 6,
          },
        },
        error: null,
      }));

      renderWithProviders(<AdminDashboard onNavigate={vi.fn()} />);

      await screen.findByText("20");
      const pendingStat = screen
        .getByText("Solicitudes pendientes")
        .closest("article") as HTMLElement;
      expect(pendingStat).toHaveTextContent("3");
      const sustainability = screen
        .getByText("Sostenibilidad de parejas nuevas")
        .closest("article") as HTMLElement;
      expect(sustainability).toHaveTextContent("10 participantes confirmados");
      expect(sustainability).toHaveTextContent("4–6 semanas");
      expect(sustainability).toHaveTextContent("33");
    },
    15000,
  );

  it(
    "si get_admin_overview falla muestra el mensaje de error",
    async () => {
      const mock = getMock();
      mock.setRpc("get_admin_overview", () => ({
        data: null,
        error: { message: "boom" },
      }));

      renderWithProviders(<AdminDashboard onNavigate={vi.fn()} />);

      await screen.findByText("No pudimos cargar el resumen administrativo.");
    },
    15000,
  );
});

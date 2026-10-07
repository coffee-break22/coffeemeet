import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "../mocks/supabaseClient.ts";
import {
  getSupabaseMock,
  installSupabaseMock,
  signInAsAdmin,
} from "../mocks/installSupabaseMock.ts";
import { ReputationPanel } from "../../src/features/admin/ReputationPanel.tsx";
import { renderWithProviders } from "../testUtils.tsx";

vi.mock("../../src/infrastructure/supabase/client.ts", () =>
  installSupabaseMock(),
);

function getMock() {
  return getSupabaseMock() as ReturnType<typeof createSupabaseMock>;
}

const incidentRow = {
  case_id: "case-1",
  case_type: "incident",
  meeting_id: "meeting-1",
  meeting_status: "no_show",
  incident_id: "incident-1",
  incident_kind: "no_show",
  incident_status: "open",
  user_id: "user-1",
  user_name: "Bruno Silva",
  user_a_id: "user-1",
  user_a_name: "Bruno Silva",
  user_b_id: "user-2",
  user_b_name: "Ana Pérez",
  second_chance_id: null,
  occurred_at: "2026-09-20T18:00:00.000Z",
  reports: [],
};

const disputeRow = {
  case_id: "case-2",
  case_type: "dispute",
  meeting_id: "meeting-2",
  meeting_status: "disputed",
  incident_id: null,
  incident_kind: null,
  incident_status: null,
  user_id: null,
  user_name: null,
  user_a_id: "user-3",
  user_a_name: "Carla Ríos",
  user_b_id: "user-4",
  user_b_name: "Diego León",
  second_chance_id: null,
  occurred_at: "2026-09-21T18:00:00.000Z",
  reports: [
    {
      reporterId: "user-3",
      meetingOccurred: true,
      selfAttended: true,
      partnerAttended: false,
      comment: "No llegó",
      submittedAt: "2026-09-21T19:00:00.000Z",
    },
    {
      reporterId: "user-4",
      meetingOccurred: true,
      selfAttended: true,
      partnerAttended: true,
      comment: null,
      submittedAt: "2026-09-21T19:05:00.000Z",
    },
  ],
};

describe("ReputationPanel", () => {
  it("sin Supabase configurado muestra la lista vacía sin llamar RPC alguno", async () => {
    renderWithProviders(<ReputationPanel />);
    await waitFor(() =>
      expect(
        screen.getByText("No hay casos en esta vista."),
      ).toBeInTheDocument(),
    );
  });

  it(
    "carga get_admin_reputation_page y otorga una segunda oportunidad",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_reputation_page", () => ({
        data: { items: [incidentRow], total: 1 },
        error: null,
      }));
      mock.setRpc("grant_second_chance", () => ({ data: null, error: null }));

      const user = userEvent.setup();
      renderWithProviders(<ReputationPanel />);

      await screen.findByText("Bruno Silva");
      await user.click(screen.getByText("Bruno Silva"));
      const reasonBox = await screen.findByLabelText(
        /Motivo de la segunda oportunidad/,
      );
      const grantButton = screen.getByRole("button", {
        name: /Dar otra oportunidad/,
      });
      expect(grantButton).toBeDisabled();

      await user.type(reasonBox, "Justificó con evidencia");
      expect(grantButton).toBeEnabled();
      await user.click(grantButton);

      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "grant_second_chance",
          expect.objectContaining({
            p_incident_id: "incident-1",
            p_reason: "Justificó con evidencia",
          }),
        );
      });
    },
    15000,
  );

  it(
    "una disputa de asistencia muestra ambos reportes y resuelve con resolve_attendance_dispute",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_reputation_page", () => ({
        data: { items: [disputeRow], total: 1 },
        error: null,
      }));
      mock.setRpc("resolve_attendance_dispute", () => ({
        data: null,
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<ReputationPanel />);

      await user.click(await screen.findByText("Disputa"));
      expect(screen.getByText(/No llegó/)).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: /No-show: Carla Ríos/ }),
      );

      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "resolve_attendance_dispute",
          expect.objectContaining({
            p_meeting_id: "meeting-2",
            p_resolution: "no_show",
            p_responsible_user_id: "user-3",
          }),
        );
      });
    },
    15000,
  );

  it(
    "cambiar entre pestañas 'Requieren acción' e 'Historial' recarga con el filtro correcto",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_reputation_page", () => ({
        data: { items: [], total: 0 },
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<ReputationPanel />);

      await waitFor(() =>
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "get_admin_reputation_page",
          expect.objectContaining({ p_filter: "open" }),
        ),
      );

      await user.click(screen.getByRole("tab", { name: "Historial" }));

      await waitFor(() =>
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "get_admin_reputation_page",
          expect.objectContaining({ p_filter: "all" }),
        ),
      );
    },
    15000,
  );
});

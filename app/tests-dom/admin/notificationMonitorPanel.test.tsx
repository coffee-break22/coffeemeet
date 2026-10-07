import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "../mocks/supabaseClient.ts";
import {
  getSupabaseMock,
  installSupabaseMock,
} from "../mocks/installSupabaseMock.ts";
import { NotificationMonitorPanel } from "../../src/features/admin/NotificationMonitorPanel.tsx";
import { renderWithProviders } from "../testUtils.tsx";

vi.mock("../../src/infrastructure/supabase/client.ts", () =>
  installSupabaseMock(),
);

function getMock() {
  return getSupabaseMock() as ReturnType<typeof createSupabaseMock>;
}

describe("NotificationMonitorPanel", () => {
  it("sin Supabase configurado muestra listas vacías y error de conexión", async () => {
    renderWithProviders(<NotificationMonitorPanel />);
    await waitFor(() =>
      expect(
        screen.getByText("No hay notificaciones en esta vista"),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByText("No pudimos consultar la conexión de WhatsApp."),
      ).toBeInTheDocument(),
    );
  });

  it(
    "carga la tabla y los contadores, y reintenta un job fallido",
    async () => {
      const mock = getMock();
      mock.setRpc("get_admin_notification_page", () => ({
        data: [
          {
            id: "job-1",
            kind: "match_whatsapp",
            status: "failed",
            attempt_count: 8,
            next_attempt_at: "2026-09-25T10:00:00.000Z",
            last_error: "timeout",
            created_at: "2026-09-25T09:00:00.000Z",
            processed_at: null,
            payload: {},
            destination_name: "Ana Pérez",
            destination_phone: "+573001234567",
          },
        ],
        error: null,
      }));
      mock.setRpc("get_admin_notification_summary", () => ({
        data: { pending: 1, processing: 0, succeeded: 5, failed: 1, cancelled: 0 },
        error: null,
      }));
      mock.setRpc("get_admin_whatsapp_state", () => ({
        data: [
          {
            status: "connected",
            qr_data_url: null,
            phone: "573000000000",
            connected_at: "2026-09-25T08:00:00.000Z",
            heartbeat_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_error: null,
            requested_command: null,
          },
        ],
        error: null,
      }));
      mock.setRpc("retry_notification", () => ({ data: null, error: null }));

      const user = userEvent.setup();
      renderWithProviders(<NotificationMonitorPanel />);

      await screen.findByText("Ana Pérez");
      expect(screen.getByText("Conectado")).toBeInTheDocument();
      expect(screen.getByText("Worker activo")).toBeInTheDocument();
      expect(screen.getByText("Número vinculado: +573000000000")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Reintentar/ }));

      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith("retry_notification", {
          p_id: "job-1",
        });
      });
    },
    15000,
  );

  it(
    "muestra el QR cuando el estado es awaiting_qr",
    async () => {
      const mock = getMock();
      mock.setRpc("get_admin_notification_page", () => ({
        data: [],
        error: null,
      }));
      mock.setRpc("get_admin_notification_summary", () => ({
        data: { pending: 0, processing: 0, succeeded: 0, failed: 0, cancelled: 0 },
        error: null,
      }));
      mock.setRpc("get_admin_whatsapp_state", () => ({
        data: [
          {
            status: "awaiting_qr",
            qr_data_url: "data:image/png;base64,ABC123",
            phone: null,
            connected_at: null,
            heartbeat_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_error: null,
            requested_command: null,
          },
        ],
        error: null,
      }));

      renderWithProviders(<NotificationMonitorPanel />);

      await screen.findByText("Esperando escaneo");
      expect(
        screen.getByAltText("QR para vincular WhatsApp"),
      ).toBeInTheDocument();
    },
    15000,
  );

  it(
    "cerrar sesión de WhatsApp pide confirmación antes de llamar al comando",
    async () => {
      const mock = getMock();
      mock.setRpc("get_admin_notification_page", () => ({
        data: [],
        error: null,
      }));
      mock.setRpc("get_admin_notification_summary", () => ({
        data: { pending: 0, processing: 0, succeeded: 0, failed: 0, cancelled: 0 },
        error: null,
      }));
      mock.setRpc("get_admin_whatsapp_state", () => ({
        data: [
          {
            status: "connected",
            qr_data_url: null,
            phone: "573000000000",
            connected_at: "2026-09-25T08:00:00.000Z",
            heartbeat_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_error: null,
            requested_command: null,
          },
        ],
        error: null,
      }));
      mock.setRpc("request_admin_whatsapp_command", () => ({
        data: null,
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<NotificationMonitorPanel />);

      await user.click(
        await screen.findByRole("button", { name: /Cerrar sesión/ }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByRole("heading", {
          name: "Cerrar sesión de WhatsApp",
        }),
      ).toBeInTheDocument();
      expect(mock.client.rpc).not.toHaveBeenCalledWith(
        "request_admin_whatsapp_command",
        expect.anything(),
      );

      await user.click(
        within(dialog).getByRole("button", { name: "Cerrar sesión" }),
      );

      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "request_admin_whatsapp_command",
          { p_command: "logout" },
        );
      });
    },
    15000,
  );
});

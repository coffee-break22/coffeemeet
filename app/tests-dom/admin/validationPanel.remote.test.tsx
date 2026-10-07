import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "../mocks/supabaseClient.ts";
import {
  getSupabaseMock,
  installSupabaseMock,
  signInAsAdmin,
} from "../mocks/installSupabaseMock.ts";
import { ValidationPanel } from "../../src/features/admin/ValidationPanel.tsx";
import { renderWithProviders } from "../testUtils.tsx";

vi.mock("../../src/infrastructure/supabase/client.ts", () =>
  installSupabaseMock(),
);

function getMock() {
  return getSupabaseMock() as ReturnType<typeof createSupabaseMock>;
}

function verificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    userId: "user-1",
    fullName: "Ana Pérez",
    email: "ana@example.com",
    alumniEmail: "ana@example.com",
    phone: "+573001234567",
    linkedin: "",
    school: "harvard",
    graduationYear: 2020,
    status: "pending",
    matchBasis: "none",
    registryId: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("ValidationPanel · modo remoto (admin autenticado)", () => {
  it(
    "carga la página remota vía get_admin_verification_page y aprueba con decide_verification_request",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_verification_page", () => ({
        data: {
          items: [verificationRow()],
          total: 1,
          pendingTotal: 1,
        },
        error: null,
      }));
      mock.setRpc("decide_verification_request", () => ({
        data: null,
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<ValidationPanel />);

      await screen.findByText("Ana Pérez");
      expect(screen.getByText("pending")).toBeInTheDocument();

      await user.click(screen.getByText("Ana Pérez"));
      await screen.findByRole("heading", { name: "Ana Pérez" });
      await user.click(screen.getByRole("button", { name: /Aprobar/ }));

      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "decide_verification_request",
          expect.objectContaining({
            p_request_id: "req-1",
            p_status: "approved",
          }),
        );
      });
    },
    15000,
  );

  it(
    "busca con debounce llamando get_admin_verification_page con la consulta escrita",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_verification_page", () => ({
        data: { items: [], total: 0, pendingTotal: 0 },
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<ValidationPanel />);

      await waitFor(() =>
        expect(
          screen.getByText("No hay solicitudes en esta vista."),
        ).toBeInTheDocument(),
      );
      mock.client.rpc.mockClear();

      await user.type(
        screen.getByPlaceholderText("Buscar solicitud"),
        "bruno",
      );

      await waitFor(
        () => {
          expect(mock.client.rpc).toHaveBeenCalledWith(
            "get_admin_verification_page",
            expect.objectContaining({ p_query: "bruno" }),
          );
        },
        { timeout: 3000 },
      );
    },
    15000,
  );
});

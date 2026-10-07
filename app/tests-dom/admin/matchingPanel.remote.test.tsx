import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "../mocks/supabaseClient.ts";
import {
  getSupabaseMock,
  installSupabaseMock,
  signInAsAdmin,
} from "../mocks/installSupabaseMock.ts";
import { MatchingPanel } from "../../src/features/admin/MatchingPanel.tsx";
import { renderWithProviders } from "../testUtils.tsx";

vi.mock("../../src/infrastructure/supabase/client.ts", () =>
  installSupabaseMock(),
);

function getMock() {
  return getSupabaseMock() as ReturnType<typeof createSupabaseMock>;
}

async function ensureMatchingOpen(user: ReturnType<typeof userEvent.setup>) {
  const generateButton = await screen.findByRole("button", {
    name: /Generar borrador/,
  });
  if (generateButton.hasAttribute("disabled")) {
    await user.click(screen.getByRole("checkbox"));
  }
  return screen.getByRole("button", { name: /Generar borrador/ });
}

describe("MatchingPanel · modo remoto (admin autenticado)", () => {
  it(
    "carga get_admin_matching_data/get_admin_participant_counts y muestra los confirmados",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_matching_data", () => ({
        data: { participants: [], history: [], batches: [] },
        error: null,
      }));
      mock.setRpc("get_admin_participant_counts", () => ({
        data: { registered: 10, approved: 8, confirmed: 5, eligible: 5 },
        error: null,
      }));

      renderWithProviders(<MatchingPanel />);

      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "get_admin_matching_data",
          expect.any(Object),
        );
      });
      const stat = screen.getByText("Confirmados esta semana").closest("article") as HTMLElement;
      await waitFor(() => expect(stat).toHaveTextContent("5"));
    },
    15000,
  );

  it(
    "generar borrador guarda vía save_match_draft con el modo de prueba correcto",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_matching_data", () => ({
        data: {
          participants: [
            {
              id: "ana",
              fullName: "Ana Martínez",
              phone: "+573001110001",
              email: "ana@example.com",
              city: "Bogotá",
              verificationStatus: "approved",
              blocked: false,
              slotIds: ["p-Bogotá-2026-09-02-08:00"],
              knownPhones: [],
              knownEmails: [],
              onlyNewPeople: false,
              completedMeetingCount: 0,
              noticeCancellationRate: 0,
            },
            {
              id: "bruno",
              fullName: "Bruno Silva",
              phone: "+573001110002",
              email: "bruno@example.com",
              city: "Bogotá",
              verificationStatus: "approved",
              blocked: false,
              slotIds: ["p-Bogotá-2026-09-02-08:00"],
              knownPhones: [],
              knownEmails: [],
              onlyNewPeople: false,
              completedMeetingCount: 0,
              noticeCancellationRate: 0,
            },
          ],
          history: [],
          batches: [],
        },
        error: null,
      }));
      mock.setRpc("get_admin_participant_counts", () => ({
        data: { registered: 2, approved: 2, confirmed: 2, eligible: 2 },
        error: null,
      }));
      mock.setRpc("save_match_draft", () => ({
        data: [
          {
            batch_id: "batch-1",
            revision: 1,
            status: "draft",
            generated_at: "2026-09-25T08:00:00.000Z",
          },
        ],
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<MatchingPanel />);
      await waitFor(() =>
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "get_admin_matching_data",
          expect.any(Object),
        ),
      );

      const button = await ensureMatchingOpen(user);
      await user.click(button);

      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "save_match_draft",
          expect.objectContaining({
            p_regenerate: false,
          }),
        );
      });
      await screen.findAllByText(/Intento 1 —/);
    },
    15000,
  );

  it(
    "confirmar lote llama confirm_match_batch con el id del lote",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_matching_data", () => ({
        data: {
          participants: [],
          history: [],
          batches: [
            {
              id: "batch-1",
              weekCode: "2026-W36",
              revision: 1,
              fingerprint: "fp-1",
              status: "draft",
              result: { pairs: [], unmatched: [] },
              generatedAt: "2026-09-25T08:00:00.000Z",
              confirmedAt: null,
              isTest: false,
            },
          ],
        },
        error: null,
      }));
      mock.setRpc("get_admin_participant_counts", () => ({
        data: { registered: 0, approved: 0, confirmed: 0, eligible: 0 },
        error: null,
      }));
      mock.setRpc("confirm_match_batch", () => ({ data: null, error: null }));

      const user = userEvent.setup();
      renderWithProviders(<MatchingPanel />);
      await screen.findAllByText(/Intento 1 —/);

      await user.click(screen.getByRole("button", { name: /Confirmar lote/ }));

      await waitFor(() => {
        expect(mock.client.rpc).toHaveBeenCalledWith("confirm_match_batch", {
          p_batch_id: "batch-1",
        });
      });
    },
    15000,
  );

  it(
    "muestra el botón 'Limpiar pruebas' solo cuando hay lotes de prueba, y llama cleanup_test_data",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_matching_data", () => ({
        data: {
          participants: [],
          history: [],
          batches: [
            {
              id: "batch-test",
              weekCode: "2026-W36",
              revision: 1,
              fingerprint: "fp-1",
              status: "draft",
              result: { pairs: [], unmatched: [] },
              generatedAt: "2026-09-25T08:00:00.000Z",
              confirmedAt: null,
              isTest: true,
            },
          ],
        },
        error: null,
      }));
      mock.setRpc("get_admin_participant_counts", () => ({
        data: { registered: 0, approved: 0, confirmed: 0, eligible: 0 },
        error: null,
      }));
      mock.setRpc("cleanup_test_data", () => ({
        data: { status: "completed", pendingCalendar: 0, deletedBatches: 1 },
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<MatchingPanel />);

      const cleanupButton = await screen.findByRole("button", {
        name: /Limpiar pruebas/,
      });
      await user.click(cleanupButton);

      await waitFor(() => {
        expect(
          mock.client.rpc.mock.calls.some(
            (call) => call[0] === "cleanup_test_data",
          ),
        ).toBe(true);
      });
    },
    15000,
  );
});

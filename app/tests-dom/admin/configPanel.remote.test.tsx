import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "../mocks/supabaseClient.ts";
import {
  getSupabaseMock,
  installSupabaseMock,
  signInAsAdmin,
} from "../mocks/installSupabaseMock.ts";
import { ConfigPanel } from "../../src/features/admin/ConfigPanel.tsx";
import { renderWithProviders } from "../testUtils.tsx";

vi.mock("../../src/infrastructure/supabase/client.ts", () =>
  installSupabaseMock(),
);

function getMock() {
  return getSupabaseMock() as ReturnType<typeof createSupabaseMock>;
}

describe("ConfigPanel · modo remoto (admin autenticado)", () => {
  it(
    "hidrata desde meeting_config y guarda cambios vía upsert después de editar",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setTable("meeting_config", () => ({
        data: { value: null },
        error: null,
      }));
      mock.setTable("blocked_dates", () => ({ data: [], error: null }));

      const user = userEvent.setup();
      renderWithProviders(<ConfigPanel />);

      await screen.findByText("Bogotá");
      await waitFor(() =>
        expect(mock.client.from).toHaveBeenCalledWith("meeting_config"),
      );
      const callsBeforeSave = mock.client.from.mock.calls.filter(
        (call) => call[0] === "meeting_config",
      ).length;

      await user.click(screen.getByRole("button", { name: /^Ciudad$/ }));
      await user.type(screen.getByLabelText("Nombre"), "Barranquilla");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(
        () => {
          const callsAfterSave = mock.client.from.mock.calls.filter(
            (call) => call[0] === "meeting_config",
          ).length;
          // El autoguardado (debounced 400ms) hace un segundo llamado a
          // .from('meeting_config') para el upsert.
          expect(callsAfterSave).toBeGreaterThan(callsBeforeSave);
        },
        { timeout: 3000 },
      );
    },
    15000,
  );
});

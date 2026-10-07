import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "./mocks/supabaseClient.ts";
import {
  getSupabaseMock,
  installSupabaseMock,
} from "./mocks/installSupabaseMock.ts";
import { MeetingsPanel } from "../src/features/registration/MeetingsPanel.tsx";
import { renderWithProviders } from "./testUtils.tsx";

vi.mock("../src/infrastructure/supabase/client.ts", () =>
  installSupabaseMock(),
);

function getMock() {
  return getSupabaseMock() as ReturnType<typeof createSupabaseMock>;
}

function signInReal(mock: ReturnType<typeof createSupabaseMock>) {
  mock.setRpc("current_user_is_admin", () => ({ data: false, error: null }));
  mock.setLoggedIn({
    id: "user-1",
    email: "ana@example.com",
    user_metadata: {},
    app_metadata: {},
  });
}

function meetingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "meeting-1",
    week_code: "2026-W40",
    slot_id: "virtual|2026-10-01|18:00",
    status: "confirmed",
    meet_link: "https://meet.google.com/abc-defg-hij",
    scheduled_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    partner_id: "user-2",
    partner_name: "Bruno Silva",
    partner_email: "bruno@example.com",
    partner_phone: "+573009998888",
    partner_linkedin: "https://linkedin.com/in/bruno",
    cancelled_by: null,
    cancellation_exempt: false,
    ...overrides,
  };
}

describe("MeetingsPanel", () => {
  it("un usuario demo siempre ve la lista vacía (no hay citas reales en modo local)", async () => {
    localStorage.setItem(
      "coffeemeet.demo-auth.v1",
      JSON.stringify({
        id: "demo-x",
        email: "demo@example.com",
        name: "Demo",
        provider: "demo",
        demo: true,
      }),
    );
    renderWithProviders(<MeetingsPanel />);
    await screen.findByText("Aún no tienes citas");
  });

  it("sin citas remotas muestra el estado vacío", async () => {
    const mock = getMock();
    signInReal(mock);
    mock.setRpc("get_my_meetings", () => ({ data: [], error: null }));

    renderWithProviders(<MeetingsPanel />);
    await screen.findByText("Aún no tienes citas");
  });

  it(
    "muestra una cita confirmada futura, con enlace a Meet y botón de cancelar",
    async () => {
      const mock = getMock();
      signInReal(mock);
      mock.setRpc("get_my_meetings", () => ({
        data: [meetingRow()],
        error: null,
      }));

      renderWithProviders(<MeetingsPanel />);

      const card = (await screen.findByText("Café con Bruno Silva")).closest(
        "article",
      ) as HTMLElement;
      expect(within(card).getByText("Confirmada")).toBeInTheDocument();
      expect(
        within(card).getByRole("link", { name: /Entrar a Meet/ }),
      ).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
      expect(
        within(card).getByRole("button", { name: /Cancelar cita/ }),
      ).toBeInTheDocument();
    },
    15000,
  );

  it(
    "una cita ya pasada (no completada) no ofrece cancelar y muestra la nota de encuesta",
    async () => {
      const mock = getMock();
      signInReal(mock);
      mock.setRpc("get_my_meetings", () => ({
        data: [
          meetingRow({
            id: "meeting-past",
            scheduled_at: new Date(
              Date.now() - 2 * 60 * 60 * 1000,
            ).toISOString(),
          }),
        ],
        error: null,
      }));

      renderWithProviders(<MeetingsPanel />);
      const card = (await screen.findByText("Café con Bruno Silva")).closest(
        "article",
      ) as HTMLElement;
      expect(
        within(card).queryByRole("button", { name: /Cancelar cita/ }),
      ).not.toBeInTheDocument();
      expect(
        within(card).getByText(/La hora de esta cita ya pasó/),
      ).toBeInTheDocument();
    },
    15000,
  );

  it(
    "una cita cancelada no muestra el botón de cancelar ni el enlace a Meet",
    async () => {
      const mock = getMock();
      signInReal(mock);
      mock.setRpc("get_my_meetings", () => ({
        data: [
          meetingRow({ id: "meeting-cancelled", status: "cancelled_on_time" }),
        ],
        error: null,
      }));

      renderWithProviders(<MeetingsPanel />);
      const card = (await screen.findByText("Café con Bruno Silva")).closest(
        "article",
      ) as HTMLElement;
      expect(within(card).getByText("Cancelada")).toBeInTheDocument();
      expect(
        within(card).queryByRole("button", { name: /Cancelar cita/ }),
      ).not.toBeInTheDocument();
      expect(
        within(card).queryByRole("link", { name: /Entrar a Meet/ }),
      ).not.toBeInTheDocument();
    },
    15000,
  );

  it(
    "cancelar pide confirmación (SweetAlert2) y llama cancel_meeting; refresca la lista",
    async () => {
      const mock = getMock();
      signInReal(mock);
      let cancelled = false;
      mock.setRpc("get_my_meetings", () =>
        cancelled
          ? { data: [], error: null }
          : { data: [meetingRow()], error: null },
      );
      mock.setRpc("cancel_meeting", (params) => {
        cancelled = true;
        expect(params).toMatchObject({ p_meeting_id: "meeting-1" });
        return {
          data: [
            {
              meeting_status: "cancelled_on_time",
              cancellation_exempt: false,
              cancellation_exempt_reason: null,
              prior_completed_meeting_id: null,
            },
          ],
          error: null,
        };
      });

      const user = userEvent.setup();
      renderWithProviders(<MeetingsPanel />);
      await screen.findByText("Café con Bruno Silva");

      await user.click(
        screen.getByRole("button", { name: /Cancelar cita/ }),
      );
      await screen.findByText("Cancelar cita", { selector: ".cm-swal-title" });
      await user.click(
        screen.getByRole("button", { name: "Confirmar cancelación" }),
      );

      await screen.findByText(/Cita cancelada a tiempo/);
      await waitFor(() =>
        expect(screen.getByText("Aún no tienes citas")).toBeInTheDocument(),
      );
    },
    15000,
  );

  it(
    "cancelar y cancelar el modal (Cancelar en el diálogo) no llama cancel_meeting",
    async () => {
      const mock = getMock();
      signInReal(mock);
      mock.setRpc("get_my_meetings", () => ({
        data: [meetingRow()],
        error: null,
      }));
      mock.setRpc("cancel_meeting", () => ({
        data: [
          {
            meeting_status: "cancelled_on_time",
            cancellation_exempt: false,
            cancellation_exempt_reason: null,
            prior_completed_meeting_id: null,
          },
        ],
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<MeetingsPanel />);
      await screen.findByText("Café con Bruno Silva");

      await user.click(
        screen.getByRole("button", { name: /Cancelar cita/ }),
      );
      await screen.findByText("Cancelar cita", { selector: ".cm-swal-title" });
      await user.click(screen.getByRole("button", { name: "Cancelar" }));

      await waitFor(() =>
        expect(
          screen.queryByText("Cancelar cita", { selector: ".cm-swal-title" }),
        ).not.toBeInTheDocument(),
      );
      expect(
        mock.client.rpc.mock.calls.some((call) => call[0] === "cancel_meeting"),
      ).toBe(false);
      expect(screen.getByText("Café con Bruno Silva")).toBeInTheDocument();
    },
    15000,
  );
});

import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParticipantsPanel } from "../../src/features/admin/ParticipantsPanel.tsx";
import { renderWithProviders } from "../testUtils.tsx";
import {
  saveParticipants,
  loadParticipants,
  type StoredParticipant,
} from "../../src/data/participants.ts";

function approvedParticipant(
  overrides: Partial<StoredParticipant> = {},
): StoredParticipant {
  return {
    id: "user-1",
    fullName: "Ana Pérez",
    email: "ana@example.com",
    alumniEmail: "ana@example.com",
    phone: "+573001234567",
    linkedin: "https://linkedin.com/in/ana",
    school: "harvard",
    graduationYear: 2020,
    city: "Bogotá",
    verificationStatus: "approved",
    blocked: false,
    slots: [],
    knownPhones: [],
    knownEmails: [],
    completedMeetingCount: 0,
    onlyNewPeople: false,
    weekCode: "2026-W36",
    selection: { city: "Bogotá", places: [], days: [], times: [] },
    withdrawn: false,
    participationStatus: "confirmed",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("ParticipantsPanel · modo local (auth.configured=false)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("solo muestra participantes aprobados en la pestaña Registrados", () => {
    saveParticipants([
      approvedParticipant(),
      approvedParticipant({
        id: "user-2",
        fullName: "Pendiente Sin Aprobar",
        verificationStatus: "pending",
      }),
    ]);
    renderWithProviders(<ParticipantsPanel />);
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.queryByText("Pendiente Sin Aprobar")).not.toBeInTheDocument();
  });

  it("las pestañas 'semana previa' y 'en vivo' no tienen datos en modo local", async () => {
    saveParticipants([approvedParticipant()]);
    const user = userEvent.setup();
    renderWithProviders(<ParticipantsPanel />);

    await user.click(
      screen.getByRole("button", { name: /Confirmados — semana previa/ }),
    );
    expect(
      screen.getByText("No hay participantes en esta vista."),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Confirmaciones en vivo — semana actual/,
      }),
    );
    expect(
      screen.getByText(/Fuera de la ventana de confirmación/),
    ).toBeInTheDocument();
  });

  it("filtra por búsqueda dentro de Registrados", async () => {
    saveParticipants([
      approvedParticipant(),
      approvedParticipant({
        id: "user-2",
        fullName: "Bruno Díaz",
        email: "bruno@example.com",
        phone: "+573009876543",
      }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ParticipantsPanel />);
    await user.type(
      screen.getByPlaceholderText("Buscar participante"),
      "bruno",
    );
    expect(screen.queryByText("Ana Pérez")).not.toBeInTheDocument();
    expect(screen.getByText("Bruno Díaz")).toBeInTheDocument();
  });

  it(
    "borrar cuenta pide confirmación (SweetAlert2), cancelar no borra nada",
    async () => {
      saveParticipants([approvedParticipant()]);
      const user = userEvent.setup();
      renderWithProviders(<ParticipantsPanel />);
      await user.click(screen.getByText("Ana Pérez"));
      await user.click(screen.getByRole("button", { name: /Borrar cuenta/ }));

      await screen.findByText("Borrar cuenta", { selector: ".cm-swal-title" });
      await user.click(screen.getByRole("button", { name: "Cancelar" }));

      await waitFor(() => {
        expect(
          screen.queryByText("Borrar cuenta", { selector: ".cm-swal-title" }),
        ).not.toBeInTheDocument();
      });
      expect(loadParticipants()).toHaveLength(1);
    },
    15000,
  );

  it(
    "borrar cuenta y confirmar elimina al participante de localStorage",
    async () => {
      saveParticipants([approvedParticipant()]);
      const user = userEvent.setup();
      renderWithProviders(<ParticipantsPanel />);
      await user.click(screen.getByText("Ana Pérez"));
      await user.click(screen.getByRole("button", { name: /Borrar cuenta/ }));

      const confirmButton = await screen.findByRole("button", {
        name: "Sí, borrar esta cuenta",
      });
      await user.click(confirmButton);

      await waitFor(() => expect(loadParticipants()).toHaveLength(0));
      expect(
        screen.getByText("No hay participantes en esta vista."),
      ).toBeInTheDocument();
    },
    15000,
  );
});

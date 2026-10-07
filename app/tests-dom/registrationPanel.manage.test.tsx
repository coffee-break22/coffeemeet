import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegistrationPanel } from "../src/features/registration/RegistrationPanel.tsx";
import { renderWithProviders } from "./testUtils.tsx";
import {
  saveParticipants,
  loadParticipants,
  type StoredParticipant,
} from "../src/data/participants.ts";

const DEMO_KEY = "coffeemeet.demo-auth.v1";

function signInDemo(email = "ana@example.com") {
  localStorage.setItem(
    DEMO_KEY,
    JSON.stringify({
      id: `demo-${email}`,
      email,
      name: "Ana Pérez",
      provider: "demo",
      demo: true,
    }),
  );
  return `demo-${email}`;
}

function fixtureParticipant(
  id: string,
  overrides: Partial<StoredParticipant> = {},
): StoredParticipant {
  return {
    id,
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
    slots: [
      { id: "v-2026-09-02-08:00", date: "2026-09-02", time: "08:00", mode: "virtual", city: "Bogotá" },
    ],
    knownPhones: [],
    knownEmails: [],
    completedMeetingCount: 0,
    onlyNewPeople: false,
    weekCode: "2026-W36",
    selection: { city: "Bogotá", places: ["Virtual"], days: ["Miércoles"], times: ["08:00"] },
    withdrawn: false,
    participationStatus: "pending",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("RegistrationPanel · editar o retirarme (usuario demo autenticado)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("con una inscripción activa entra directo en modo 'manage' y muestra la tarjeta", async () => {
    const id = signInDemo();
    saveParticipants([fixtureParticipant(id)]);
    renderWithProviders(<RegistrationPanel />);

    await screen.findByText("Tu participación semanal");
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Pendiente de confirmar")).toBeInTheDocument();
    expect(screen.getByText("Bogotá")).toBeInTheDocument();
  });

  it(
    "confirmar participación cambia el estado a 'Confirmado' y oculta el botón",
    async () => {
      const id = signInDemo();
      saveParticipants([fixtureParticipant(id)]);
      const user = userEvent.setup();
      renderWithProviders(<RegistrationPanel />);

      await screen.findByText("Ana Pérez");
      await user.click(screen.getByRole("button", { name: "Confirmar" }));

      await screen.findByText("Confirmado para esta semana");
      expect(
        screen.queryByRole("button", { name: "Confirmar" }),
      ).not.toBeInTheDocument();
      await waitFor(() =>
        expect(loadParticipants()[0].participationStatus).toBe("confirmed"),
      );
    },
    15000,
  );

  it(
    "retirarme pide confirmación (SweetAlert2); cancelar no cambia nada",
    async () => {
      const id = signInDemo();
      saveParticipants([fixtureParticipant(id)]);
      const user = userEvent.setup();
      renderWithProviders(<RegistrationPanel />);

      await screen.findByText("Ana Pérez");
      await user.click(screen.getByRole("button", { name: /Retirarme/ }));
      await screen.findByText("Retirarme de esta semana", {
        selector: ".cm-swal-title",
      });
      await user.click(screen.getByRole("button", { name: "Cancelar" }));

      await waitFor(() =>
        expect(
          screen.queryByText("Retirarme de esta semana", {
            selector: ".cm-swal-title",
          }),
        ).not.toBeInTheDocument(),
      );
      expect(loadParticipants()[0].withdrawn).toBe(false);
      expect(screen.getByText("Pendiente de confirmar")).toBeInTheDocument();
    },
    15000,
  );

  it(
    "retirarme y confirmar marca la inscripción como retirada; 'Volver a participar' la reactiva",
    async () => {
      const id = signInDemo();
      saveParticipants([fixtureParticipant(id)]);
      const user = userEvent.setup();
      renderWithProviders(<RegistrationPanel />);

      await screen.findByText("Ana Pérez");
      await user.click(screen.getByRole("button", { name: /Retirarme/ }));
      await user.click(screen.getByRole("button", { name: "Sí, retirarme" }));

      await screen.findByText("Retirado esta semana");
      expect(loadParticipants()[0].withdrawn).toBe(true);
      expect(
        screen.getByRole("button", { name: /Retirarme/ }),
      ).toBeDisabled();

      await user.click(
        screen.getByRole("button", { name: "Volver a participar esta semana" }),
      );

      await screen.findByText("Confirmado para esta semana");
      await waitFor(() => {
        const stored = loadParticipants()[0];
        expect(stored.withdrawn).toBe(false);
        expect(stored.participationStatus).toBe("confirmed");
      });
    },
    15000,
  );

  it(
    "editar precarga el formulario con los datos guardados y vuelve al wizard",
    async () => {
      const id = signInDemo();
      saveParticipants([fixtureParticipant(id)]);
      const user = userEvent.setup();
      renderWithProviders(<RegistrationPanel />);

      await screen.findByText("Ana Pérez");
      await user.click(screen.getByRole("button", { name: "Editar" }));

      const nameInput = await screen.findByLabelText("Nombre completo");
      expect(nameInput).toHaveValue("Ana Pérez");
      expect(screen.getByLabelText(/^Correo/)).toHaveValue("ana@example.com");
      expect(screen.getByLabelText(/^LinkedIn/)).toHaveValue(
        "https://linkedin.com/in/ana",
      );
    },
    15000,
  );
});

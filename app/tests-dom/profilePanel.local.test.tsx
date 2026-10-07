import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfilePanel } from "../src/features/registration/ProfilePanel.tsx";
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
    slots: [],
    knownPhones: [],
    knownEmails: [],
    completedMeetingCount: 0,
    onlyNewPeople: false,
    weekCode: "2026-W36",
    selection: { city: "Bogotá", places: [], days: [], times: [] },
    withdrawn: false,
    participationStatus: "pending",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProfilePanel · usuario demo autenticado", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sin inscripción previa muestra el aviso de perfil incompleto", async () => {
    signInDemo();
    renderWithProviders(<ProfilePanel />);
    await screen.findByText(
      "Completa primero tu inscripción semanal para crear tu perfil.",
    );
  });

  it("carga el perfil existente y no muestra la zona de peligro para usuarios demo", async () => {
    const id = signInDemo();
    saveParticipants([fixtureParticipant(id)]);
    renderWithProviders(<ProfilePanel />);

    await screen.findByRole("heading", { name: "Ana Pérez" });
    expect(screen.queryByText("Borrar tu cuenta")).not.toBeInTheDocument();
  });

  it(
    "editar y guardar el perfil actualiza la vista previa y persiste en localStorage",
    async () => {
      const id = signInDemo();
      saveParticipants([fixtureParticipant(id)]);
      const user = userEvent.setup();
      renderWithProviders(<ProfilePanel />);

      await screen.findByRole("heading", { name: "Ana Pérez" });
      await user.type(
        screen.getByLabelText("Titular profesional (opcional)"),
        "Product Manager",
      );
      await user.type(
        screen.getByLabelText("Cargo actual (opcional)"),
        "PM Senior",
      );
      await user.type(
        screen.getByLabelText("Industria (opcional)"),
        "Tecnología",
      );

      const preview = document.querySelector(
        ".profile-preview",
      ) as HTMLElement;
      expect(preview).toHaveTextContent("Product Manager");

      await user.click(screen.getByRole("button", { name: "Guardar perfil" }));

      await screen.findByText("Perfil guardado.");
      await waitFor(() => {
        const stored = loadParticipants()[0];
        expect(stored.networkingProfile?.headline).toBe("Product Manager");
        expect(stored.networkingProfile?.currentRole).toBe("PM Senior");
        expect(stored.networkingProfile?.industry).toBe("Tecnología");
      });
    },
    15000,
  );

  it(
    "desmarcar la visibilidad de WhatsApp lo oculta de la vista previa",
    async () => {
      const id = signInDemo();
      saveParticipants([fixtureParticipant(id)]);
      const user = userEvent.setup();
      renderWithProviders(<ProfilePanel />);

      await screen.findByRole("heading", { name: "Ana Pérez" });
      const preview = document.querySelector(
        ".profile-preview",
      ) as HTMLElement;
      expect(preview).toHaveTextContent("WhatsApp");

      await user.click(screen.getByRole("checkbox", { name: "WhatsApp" }));
      expect(preview).not.toHaveTextContent("WhatsApp");
    },
    15000,
  );
});

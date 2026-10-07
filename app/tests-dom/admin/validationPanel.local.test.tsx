import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ValidationPanel } from "../../src/features/admin/ValidationPanel.tsx";
import { renderWithProviders } from "../testUtils.tsx";
import {
  saveVerificationRequests,
  loadVerificationRequests,
} from "../../src/data/verificationRequests.ts";
import type { VerificationRequest } from "../../src/application/verification.ts";

function pendingRequest(
  overrides: Partial<VerificationRequest["snapshot"]> = {},
): VerificationRequest {
  return {
    id: "req-1",
    userId: "user-1",
    fingerprint: "fp-1",
    snapshot: {
      fullName: "Ana Pérez",
      email: "ana@example.com",
      phone: "+573001234567",
      school: "harvard",
      graduationYear: 2020,
      ...overrides,
    },
    status: "pending",
    candidateRegistryIds: [],
    matchBasis: "none",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
  };
}

describe("ValidationPanel · modo local (auth.configured=false)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("muestra el estado vacío cuando no hay solicitudes pendientes", () => {
    renderWithProviders(<ValidationPanel />);
    expect(
      screen.getByText("No hay solicitudes en esta vista."),
    ).toBeInTheDocument();
  });

  it("lista una solicitud pendiente y permite seleccionarla", async () => {
    saveVerificationRequests([pendingRequest()]);
    const user = userEvent.setup();
    renderWithProviders(<ValidationPanel />);

    await user.click(screen.getByText("Ana Pérez"));
    expect(
      screen.getByRole("heading", { name: "Ana Pérez" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/No coincide con nadie del directorio/)).toBeInTheDocument();
  });

  it("filtra por texto de búsqueda", async () => {
    saveVerificationRequests([
      pendingRequest({ fullName: "Ana Pérez", email: "ana@example.com" }),
      { ...pendingRequest({ fullName: "Bruno Díaz", email: "bruno@example.com" }), id: "req-2", userId: "user-2" },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ValidationPanel />);

    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Bruno Díaz")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Buscar solicitud"), "bruno");
    expect(screen.queryByText("Ana Pérez")).not.toBeInTheDocument();
    expect(screen.getByText("Bruno Díaz")).toBeInTheDocument();
  });

  it("el botón Aprobar está deshabilitado si faltan datos mínimos (sin correo)", async () => {
    saveVerificationRequests([pendingRequest({ email: "", alumniEmail: "" })]);
    const user = userEvent.setup();
    renderWithProviders(<ValidationPanel />);
    await user.click(screen.getByText("Ana Pérez"));
    expect(screen.getByRole("button", { name: /Aprobar/ })).toBeDisabled();
  });

  it("aprobar guarda la decisión, actualiza localStorage y quita la solicitud de pendientes", async () => {
    saveVerificationRequests([pendingRequest()]);
    const user = userEvent.setup();
    renderWithProviders(<ValidationPanel />);

    await user.click(screen.getByText("Ana Pérez"));
    await user.type(
      screen.getByPlaceholderText("Motivo o evidencia de la decisión"),
      "Coincide por WhatsApp",
    );
    await user.click(screen.getByRole("button", { name: /Aprobar/ }));

    expect(
      screen.getByText("No hay solicitudes en esta vista."),
    ).toBeInTheDocument();

    const stored = loadVerificationRequests();
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe("approved");
    expect(stored[0].decision?.notes).toBe("Coincide por WhatsApp");
    expect(stored[0].decision?.automatic).toBe(false);
  });

  it("rechazar también está disponible aunque falten datos mínimos", async () => {
    saveVerificationRequests([pendingRequest({ email: "", alumniEmail: "" })]);
    const user = userEvent.setup();
    renderWithProviders(<ValidationPanel />);
    await user.click(screen.getByText("Ana Pérez"));
    await user.click(screen.getByRole("button", { name: /Rechazar/ }));

    const stored = loadVerificationRequests();
    expect(stored[0].status).toBe("rejected");
  });
});

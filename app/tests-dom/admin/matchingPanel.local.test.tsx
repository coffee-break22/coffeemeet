import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MatchingPanel } from "../../src/features/admin/MatchingPanel.tsx";
import { renderWithProviders } from "../testUtils.tsx";

async function ensureMatchingOpen(user: ReturnType<typeof userEvent.setup>) {
  const generateButton = screen.getByRole("button", {
    name: /Generar borrador/,
  });
  if (generateButton.hasAttribute("disabled")) {
    await user.click(screen.getByRole("checkbox"));
  }
  return screen.getByRole("button", { name: /Generar borrador/ });
}

describe("MatchingPanel · modo local (auth.configured=false, datos demo)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sin borrador todavía muestra el estado vacío", () => {
    renderWithProviders(<MatchingPanel />);
    expect(screen.getByText("Aún no hay borrador")).toBeInTheDocument();
  });

  it(
    "genera un borrador con los 7 participantes demo: excluye pendiente y bloqueado",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<MatchingPanel />);
      const button = await ensureMatchingOpen(user);
      await user.click(button);

      await screen.findAllByText(/Intento 1 —/);
      // Felipe está "pending" y Gabi está bloqueada: ninguno de los dos
      // debe entrar al pool de matching.
      expect(screen.getByText("Felipe Mora")).toBeInTheDocument();
      expect(screen.getByText("Aprobación pendiente")).toBeInTheDocument();
      expect(screen.getByText("Gabriela Soto")).toBeInTheDocument();
      expect(screen.getByText("Cuenta bloqueada")).toBeInTheDocument();
    },
    15000,
  );

  it(
    "regenerar crea un Intento 2 y conserva el Intento 1 en el historial",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<MatchingPanel />);
      const button = await ensureMatchingOpen(user);
      await user.click(button);
      await screen.findAllByText(/Intento 1 —/);

      await user.click(screen.getByRole("button", { name: /Regenerar/ }));
      await screen.findAllByText(/Intento 2 —/);

      const history = screen.getByText("Historial de revisiones").closest("div") as HTMLElement;
      expect(history).toHaveTextContent("Intento 1");
      expect(history).toHaveTextContent("Intento 2");
    },
    15000,
  );

  it(
    "confirmar lote deshabilita los botones y muestra la nota de éxito",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<MatchingPanel />);
      const button = await ensureMatchingOpen(user);
      await user.click(button);
      await screen.findAllByText(/Intento 1 —/);

      await user.click(screen.getByRole("button", { name: /Confirmar lote/ }));

      await screen.findByText("Prueba confirmada");
      expect(
        screen.getByRole("button", { name: /Confirmar lote/ }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: /Regenerar/ }),
      ).toBeDisabled();
    },
    15000,
  );

  it(
    "ver detalles técnicos revela ID/Huella/Estado dentro de un <details> colapsado",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<MatchingPanel />);
      const button = await ensureMatchingOpen(user);
      await user.click(button);
      await screen.findAllByText(/Intento 1 —/);

      const details = screen
        .getByText("Ver detalles técnicos")
        .closest("details") as HTMLDetailsElement;
      expect(details.open).toBe(false);
      await user.click(screen.getByText("Ver detalles técnicos"));
      expect(details.open).toBe(true);
      expect(screen.getByText("ID")).toBeInTheDocument();
      expect(screen.getByText("Huella")).toBeInTheDocument();
    },
    15000,
  );
});

import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigPanel } from "../../src/features/admin/ConfigPanel.tsx";
import { renderWithProviders } from "../testUtils.tsx";
import { loadMeetingConfig } from "../../src/data/meetingConfig.ts";

describe("ConfigPanel · modo local (auth.configured=false, autoguardado en localStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it(
    "agrega una ciudad y persiste en localStorage",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigPanel />);
      await user.click(screen.getByRole("button", { name: /^Ciudad$/ }));
      await user.type(screen.getByLabelText("Nombre"), "Barranquilla");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      await screen.findByText("Barranquilla");
      await waitFor(() =>
        expect(
          loadMeetingConfig().cities.some((c) => c.name === "Barranquilla"),
        ).toBe(true),
      );
    },
    15000,
  );

  it(
    "agrega un lugar dentro de una ciudad existente",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigPanel />);
      const bogotaCard = screen.getByText("Bogotá").closest("article") as HTMLElement;
      await user.click(within(bogotaCard).getByText(/lugar/));
      await user.type(screen.getByLabelText("Nombre"), "Parque 93");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(() =>
        expect(
          loadMeetingConfig()
            .cities.find((c) => c.name === "Bogotá")
            ?.places.some((p) => p.name === "Parque 93"),
        ).toBe(true),
      );
    },
    15000,
  );

  it(
    "quitar ciudad pide confirmación y la elimina",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigPanel />);
      const caliCard = screen.getByText("Cali").closest("article") as HTMLElement;
      await user.click(within(caliCard).getByTitle("Quitar ciudad"));
      await screen.findByText(/Se quitará/);
      await user.click(screen.getByRole("button", { name: "Quitar" }));

      await waitFor(() => {
        expect(screen.queryByText("Cali")).not.toBeInTheDocument();
      });
      expect(
        loadMeetingConfig().cities.some((c) => c.name === "Cali"),
      ).toBe(false);
    },
    15000,
  );

  it(
    "no permite agregar una afiliación duplicada",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigPanel />);
      await user.click(screen.getByRole("button", { name: /^Afiliación$/ }));
      await user.type(screen.getByLabelText("Nombre"), "Harvard");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      await screen.findByRole("alert");
      expect(
        loadMeetingConfig().schools.filter((s) => s.name === "Harvard"),
      ).toHaveLength(1);
    },
    15000,
  );

  it(
    "no permite quitar la última afiliación",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigPanel />);
      // Quita 2 de las 3 escuelas demo para dejar solo una.
      for (const name of ["MIT", "Harvard y MIT"]) {
        const card = screen.getByText(name).closest("article") as HTMLElement;
        await user.click(within(card).getByTitle(/Quitar/));
        await user.click(screen.getByRole("button", { name: "Quitar" }));
        await waitFor(() =>
          expect(screen.queryByText(name)).not.toBeInTheDocument(),
        );
      }
      const lastCard = screen.getByText("Harvard").closest("article") as HTMLElement;
      await user.click(within(lastCard).getByTitle(/Quitar/));
      await user.click(screen.getByRole("button", { name: "Quitar" }));

      await screen.findByRole("alert");
      expect(loadMeetingConfig().schools).toHaveLength(1);
      // El modal de confirmación sigue abierto (la validación bloqueó el
      // submit antes de cerrarlo) — cerrarlo y confirmar que Harvard sigue
      // en la lista de fondo.
      await user.click(screen.getByRole("button", { name: "Volver" }));
      expect(screen.getByText("Harvard")).toBeInTheDocument();
    },
    15000,
  );

  it(
    "desactivar la categoría oculta la sección de afiliaciones",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigPanel />);
      await user.click(
        screen.getByRole("checkbox", {
          name: /Mi comunidad usa esta categoría/,
        }),
      );
      expect(screen.queryByText("Harvard")).not.toBeInTheDocument();
      expect(
        screen.getByText(/Esta categoría está oculta/),
      ).toBeInTheDocument();
    },
    15000,
  );

  it(
    "renombra la categoría de afiliación",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigPanel />);
      await user.click(screen.getByTitle("Renombrar categoría"));
      const input = screen.getByDisplayValue("Afiliación");
      await user.clear(input);
      await user.type(input, "Universidad{Enter}");

      await waitFor(() =>
        expect(loadMeetingConfig().schoolCategoryLabel).toBe("Universidad"),
      );
      expect(
        screen.getByRole("button", { name: /^Universidad$/ }),
      ).toBeInTheDocument();
    },
    15000,
  );

  it(
    "agrega un día nuevo y solo ofrece días de la semana aún no configurados",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigPanel />);
      await user.click(screen.getByRole("button", { name: /^Día$/ }));
      const select = screen.getByLabelText("Día de la semana");
      const options = within(select)
        .getAllByRole("option")
        .map((o) => o.textContent);
      expect(options).not.toContain("Martes");
      expect(options).not.toContain("Miércoles");
      expect(options).not.toContain("Jueves");
      expect(options).toContain("Lunes");

      await user.selectOptions(select, "Lunes");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(() =>
        expect(
          loadMeetingConfig().days.some((d) => d.label === "Lunes"),
        ).toBe(true),
      );
    },
    15000,
  );

  it(
    "marcar festivo revela el campo de motivo; marcar 'otro motivo' revela su nota",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigPanel />);
      const martesCard = screen
        .getByText("Martes")
        .closest("article") as HTMLElement;
      const scoped = within(martesCard);

      expect(scoped.queryByPlaceholderText("Motivo opcional")).toBeNull();
      await user.click(scoped.getByLabelText("Inhabilitar por festivo"));
      expect(
        scoped.getByPlaceholderText("Motivo opcional"),
      ).toBeInTheDocument();

      await user.click(scoped.getByLabelText("Inhabilitar por otro motivo"));
      expect(scoped.getByPlaceholderText("Motivo")).toBeInTheDocument();
      expect(
        scoped.getByText(/No se envía ningún mensaje ese día/),
      ).toBeInTheDocument();

      await waitFor(() => {
        const day = loadMeetingConfig().days.find((d) => d.label === "Martes");
        expect(day?.blocked).toBe(true);
        expect(day?.disabledOther).toBe(true);
      });
    },
    15000,
  );

  it(
    "agrega una hora válida y rechaza un formato inválido",
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConfigPanel />);
      await user.click(screen.getByRole("button", { name: /^Hora$/ }));
      const input = screen.getByLabelText("Hora (HH:MM)");
      await user.clear(input);
      await user.type(input, "not-a-time");
      await user.click(screen.getByRole("button", { name: "Guardar" }));
      await screen.findByRole("alert");
      expect(loadMeetingConfig().times).not.toContain("not-a-time");

      await user.clear(input);
      await user.type(input, "09:15");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(() =>
        expect(loadMeetingConfig().times).toContain("09:15"),
      );
    },
    15000,
  );
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { createSupabaseMock } from "../mocks/supabaseClient.ts";
import {
  getSupabaseMock,
  installSupabaseMock,
  signInAsAdmin,
} from "../mocks/installSupabaseMock.ts";
import App from "../../src/App.tsx";
import { renderWithProviders } from "../testUtils.tsx";

vi.mock("../../src/infrastructure/supabase/client.ts", () =>
  installSupabaseMock(),
);

function getMock() {
  return getSupabaseMock() as ReturnType<typeof createSupabaseMock>;
}

function registryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "reg-1",
    full_name: "Ana Pérez",
    email: "ana@example.com",
    phone: "+573001234567",
    school: "harvard",
    graduation_year: 2020,
    active: true,
    registered: true,
    notes: "",
    source: "manual",
    updated_at: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("App · nav de administración", () => {
  it("un usuario anónimo no ve ningún botón de navegación admin", async () => {
    renderWithProviders(<App />);
    await waitFor(() =>
      expect(screen.queryByText("Cargando sesión…")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Directorio")).not.toBeInTheDocument();
    expect(screen.queryByText("Matching")).not.toBeInTheDocument();
  });

  it(
    "un admin autenticado ve todos los botones de navegación admin",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_registry_page", () => ({
        data: { items: [], total: 0, counts: { all: 0, active: 0, inactive: 0, imported: 0 } },
        error: null,
      }));

      renderWithProviders(<App />);

      await screen.findByText("Directorio");
      for (const label of [
        "Panel",
        "Solicitudes",
        "Participantes",
        "Reputación",
        "Notificaciones",
        "Matching",
        "Configuración",
      ]) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
    },
    15000,
  );
});

describe("App · Directorio de la comunidad (remoto, admin)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it(
    "carga get_admin_registry_page y lista los miembros",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_registry_page", () => ({
        data: {
          items: [registryRow()],
          total: 1,
          counts: { all: 1, active: 1, inactive: 0, imported: 0 },
        },
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<App />);
      await user.click(await screen.findByText("Directorio"));

      await screen.findByText("Ana Pérez");
      expect(document.querySelector(".badge.approved")).toHaveTextContent(
        "Activo",
      );
    },
    15000,
  );

  it(
    "agregar un alumni llama a alumni_registry.upsert vía saveAdminRegistryEntry",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_registry_page", () => ({
        data: { items: [], total: 0, counts: { all: 0, active: 0, inactive: 0, imported: 0 } },
        error: null,
      }));
      mock.setTable("alumni_registry", () => ({
        data: registryRow({ id: "reg-new", full_name: "Bruno Silva" }),
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<App />);
      await user.click(await screen.findByText("Directorio"));
      await waitFor(() =>
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "get_admin_registry_page",
          expect.any(Object),
        ),
      );

      await user.click(screen.getByRole("button", { name: /Agregar/ }));
      await user.type(screen.getByLabelText("Nombre"), "Bruno Silva");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(() => {
        expect(mock.client.from).toHaveBeenCalledWith("alumni_registry");
      });
    },
    15000,
  );

  it(
    "importar CSV muestra la previsualización y confirma con alumni_registry.insert",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_registry_page", () => ({
        data: { items: [], total: 0, counts: { all: 0, active: 0, inactive: 0, imported: 0 } },
        error: null,
      }));
      mock.setTable("alumni_registry", () => ({
        data: [registryRow({ id: "reg-csv", full_name: "Carla Ríos" })],
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<App />);
      await user.click(await screen.findByText("Directorio"));
      await waitFor(() =>
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "get_admin_registry_page",
          expect.any(Object),
        ),
      );

      const csv =
        "nombre,email,telefono,escuela,año\nCarla Ríos,carla@example.com,+573009998888,Harvard,2021";
      const file = new File([csv], "padron.csv", { type: "text/csv" });
      const fileInput = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await user.upload(fileInput, file);

      await screen.findByText("Previsualizar importación");
      expect(screen.getByText(/1 nuevos/)).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "Importar registros válidos" }),
      );

      await waitFor(() => {
        expect(mock.client.from).toHaveBeenCalledWith("alumni_registry");
      });
      await waitFor(() =>
        expect(
          screen.queryByText("Previsualizar importación"),
        ).not.toBeInTheDocument(),
      );
    },
    15000,
  );

  it(
    "el filtro de afiliación recarga get_admin_registry_page con p_school",
    async () => {
      const mock = getMock();
      signInAsAdmin(mock);
      mock.setRpc("get_admin_registry_page", () => ({
        data: { items: [], total: 0, counts: { all: 0, active: 0, inactive: 0, imported: 0 } },
        error: null,
      }));

      const user = userEvent.setup();
      renderWithProviders(<App />);
      await user.click(await screen.findByText("Directorio"));
      await waitFor(() =>
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "get_admin_registry_page",
          expect.any(Object),
        ),
      );
      mock.client.rpc.mockClear();

      await user.selectOptions(
        screen.getByLabelText("Filtrar por afiliación"),
        "harvard",
      );

      await waitFor(() =>
        expect(mock.client.rpc).toHaveBeenCalledWith(
          "get_admin_registry_page",
          expect.objectContaining({ p_school: "harvard" }),
        ),
      );
    },
    15000,
  );
});

import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegistrationPanel } from "../src/features/registration/RegistrationPanel.tsx";
import { renderWithProviders } from "./testUtils.tsx";

function fillRequiredFieldsExcept(
  user: ReturnType<typeof userEvent.setup>,
  skip: "fullName" | "phone" | "email" | "linkedin" | "password" | "none",
) {
  const actions: Array<() => Promise<unknown>> = [];
  if (skip !== "fullName")
    actions.push(() =>
      user.type(screen.getByLabelText("Nombre completo"), "Ana Pérez"),
    );
  if (skip !== "phone")
    actions.push(() =>
      user.type(screen.getByPlaceholderText("300 123 4567"), "3001234567"),
    );
  if (skip !== "email")
    actions.push(() =>
      user.type(
        screen.getByLabelText(/^Correo/, { exact: false }),
        "ana@example.com",
      ),
    );
  if (skip !== "linkedin")
    actions.push(() =>
      user.type(
        screen.getByLabelText(/^LinkedIn/, { exact: false }),
        "https://linkedin.com/in/ana",
      ),
    );
  return actions.reduce(
    (chain, action) => chain.then(action),
    Promise.resolve<unknown>(undefined),
  );
}

describe("RegistrationPanel · validación del paso 1", () => {
  it("el botón Siguiente empieza deshabilitado con el formulario vacío", () => {
    renderWithProviders(<RegistrationPanel />);
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
  });

  it("sigue deshabilitado si falta el nombre completo", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegistrationPanel />);
    await fillRequiredFieldsExcept(user, "fullName");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
  });

  it("sigue deshabilitado si el LinkedIn está vacío (obligatorio)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegistrationPanel />);
    await fillRequiredFieldsExcept(user, "linkedin");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
  });

  it("sigue deshabilitado si el LinkedIn es una URL inválida", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegistrationPanel />);
    await fillRequiredFieldsExcept(user, "linkedin");
    await user.type(screen.getByLabelText(/^LinkedIn/), "no-es-una-url");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
  });

  it("sigue deshabilitado si el correo es inválido", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegistrationPanel />);
    await fillRequiredFieldsExcept(user, "email");
    await user.type(screen.getByLabelText(/^Correo/), "no-es-un-correo");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
  });

  it("se habilita cuando todos los campos requeridos del paso 1 son válidos", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegistrationPanel />);
    await fillRequiredFieldsExcept(user, "none");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();
  });

  it("en registro público, exige además una contraseña de al menos 8 caracteres", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegistrationPanel publicSignup />);
    await fillRequiredFieldsExcept(user, "none");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
    await user.type(
      screen.getByLabelText(/^Contraseña/),
      "1234567",
    );
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
    await user.type(
      screen.getByLabelText(/^Contraseña/),
      "8",
    );
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();
  });
});

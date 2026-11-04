import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthPanel } from "../src/features/auth/AuthPanel.tsx";
import { renderWithProviders } from "./testUtils.tsx";

describe("AuthPanel · preguntas frecuentes", () => {
  it("no muestra el login ni el FAQ hasta que showAccess es true", () => {
    renderWithProviders(<AuthPanel showAccess={false} />);
    expect(
      screen.queryByText("¿Cuánto cuesta participar?"),
    ).not.toBeInTheDocument();
  });

  it("muestra el acordeón de preguntas frecuentes cuando showAccess es true", () => {
    renderWithProviders(<AuthPanel showAccess />);
    expect(screen.getByText("¿Cuánto cuesta participar?")).toBeInTheDocument();
  });

  it("cada pregunta empieza colapsada y se abre al hacer click", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuthPanel showAccess />);
    const question = screen.getByText("¿Cómo funciona el matching?");
    const details = question.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    await user.click(question);
    expect(details).toHaveAttribute("open");
  });
});

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Sin esto, Vite carga .env.local (credenciales reales de Supabase) y las
  // pruebas terminan hablando con el proyecto real en vez de con los mocks.
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(""),
    "import.meta.env.VITE_TURNSTILE_SITE_KEY": JSON.stringify(""),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests-dom/setup.ts"],
    include: ["tests-dom/**/*.test.tsx", "tests-dom/**/*.test.ts"],
    css: false,
    testTimeout: 15000,
  },
});

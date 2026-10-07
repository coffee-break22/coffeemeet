import { useState } from "react";
import { ArrowRight, KeyRound } from "lucide-react";
import { useAuth } from "./useAuth.ts";

export function ResetPasswordPanel() {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      await auth.updatePassword(password);
      setDone(true);
    } catch {
      setMessage(
        "No pudimos actualizar la contraseña. El enlace puede haber expirado; solicita uno nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (auth.loading)
    return (
      <section className="auth-view">
        <div className="auth-card">Cargando…</div>
      </section>
    );

  if (done)
    return (
      <section className="auth-view">
        <div className="auth-copy">
          <div className="eyebrow">
            <KeyRound size={14} /> Contraseña actualizada
          </div>
          <h1>Listo, ya puedes iniciar sesión</h1>
        </div>
        <div className="auth-card">
          <a className="primary auth-submit" href="/">
            Ir a CoffeeMeet <ArrowRight size={17} />
          </a>
        </div>
      </section>
    );

  if (!auth.user)
    return (
      <section className="auth-view">
        <div className="auth-copy">
          <div className="eyebrow">
            <KeyRound size={14} /> Enlace inválido
          </div>
          <h1>Este enlace ya no es válido</h1>
          <p>
            Puede haber expirado o ya haberse usado. Solicita uno nuevo desde
            Acceso.
          </p>
        </div>
        <div className="auth-card">
          <a className="link-button" href="/?view=meetings">
            Volver a CoffeeMeet
          </a>
        </div>
      </section>
    );

  return (
    <section className="auth-view">
      <div className="auth-copy">
        <div className="eyebrow">
          <KeyRound size={14} /> Nueva contraseña
        </div>
        <h1>Elige tu nueva contraseña</h1>
      </div>
      <div className="auth-card">
        <label>
          Nueva contraseña
          <input
            type="password"
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirmar contraseña
          <input
            type="password"
            maxLength={72}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <button
          className="primary auth-submit"
          disabled={busy || password.length < 8 || password !== confirm}
          onClick={() => void submit()}
        >
          {busy ? "Guardando…" : "Guardar contraseña"}
        </button>
        {message && <div className="inline-message">{message}</div>}
      </div>
    </section>
  );
}

import { useCallback, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Coffee,
  LogOut,
  MessageCircle,
  ShieldCheck,
  Shuffle,
  Users,
} from "lucide-react";
import cupIcon from "../../assets/cup-icon.png";
import { communityLogoUrl } from "../../brandAssets.ts";
import { RegistrationPanel } from "../registration/RegistrationPanel.tsx";
import { useAuth } from "./useAuth.ts";
import { Turnstile } from "./Turnstile.tsx";
import { turnstileEnabled } from "./turnstileConfig.ts";
const FAQ_ITEMS = [
  {
    question: "¿Cuánto cuesta participar?",
    answer: "Es completamente gratis para todos los miembros de la comunidad.",
  },
  {
    question: "¿Cómo funciona el matching?",
    answer:
      "Cada semana te emparejamos al azar con otro miembro de tu comunidad, según los días, horas y lugares que marcaste como disponibles.",
  },
  {
    question: "¿Con quién me voy a encontrar?",
    answer:
      "Con otro alumni de tu misma comunidad. El sistema elige al azar — no puedes escoger con quién, pero puedes pedir que siempre sea alguien nuevo.",
  },
  {
    question: "¿Cuánto dura la cita y dónde es?",
    answer:
      "20 a 30 minutos, presencial en el lugar que elegiste o virtual por Google Meet — tú decides al inscribirte.",
  },
  {
    question: "¿Puedo evitar encontrarme con gente que ya conozco?",
    answer:
      'Sí. Activa "Solo gente que no conozco" en tus preferencias y agrega los contactos que quieras excluir.',
  },
  {
    question: "¿Qué pasa si no puedo asistir?",
    answer:
      'Cancela con anticipación desde "Mis citas". Si no avisas y no asistes, puede afectar tu prioridad en próximos matches.',
  },
  {
    question: "¿Puedo pausar mi participación?",
    answer:
      'Sí, usa "Retirarme" cualquier semana. Tu perfil y tu disponibilidad guardada no se borran — vuelves cuando quieras.',
  },
  {
    question: "¿Es privada mi información?",
    answer:
      'Solo compartimos con tu match lo que tú marques como visible en "Mi perfil" (LinkedIn, correo o WhatsApp).',
  },
];
export function AuthPanel({
  showAccess = false,
  onPublicSignupStart,
  onShowAccess,
  onAuthenticated,
}: {
  showAccess?: boolean;
  onPublicSignupStart?: () => void;
  onShowAccess?: () => void;
  onAuthenticated?: () => void;
}) {
  const auth = useAuth(),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [keepLanding, setKeepLanding] = useState(false),
    [captchaToken, setCaptchaToken] = useState(""),
    [captchaReset, setCaptchaReset] = useState(0),
    [forgotPassword, setForgotPassword] = useState(false),
    [resetSent, setResetSent] = useState(false);
  const receiveCaptcha = useCallback((token: string) => setCaptchaToken(token), []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch {
      setMessage(
        "No pudimos completar la operación. Revisa los datos e intenta nuevamente.",
      );
      setCaptchaToken("");
      setCaptchaReset((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  if (auth.loading)
    return (
      <section className="auth-view">
        <div className="auth-card">Cargando sesión…</div>
      </section>
    );
  if (window.location.pathname === "/admin" && !auth.user)
    return (
      <section className="auth-view">
        <div className="auth-copy">
          <div className="eyebrow">
            <ShieldCheck size={14} /> Acceso restringido
          </div>
          <h1>Administración de CoffeeMeet</h1>
        </div>
        <div className="auth-card">
          <button
            className="google-button"
            disabled={!auth.configured || busy}
            onClick={() => void run(auth.signInWithGoogle)}
          >
            <b>G</b> Ingresar como administrador con Google
          </button>
          {message && <div className="inline-message">{message}</div>}
          <a className="link-button" href="/">
            <ChevronLeft size={15} /> Volver a CoffeeMeet
          </a>
        </div>
      </section>
    );
  if (auth.user && !keepLanding)
    return (
      <section className="auth-view signed-view">
        <div className="auth-card signed-card">
          <div className="brand-mark">
            <Coffee />
          </div>
          <h1>Mi cuenta</h1>
          <p>{auth.user.email}</p>
          <span className="badge approved">
            {auth.user.provider}
            {auth.user.demo ? " · modo local" : ""}
          </span>
          <button className="secondary" onClick={() => void run(auth.signOut)}>
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      </section>
    );
  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-copy">
          <div className="eyebrow hero-community">
            {communityLogoUrl ? (
              <img src={communityLogoUrl} alt="MIT Harvard Club de Colombia" />
            ) : (
              <>
                <Coffee size={14} /> Harvard MIT Club de Colombia
              </>
            )}
          </div>
          <h1>
            <mark>Un buen café puede abrir una gran conversación</mark>
          </h1>
          <p>
            Cada semana conectamos alumni del MIT Harvard Club de Colombia
            para una conversación de 30 minutos, presencial o virtual.
          </p>
          <div className="landing-benefits">
            <span>
              <Shuffle /> Encuentros al azar
            </span>
            <span>
              <Clock3 /> 30 minutos
            </span>
            <span>
              <ShieldCheck /> Comunidad MIT Harvard de Colombia
            </span>
          </div>
          <a className="primary landing-cta" href="#inscripcion">
            Quiero participar <ArrowRight size={17} />
          </a>
        </div>
        <div className="landing-visual">
          <span className="landing-visual-dot landing-visual-dot-1" />
          <span className="landing-visual-dot landing-visual-dot-2" />
          <div className="landing-visual-card">
            <img src={cupIcon} alt="CoffeeMeet" />
          </div>
        </div>
      </section>
      <section className="landing-how">
        <div>
          <span>1</span>
          <Users />
          <h2>Elige tu disponibilidad</h2>
          <p>Completa un único formulario con los horarios que te funcionan.</p>
        </div>
        <div>
          <span>2</span>
          <MessageCircle />
          <h2>Confirma cada semana</h2>
          <p>Te escribiremos por WhatsApp antes del matching.</p>
        </div>
        <div>
          <span>3</span>
          <Coffee />
          <h2>Recibe tu cita</h2>
          <p>Te conectamos con máximo un alumni cada semana.</p>
        </div>
      </section>
      <section id="inscripcion" className="landing-registration">
        <RegistrationPanel
          publicSignup
          onRequestAccess={onShowAccess}
          onPublicSignupStart={() => {
            setKeepLanding(true);
            onPublicSignupStart?.();
          }}
        />
      </section>
      {showAccess && (
        <section className="auth-view landing-access" id="acceso">
          <div className="auth-copy">
            <div className="eyebrow">
              <ShieldCheck size={14} /> Para participantes registrados
            </div>
            <h1>¿Quieres hacer un cambio?</h1>
            <p>
              Inicia sesión para modificar tu disponibilidad, actualizar tu
              perfil profesional, consultar tus citas o retirarte de una semana.
            </p>
          </div>
          <div className="auth-card">
            {forgotPassword ? (
              resetSent ? (
                <>
                  <p>
                    Si <strong>{email}</strong> tiene una cuenta, te enviamos
                    un enlace para restablecer tu contraseña. Revisa también
                    spam.
                  </p>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setForgotPassword(false);
                      setResetSent(false);
                    }}
                  >
                    <ChevronLeft size={15} /> Volver a iniciar sesión
                  </button>
                </>
              ) : (
                <>
                  <label>
                    Correo
                    <input
                      type="email"
                      maxLength={254}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </label>
                  <button
                    className="primary auth-submit"
                    disabled={
                      busy || !auth.configured || !email || (turnstileEnabled && !captchaToken)
                    }
                    onClick={() =>
                      void run(async () => {
                        await auth.requestPasswordReset(email, captchaToken);
                        setResetSent(true);
                      })
                    }
                  >
                    {busy ? "Enviando…" : "Enviar enlace de recuperación"}
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setForgotPassword(false);
                      setMessage("");
                    }}
                  >
                    <ChevronLeft size={15} /> Volver a iniciar sesión
                  </button>
                  <Turnstile onToken={receiveCaptcha} resetKey={captchaReset} />
                  {message && <div className="inline-message">{message}</div>}
                </>
              )
            ) : (
              <>
                <label>
                  Correo
                  <input
                    type="email"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </label>
                <label>
                  Contraseña
                  <input
                    type="password"
                    maxLength={72}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </label>
                <button
                  className="primary auth-submit"
                  disabled={
                    busy || !auth.configured || !email || password.length < 8 || (turnstileEnabled && !captchaToken)
                  }
                  onClick={() =>
                    void run(async () => {
                      await auth.signInWithPassword(email, password, captchaToken);
                      // Si venía de completar un registro público, esas
                      // banderas seguían forzando la vista de landing/menú
                      // público incluso después de iniciar sesión de
                      // verdad — dejaba el botón "sin hacer nada" en
                      // apariencia y el nav seguía mostrando "Login".
                      setKeepLanding(false);
                      onAuthenticated?.();
                      history.replaceState(null, "", window.location.pathname);
                    })
                  }
                >
                  {busy ? "Ingresando…" : "Iniciar sesión"}
                </button>
                <button
                  type="button"
                  className="link-button auth-forgot"
                  onClick={() => {
                    setForgotPassword(true);
                    setMessage("");
                  }}
                >
                  ¿Olvidaste tu contraseña?
                </button>
                <Turnstile onToken={receiveCaptcha} resetKey={captchaReset} />
                {message && <div className="inline-message">{message}</div>}
              </>
            )}
          </div>
        </section>
      )}
      <section className="landing-faq">
        <div className="hero-kicker faq-kicker">Preguntas frecuentes</div>
        <h2>Todo lo que necesitas saber</h2>
        <div className="faq-list">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question}>
              <summary>
                {item.question}
                <ChevronDown size={18} />
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>
      <a
        className="whatsapp-fab"
        href={`https://wa.me/${import.meta.env.VITE_SUPPORT_WHATSAPP ?? ""}?text=${encodeURIComponent("Hola, tengo una duda sobre CoffeeMeet")}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Escribir a CoffeeMeet por WhatsApp"
      >
        <MessageCircle />
        <span>¿Dudas? Escríbenos</span>
      </a>
    </div>
  );
}

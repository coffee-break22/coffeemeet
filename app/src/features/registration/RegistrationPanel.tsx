import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  LogOut,
  Video,
} from "lucide-react";
import {
  matchRegistry,
  isValidWhatsAppPhone,
  normalizePhone,
  schoolLabel,
  type School,
} from "../../domain/coffeemeet.ts";
import type { AvailabilitySlot } from "../../domain/matching.ts";
import { loadRegistry } from "../../data/registry.ts";
import {
  findParticipant,
  upsertParticipant,
  type ParticipantSelection,
  type StoredParticipant,
} from "../../data/participants.ts";
import type { DayConfig } from "../../data/meetingConfig.ts";
import { useMeetingConfig } from "../../data/useMeetingConfig.ts";
import { countdownParts, nextColombiaCutoff } from "../../domain/schedule.ts";
import { createVerificationRequest } from "../../application/verification.ts";
import {
  loadVerificationRequests,
  upsertVerificationRequest,
} from "../../data/verificationRequests.ts";
import {
  confirmWeeklyParticipation,
  loadWeeklyRegistration,
  saveWeeklyRegistration,
  withdrawWeeklyRegistration,
} from "../../data/weeklyRegistrationRepository.ts";
import { useAuth } from "../auth/useAuth.ts";
import { Turnstile } from "../auth/Turnstile.tsx";
import { turnstileEnabled } from "../auth/turnstileConfig.ts";
import { InternationalPhoneInput } from "../../components/InternationalPhoneInput.tsx";
import { confirmDestructive } from "../feedback/confirmDestructive.ts";
type Form = {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  alumniEmail: string;
  linkedin: string;
  school: School;
  graduationYear: number | "";
  selection: ParticipantSelection;
  onlyNewPeople: boolean;
  contactsText: string;
};
type ContactPickerNavigator = Navigator & {
  contacts?: {
    select(
      properties: Array<"name" | "tel">,
      options: { multiple: boolean },
    ): Promise<Array<{ name?: string[]; tel?: string[] }>>;
  };
};
const fresh = (): Form => ({
  fullName: "",
  phone: "",
  email: "",
  password: "",
  alumniEmail: "",
  linkedin: "",
  school: "harvard",
  graduationYear: 2020,
  selection: { city: "", places: [], days: [], times: [] },
  onlyNewPeople: false,
  contactsText: "",
});
const toggle = (items: string[], value: string) =>
  items.includes(value) ? items.filter((i) => i !== value) : [...items, value];
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
function parseContacts(text: string) {
  const phones: string[] = [],
    emails: string[] = [];
  for (const raw of text.split(/[\n,]/).map((v) => v.trim()).filter(Boolean))
    if (isValidEmail(raw)) emails.push(raw.toLowerCase());
    else {
      const phone = normalizePhone(raw);
      if (phone) phones.push(phone);
    }
  return { phones, emails };
}
function normalizeLinkedIn(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    return host === "linkedin.com" || host.endsWith(".linkedin.com")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
const formatCutoffLabel = (cutoff: Date) => {
  const weekday = cutoff.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long",
  });
  const dayMonth = cutoff.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "long",
  });
  const time = cutoff
    .toLocaleString("es-CO", {
      timeZone: "America/Bogota",
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(/([ap])\. ?m\./i, "$1.m.");
  return `Cierre: ${weekday} ${dayMonth}, ${time}`;
};
const CONFIRMATION_TIMELINE = [
  {
    time: "Domingo, 7:00 p. m.",
    detail: "Te preguntamos por WhatsApp si confirmas, editas o cancelas.",
  },
  {
    time: "Domingo, 11:59 p. m.",
    detail: "Hora máxima para editar tus datos o retirarte de la cita.",
  },
  {
    time: "Lunes, 10:00 a. m.",
    detail: "Cierre: debes haber confirmado para participar esta semana.",
  },
  {
    time: "Lunes, 11:00 a. m.",
    detail: "Te avisamos quién es tu match.",
  },
];
function slotsFrom(
  selection: ParticipantSelection,
  days: DayConfig[],
): AvailabilitySlot[] {
  const out: AvailabilitySlot[] = [];
  for (const day of selection.days)
    for (const time of selection.times)
      for (const place of selection.places) {
        const date = days.find((d) => d.label === day)?.date ?? day;
        out.push(
          place === "Virtual"
            ? {
                id: `virtual|${date}|${time}`,
                date,
                time,
                mode: "virtual",
                city: selection.city,
              }
            : {
                id: `${selection.city}|${place}|${date}|${time}`,
                date,
                time,
                mode: "in_person",
                city: selection.city,
                place,
              },
        );
      }
  return out;
}
function RegistrationCountdown() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      if (document.visibilityState === "hidden") {
        if (timer) clearInterval(timer);
        timer = undefined;
        return;
      }
      setNow(new Date());
      if (!timer) timer = setInterval(() => setNow(new Date()), 1000);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  const cutoff = nextColombiaCutoff(now);
  const remaining = countdownParts(now, cutoff);
  return (
    <div className="countdown">
      <span>{formatCutoffLabel(cutoff)}</span>
      <strong>
        {remaining.days}d {remaining.hours}h {remaining.minutes}m{" "}
        {remaining.seconds}s
      </strong>
    </div>
  );
}
export function RegistrationPanel({
  publicSignup = false,
  onPublicSignupStart,
  onRequestAccess,
}: {
  publicSignup?: boolean;
  onPublicSignupStart?: () => void;
  onRequestAccess?: () => void;
} = {}) {
  const auth = useAuth();
  const {
    config,
    loading: configLoading,
    error: configError,
  } = useMeetingConfig(auth.configured);
  const WEEK = config.weekCode;
  const CITIES = config.cities.map((c) => ({
    name: c.name,
    places: c.places.map((p) => p.name),
  }));
  const DAYS = config.days.filter((d) => d.enabled && !d.blocked);
  const TIMES = config.times;
  const SCHOOLS = config.schools;
  const [mode, setMode] = useState<"register" | "manage">("register"),
    [step, setStep] = useState(0),
    [form, setForm] = useState<Form>(fresh),
    [saved, setSaved] = useState<StoredParticipant>(),
    [editingId, setEditingId] = useState<string>(),
    [found, setFound] = useState<StoredParticipant | null>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [captchaToken, setCaptchaToken] = useState(""),
    [captchaReset, setCaptchaReset] = useState(0),
    [showPassword, setShowPassword] = useState(false);
  const hasActiveRegistration = Boolean(found && !found.withdrawn);
  const selectedSchool = SCHOOLS.some((school) => school.id === form.school)
    ? form.school
    : (SCHOOLS[0]?.id ?? "");
  const linkedinUrl = normalizeLinkedIn(form.linkedin);
  const receiveCaptcha = useCallback(
    (token: string) => setCaptchaToken(token),
    [],
  );
  const contactPicker = (navigator as ContactPickerNavigator).contacts;
  const steps = ["Datos", "Ciudad y lugares", "Días y horas", "Preferencias"];
  const valid = useMemo(
    () =>
      step === 0
        ? !!(
            form.fullName &&
            isValidWhatsAppPhone(form.phone) &&
            isValidEmail(form.email) &&
            linkedinUrl !== null &&
            Number.isInteger(Number(form.graduationYear)) &&
            Number(form.graduationYear) >= 1900 &&
            Number(form.graduationYear) <= 2100 &&
            (!publicSignup || form.password.length >= 8)
          )
        : step === 1
          ? !!(form.selection.city && form.selection.places.length)
          : step === 2
            ? !!(form.selection.days.length && form.selection.times.length)
            : true,
    [form, linkedinUrl, step, publicSignup],
  );
  async function pickContacts() {
    if (!contactPicker) return;
    try {
      const selected = await contactPicker.select(["name", "tel"], {
        multiple: true,
      });
      const phones = selected.flatMap((contact) => contact.tel ?? []);
      setForm((current) => ({
        ...current,
        contactsText: Array.from(
          new Set(
            [...current.contactsText.split(/[\n,]/), ...phones]
              .map((phone) => phone.trim())
              .filter(Boolean),
          ),
        ).join("\n"),
      }));
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError")
        setMessage(
          "No pudimos abrir tus contactos. Puedes escribir los teléfonos manualmente.",
        );
    }
  }
  async function submit() {
    if ((!auth.user && !publicSignup) || busy) return;
    setMessage("");
    setBusy(true);
    try {
      let currentUser = auth.user;
      if (!currentUser && publicSignup) {
        onPublicSignupStart?.();
        currentUser = await auth.signUp(
          form.fullName,
          form.email,
          form.password,
          captchaToken,
        );
      }
      if (!currentUser) throw new Error("AUTH_REQUIRED");
      const matched = matchRegistry(loadRegistry(), form.email, form.phone);
      const knownContacts = parseContacts(form.contactsText);
      const id = currentUser.demo
        ? (editingId ?? currentUser.id)
        : currentUser.id;
      const verification = createVerificationRequest(
        loadVerificationRequests().find((r) => r.userId === id),
        id,
        {
          fullName: form.fullName,
          email: form.email,
          alumniEmail: form.email,
          phone: form.phone,
          linkedin: linkedinUrl ?? "",
          school: selectedSchool,
          graduationYear: Number(form.graduationYear),
        },
        matched,
      );
      const item: StoredParticipant = {
        id,
        fullName: form.fullName,
        email: form.email,
        alumniEmail: form.email,
        phone: normalizePhone(form.phone),
        linkedin: linkedinUrl ?? "",
        school: selectedSchool,
        graduationYear: Number(form.graduationYear),
        city: form.selection.city,
        verificationStatus: currentUser.demo
          ? verification.request.status
          : "pending",
        blocked: false,
        slots: slotsFrom(form.selection, DAYS),
        knownPhones: form.onlyNewPeople ? knownContacts.phones : [],
        knownEmails: form.onlyNewPeople ? knownContacts.emails : [],
        completedMeetingCount: found?.completedMeetingCount ?? 0,
        onlyNewPeople: form.onlyNewPeople,
        weekCode: WEEK,
        selection: form.selection,
        withdrawn: false,
        participationStatus: "confirmed",
        updatedAt: new Date().toISOString(),
      };
      if (currentUser.demo) {
        upsertParticipant(item);
        upsertVerificationRequest(verification.request);
      } else await saveWeeklyRegistration(item);
      setSaved(item);
      setFound(item);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      console.error("No se pudo guardar la inscripción", error);
      setMessage(
        detail.includes("EMAIL_CONFIRMATION_MUST_BE_DISABLED")
          ? "Desactiva Confirm email en Supabase Auth para permitir la inscripción inmediata."
          : detail.includes("EMAIL_ALREADY_REGISTERED")
            ? "Este correo ya tiene una cuenta y la contraseña no coincide. Pulsa Acceso para iniciar sesión o usa otro correo."
            : detail.includes("signup_disabled")
              ? "El registro por correo está desactivado en Supabase. Activa Email signups en Authentication."
              : detail.includes("email_address_invalid") ||
                  detail.includes("invalid_email")
                ? "El formato del correo no es válido. Usa un correo como nombre@dominio.com."
                : detail.includes("RATE_LIMIT_EXCEEDED") ||
                    detail.includes("over_email_send_rate_limit") ||
                    detail.includes("over_request_rate_limit")
                  ? "Se realizaron demasiados intentos. Espera 10 minutos antes de volver a intentarlo."
                  : detail.toLowerCase().includes("captcha")
                    ? "No pudimos validar la comprobación de seguridad. Recarga la página, completa nuevamente el CAPTCHA e inténtalo otra vez."
                    : detail.includes("Failed to fetch") ||
                        detail.includes("NetworkError")
                      ? "Se perdió la conexión durante el registro. Comprueba tu conexión y vuelve a intentarlo."
                      : detail.includes("weak_password")
                        ? "La contraseña no cumple los requisitos de seguridad de Supabase. Usa al menos 8 caracteres."
                        : detail.includes("ALUMNI_EMAIL_REQUIRED")
                          ? "Ingresa tu correo."
                          : detail.includes("LINKEDIN_URL_REQUIRED")
                            ? "Tu perfil de LinkedIn es obligatorio para inscribirte."
                          : detail.includes("PGRST202") ||
                              detail.includes("Could not find the function")
                            ? "La base de datos todavía no tiene la última actualización. Aplica la migración pendiente e inténtalo nuevamente."
                            : detail.includes("INVALID_SCHOOL") ||
                                detail.includes(
                                  "invalid input value for enum school",
                                )
                              ? "La escuela seleccionada todavía no está habilitada en la base de datos. Aplica la migración de escuelas configurables."
                              : detail.includes("INVALID_LINKEDIN_URL")
                                ? "El enlace de LinkedIn no es válido. Corrígelo antes de continuar."
                                : detail.includes("WEEKLY_CONFIRMATION_CLOSED")
                                  ? "La inscripción de esta semana ya cerró."
                                  : "No pudimos guardar la inscripción. Revisa que estén aplicadas todas las migraciones y vuelve a intentarlo.",
      );
      if (publicSignup) {
        setCaptchaToken("");
        setCaptchaReset((value) => value + 1);
      }
    } finally {
      setBusy(false);
    }
  }
  function keyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || (e.target as HTMLElement).tagName === "TEXTAREA")
      return;
    e.preventDefault();
    if (valid) {
      if (step < steps.length - 1) setStep(step + 1);
      else void submit();
    }
  }
  async function search(silent = false) {
    if (!auth.user) return null;
    if (!silent) setMessage("");
    try {
      const item = auth.user.demo
        ? findParticipant(auth.user.email)
        : await loadWeeklyRegistration(auth.user.id, WEEK);
      if (item && !auth.user.demo)
        item.selection.days = item.selection.days.map(
          (date) => DAYS.find((day) => day.date === date)?.label ?? date,
        );
      setFound(item ?? null);
      if (!silent)
        setMessage(
          item ? "" : "Todavía no tienes una inscripción para esta semana.",
        );
      return item ?? null;
    } catch {
      setFound(null);
      if (!silent)
        setMessage("No pudimos cargar tu inscripción. Intenta de nuevo.");
      return null;
    }
  }
  useEffect(() => {
    // auth.user llega de forma asíncrona (la sesión de Supabase se
    // restaura después del primer render), así que este efecto debe
    // reaccionar a ese cambio, no correr solo una vez al montar.
    if (!publicSignup && auth.user)
      void search(true).then((item) => {
        if (item && !item.withdrawn) setMode("manage");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicSignup, auth.user?.id]);
  function edit(item: StoredParticipant) {
    setEditingId(item.id);
    setForm({
      fullName: item.fullName,
      phone: item.phone,
      email: item.email,
      password: "",
      alumniEmail: item.alumniEmail ?? "",
      linkedin: item.linkedin,
      school: item.school,
      graduationYear: item.graduationYear,
      selection: item.selection,
      onlyNewPeople: item.onlyNewPeople,
      contactsText: [...item.knownPhones, ...item.knownEmails].join("\n"),
    });
    setMode("register");
    setStep(0);
    setSaved(undefined);
  }
  async function confirm(item: StoredParticipant) {
    try {
      if (auth.user?.demo) {
        const next = {
          ...item,
          slots: item.slots.length
            ? item.slots
            : slotsFrom(item.selection, DAYS),
          withdrawn: false,
          participationStatus: "confirmed" as const,
          updatedAt: new Date().toISOString(),
        };
        upsertParticipant(next);
        setFound(next);
      } else {
        await confirmWeeklyParticipation(item.weekCode);
        setFound({
          ...item,
          withdrawn: false,
          participationStatus: "confirmed",
        });
      }
      setMessage("Confirmaste tu participación para esta semana.");
    } catch {
      setMessage(
        "No pudimos confirmar. El plazo final es el lunes a las 10:00 a. m.",
      );
    }
  }
  async function withdraw(item: StoredParticipant) {
    const ok = await confirmDestructive({
      title: "Retirarme de esta semana",
      text: "Quedarás fuera del sorteo de esta semana. Tu perfil y tu disponibilidad guardada no se borran: puedes volver a participar cuando quieras, antes del domingo 11:59 p. m.",
      confirmText: "Sí, retirarme",
    });
    if (!ok) return;
    try {
      if (auth.user?.demo) {
        const next = {
          ...item,
          slots: [],
          withdrawn: true,
          updatedAt: new Date().toISOString(),
        };
        upsertParticipant(next);
        setFound(next);
      } else {
        await withdrawWeeklyRegistration(item.weekCode);
        setFound({
          ...item,
          slots: [],
          withdrawn: true,
          updatedAt: new Date().toISOString(),
        });
      }
      setMessage(
        "Te retiraste de esta semana. Tu perfil permanece activo para futuras inscripciones.",
      );
    } catch {
      setMessage("No pudimos procesar el retiro. Intenta de nuevo.");
    }
  }
  if (saved)
    return (
      <section className="verify-view">
        <div className="completion-card">
          <CheckCircle2 />
          <h1>¡Listo, {firstName(saved.fullName)}!</h1>
          <p>
            Quedaste inscrito. Se te asigna{" "}
            <strong>máximo 1 cita por semana</strong>, y tu disponibilidad se
            repite automáticamente cada semana hasta que la cambies.
          </p>
          <ol className="completion-timeline">
            {CONFIRMATION_TIMELINE.map((item, index) => (
              <li key={item.time}>
                <span className="completion-timeline-step">{index + 1}</span>
                <div>
                  <strong>{item.time}</strong>
                  <p>{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="summary-box">
            <b>Tu disponibilidad guardada</b>
            <span>
              {schoolLabel(saved.school, SCHOOLS)} · {saved.graduationYear}
            </span>
            <span>
              {saved.selection.city} · {saved.selection.places.join(", ")}
            </span>
            <span>
              {saved.selection.days.join(", ")} ·{" "}
              {saved.selection.times.join(", ")}
            </span>
            <span>
              {saved.slots.length} combinaciones · máximo 1 cita semanal
            </span>
          </div>
          <p className="completion-access-note">
            Si posteriormente quieres modificar tu disponibilidad, actualizar tu
            perfil profesional, consultar tus citas o retirarte de una semana,
            pulsa{" "}
            <button
              type="button"
              className="inline-access-link"
              onClick={onRequestAccess}
            >
              Login
            </button>{" "}
            e inicia sesión con el correo y la contraseña que acabas de
            registrar.
          </p>
          <button
            className="secondary completion-home"
            onClick={() => {
              // El registro público deja una sesión abierta detrás de
              // escena. Si no la cerramos aquí, un segundo envío desde el
              // mismo formulario ("registrar a otra persona") reutiliza
              // esa sesión y sobrescribe la cuenta recién creada en vez de
              // crear una nueva.
              if (publicSignup) void auth.signOut();
              setSaved(undefined);
              setForm(fresh());
              setStep(0);
              setEditingId(undefined);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Volver al inicio
          </button>
        </div>
      </section>
    );
  return (
    <section className="registration-view">
      {configError && (
        <div className="inline-message registration-message">
          {configError} Se muestra la última versión disponible.
        </div>
      )}
      <div className="registration-head">
        <div className="eyebrow">Una cita semanal</div>
        <RegistrationCountdown />
        <h1>Elige tu disponibilidad de esta semana.</h1>
        <p className="registration-guidance">
          {mode === "manage"
            ? "Puedes editar tus datos o retirarte de la cita de esta semana hasta el domingo 11:59 p. m."
            : "Inscríbete antes del domingo 11:59 p. m. Puedes editar tus datos o retirarte de la cita de la semana entrante hasta esa misma hora."}
        </p>
      </div>
      {!publicSignup && (
        <div className="mode-tabs">
          {!hasActiveRegistration && (
            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => setMode("register")}
            >
              Inscribirme
            </button>
          )}
          <button
            className={mode === "manage" ? "active" : ""}
            onClick={() => {
              setMode("manage");
              void search();
            }}
          >
            Editar o retirarme
          </button>
        </div>
      )}
      {mode === "manage" ? (
        <div className="wizard-card manage-card">
          <h2>Tu participación semanal</h2>
          <p>
            Por seguridad, solo puedes consultar, modificar o retirar la
            inscripción asociada a tu sesión.
          </p>
          {message && <div className="inline-message">{message}</div>}
          {found && (
            <div className="found-card">
              <div className="found-card-header">
                <strong>{found.fullName}</strong>
                <span
                  className={`status-pill ${
                    found.withdrawn
                      ? "muted"
                      : found.participationStatus === "confirmed"
                        ? "confirmed"
                        : "pending"
                  }`}
                >
                  {found.withdrawn
                    ? "Retirado esta semana"
                    : found.participationStatus === "confirmed"
                      ? "Confirmado para esta semana"
                      : "Pendiente de confirmar"}
                </span>
              </div>
              {found.selection.city && (
                <div className="preferences-grid">
                  <div>
                    <b>Ciudad</b>
                    <span>{found.selection.city}</span>
                  </div>
                  <div>
                    <b>Lugares</b>
                    <span>{found.selection.places.join(", ")}</span>
                  </div>
                  <div>
                    <b>Días</b>
                    <span>{found.selection.days.join(", ")}</span>
                  </div>
                  <div>
                    <b>Horas</b>
                    <span>{found.selection.times.join(", ")}</span>
                  </div>
                </div>
              )}
              <div className="found-card-actions">
                {found.participationStatus !== "confirmed" && (
                  <button
                    className="primary"
                    onClick={() => void confirm(found)}
                  >
                    {found.withdrawn
                      ? "Volver a participar esta semana"
                      : "Confirmar"}
                  </button>
                )}
                <button className="secondary" onClick={() => edit(found)}>
                  Editar
                </button>
                <button
                  className="danger-button"
                  disabled={found.withdrawn}
                  onClick={() => void withdraw(found)}
                >
                  <LogOut size={15} /> Retirarme
                </button>
              </div>
              {!found.withdrawn && (
                <p className="found-card-note">
                  Si te retiras, quedas fuera del sorteo de esta semana — tu
                  perfil y tu disponibilidad se guardan, y puedes volver a
                  participar cuando quieras.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="wizard-card" onKeyDown={keyDown}>
          {message && (
            <div className="inline-message registration-message">{message}</div>
          )}
          <div className="step-head">
            <span>
              Paso {step + 1} de {steps.length}
            </span>
            <strong>{steps[step]}</strong>
          </div>
          <div className="step-bars">
            {steps.map((s, i) => (
              <i key={s} className={i <= step ? "done" : ""} />
            ))}
          </div>
          {step === 0 && (
            <div className="form-grid">
              <label className="wide">
                Nombre completo
                <input
                  maxLength={120}
                  value={form.fullName}
                  onChange={(e) =>
                    setForm({ ...form, fullName: e.target.value })
                  }
                />
              </label>
              <label>
                WhatsApp
                <InternationalPhoneInput
                  value={form.phone}
                  onChange={(phone) => setForm({ ...form, phone })}
                />
              </label>
              <label>
                Correo
                <input
                  type="email"
                  maxLength={254}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="nombre@dominio.com"
                  autoComplete="email"
                  aria-invalid={Boolean(
                    form.email && !isValidEmail(form.email),
                  )}
                  aria-describedby="registration-email-help"
                />
                <small
                  id="registration-email-help"
                  className={
                    form.email && !isValidEmail(form.email)
                      ? "field-error"
                      : undefined
                  }
                >
                  {form.email && !isValidEmail(form.email)
                    ? "Escribe un correo válido, por ejemplo nombre@dominio.com."
                    : "Usaremos este correo para que puedas iniciar sesión."}
                </small>
              </label>
              {publicSignup && (
                <label>
                  Contraseña (mínimo 8 caracteres)
                  <span className="password-field">
                    <input
                      type={showPassword ? "text" : "password"}
                      minLength={8}
                      maxLength={72}
                      value={form.password}
                      onChange={(e) =>
                        setForm({ ...form, password: e.target.value })
                      }
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={
                        showPassword
                          ? "Ocultar contraseña"
                          : "Mostrar contraseña"
                      }
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                  <small>
                    Crea una contraseña de al menos 8 caracteres. La necesitarás
                    para iniciar sesión y modificar tus datos más adelante.
                  </small>
                </label>
              )}
              <label>
                LinkedIn
                <input
                  type="text"
                  maxLength={500}
                  required
                  value={form.linkedin}
                  onChange={(e) =>
                    setForm({ ...form, linkedin: e.target.value })
                  }
                  onBlur={() => {
                    if (linkedinUrl)
                      setForm({ ...form, linkedin: linkedinUrl });
                  }}
                  placeholder="linkedin.com/in/tu-perfil"
                  aria-required="true"
                  aria-invalid={Boolean(
                    form.linkedin.trim() && linkedinUrl === null,
                  )}
                  aria-describedby="registration-linkedin-help"
                />
                <small
                  id="registration-linkedin-help"
                  className={
                    form.linkedin.trim() && linkedinUrl === null
                      ? "field-error"
                      : undefined
                  }
                >
                  {form.linkedin.trim() && linkedinUrl === null
                    ? "Escribe un enlace válido de LinkedIn."
                    : "Para que tu match pueda conocer tu perfil antes de la cita."}
                </small>
              </label>
              <div className="form-subsection">Perfil académico</div>
              <label>
                Universidad
                <select
                  value={selectedSchool}
                  onChange={(e) =>
                    setForm({ ...form, school: e.target.value as School })
                  }
                >
                  {SCHOOLS.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Año de graduación
                <input
                  type="number"
                  min={1900}
                  max={2100}
                  value={form.graduationYear}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      graduationYear:
                        e.target.value === "" ? "" : Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          )}
          {step === 1 && (
            <div>
              <h2>¿En qué ciudad quieres agendar tu cita?</h2>
              <p className="step-subtitle">Elige una sola ciudad.</p>
              <div className="choice-grid">
                {CITIES.map((c) => (
                  <button
                    className={form.selection.city === c.name ? "selected" : ""}
                    onClick={() =>
                      setForm({
                        ...form,
                        selection: {
                          ...form.selection,
                          city: c.name,
                          places: [],
                        },
                      })
                    }
                    key={c.name}
                  >
                    {c.name}
                    <small>
                      {c.places.length} {c.places.length === 1 ? "lugar" : "lugares"}{" "}
                      + virtual
                    </small>
                  </button>
                ))}
              </div>
              {form.selection.city && (
                <>
                  <h3>Elige uno o varios lugares</h3>
                  <div className="choice-grid compact">
                    {[
                      ...(CITIES.find((c) => c.name === form.selection.city)
                        ?.places ?? []),
                      "Virtual",
                    ].map((p) => (
                      <div className="choice-item" key={p}>
                        <button
                          className={
                            form.selection.places.includes(p) ? "selected" : ""
                          }
                          onClick={() =>
                            setForm({
                              ...form,
                              selection: {
                                ...form.selection,
                                places: toggle(form.selection.places, p),
                              },
                            })
                          }
                        >
                          {p === "Virtual" ? (
                            <>
                              <Video size={15} /> Virtual
                            </>
                          ) : (
                            p
                          )}
                        </button>
                        {p === "Virtual" && (
                          <small>
                            Por Google Meet — puedes coincidir con alumni de
                            otra ciudad, el mismo día y hora.
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {step === 2 && (
            <div>
              <h2>¿Qué días y horas te funcionan?</h2>
              <p className="step-subtitle">
                Marca todas las que te sirvan — igual solo te tocará{" "}
                <strong>1 cita</strong> esta semana. Lo que elijas se repite
                automáticamente cada semana hasta que lo cambies.
              </p>
              <h3>Días</h3>
              <div className="choice-grid compact">
                {DAYS.map((d) => (
                  <button
                    className={
                      form.selection.days.includes(d.label) ? "selected" : ""
                    }
                    onClick={() =>
                      setForm({
                        ...form,
                        selection: {
                          ...form.selection,
                          days: toggle(form.selection.days, d.label),
                        },
                      })
                    }
                    key={d.label}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <h3>Horas</h3>
              <div className="choice-grid compact">
                {TIMES.map((t) => (
                  <button
                    className={
                      form.selection.times.includes(t) ? "selected" : ""
                    }
                    onClick={() =>
                      setForm({
                        ...form,
                        selection: {
                          ...form.selection,
                          times: toggle(form.selection.times, t),
                        },
                      })
                    }
                    key={t}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {step === 3 && (
            <div>
              <label className="preference-card">
                <input
                  type="checkbox"
                  checked={form.onlyNewPeople}
                  onChange={(e) =>
                    setForm({ ...form, onlyNewPeople: e.target.checked })
                  }
                />
                <span>
                  <strong>Solo gente que no conozco</strong>
                  <small>
                    Solo te emparejaremos con alumni nuevos, nunca con alguien
                    con quien ya tomaste café — aunque eso signifique quedarte
                    sin cita alguna semana. Si además agregas contactos abajo,
                    también quedan excluidos.
                  </small>
                </span>
              </label>
              {form.onlyNewPeople && (
                <div className="contacts-field">
                  <label>
                    Teléfonos o correos conocidos
                    <textarea
                      maxLength={5000}
                      value={form.contactsText}
                      onChange={(e) =>
                        setForm({ ...form, contactsText: e.target.value })
                      }
                      placeholder="Uno por línea o separados por coma (teléfono o correo)"
                    />
                  </label>
                  {contactPicker ? (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => void pickContacts()}
                    >
                      Elegir de mis contactos
                    </button>
                  ) : (
                    <small className="contacts-fallback-hint">
                      En iPhone/Safari no se pueden importar contactos
                      automáticamente todavía: abre tu app de Contactos, copia
                      el teléfono o correo, y pégalo arriba — uno por línea.
                    </small>
                  )}
                </div>
              )}
              <div className="summary-box">
                <b>Resumen</b>
                <span>
                  {form.selection.city} · {form.selection.places.join(", ")}
                </span>
                <span>
                  {form.selection.days.join(", ")} ·{" "}
                  {form.selection.times.join(", ")}
                </span>
                <span>
                  {slotsFrom(form.selection, DAYS).length} combinaciones ·
                  máximo 1 cita
                </span>
              </div>
              {publicSignup && (
                <Turnstile onToken={receiveCaptcha} resetKey={captchaReset} />
              )}
            </div>
          )}
          {step === steps.length - 1 && (
            <p className="wizard-legal">
              Al confirmar, aceptas las{" "}
              <a href="/terms" target="_blank" rel="noreferrer">
                Condiciones del Servicio
              </a>{" "}
              y reconoces la{" "}
              <a href="/privacy" target="_blank" rel="noreferrer">
                Política de Privacidad
              </a>
              .
            </p>
          )}
          <div className="wizard-actions">
            {step > 0 && (
              <button className="secondary" onClick={() => setStep(step - 1)}>
                <ChevronLeft size={16} /> Atrás
              </button>
            )}
            <button
              className="primary"
              disabled={
                !valid ||
                busy ||
                configLoading ||
                (publicSignup &&
                  turnstileEnabled &&
                  step === steps.length - 1 &&
                  !captchaToken)
              }
              onClick={() =>
                step < steps.length - 1 ? setStep(step + 1) : void submit()
              }
            >
              {step < steps.length - 1 ? (
                <>
                  Siguiente <ChevronRight size={16} />
                </>
              ) : busy ? (
                "Confirmando…"
              ) : (
                <>
                  Confirmar inscripción <CheckCircle2 size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

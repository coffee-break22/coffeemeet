import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  BookUser,
  CalendarCheck,
  CheckCircle2,
  Coffee,
  FileUp,
  LayoutDashboard,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Shuffle,
  UserCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { Brand } from "./components/Brand.tsx";
import "./App.css";
import {
  matchRegistry,
  parseRegistryCsv,
  schoolLabel,
  type CsvPreviewRow,
  type RegistryEntry,
  type School,
} from "./domain/coffeemeet";
import { loadRegistry, saveRegistry } from "./data/registry";

import { Pagination } from "./features/admin/Pagination.tsx";

import { useAuth } from "./features/auth/useAuth";
import { useToast } from "./features/feedback/ToastProvider.tsx";
import { useMeetingConfig } from "./data/useMeetingConfig.ts";

import {
  importAdminRegistry,
  loadAdminRegistryPage,
  saveAdminRegistryEntry,
} from "./data/adminRegistryRepository.ts";
const lazyNamed = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  name: K,
) =>
  lazy(async () => ({
    default: (await loader())[name] as React.ComponentType<any>,
  }));
const MatchingPanel = lazyNamed(
  () => import("./features/admin/MatchingPanel.tsx"),
  "MatchingPanel",
);
const RegistrationPanel = lazyNamed(
  () => import("./features/registration/RegistrationPanel.tsx"),
  "RegistrationPanel",
);
const ConfigPanel = lazyNamed(
  () => import("./features/admin/ConfigPanel.tsx"),
  "ConfigPanel",
);
const AdminDashboard = lazyNamed(
  () => import("./features/admin/AdminDashboard.tsx"),
  "AdminDashboard",
);
const ValidationPanel = lazyNamed(
  () => import("./features/admin/ValidationPanel.tsx"),
  "ValidationPanel",
);
const ParticipantsPanel = lazyNamed(
  () => import("./features/admin/ParticipantsPanel.tsx"),
  "ParticipantsPanel",
);
const ReputationPanel = lazyNamed(
  () => import("./features/admin/ReputationPanel.tsx"),
  "ReputationPanel",
);
const NotificationMonitorPanel = lazyNamed(
  () => import("./features/admin/NotificationMonitorPanel.tsx"),
  "NotificationMonitorPanel",
);
const ProfilePanel = lazyNamed(
  () => import("./features/registration/ProfilePanel.tsx"),
  "ProfilePanel",
);
const MeetingsPanel = lazyNamed(
  () => import("./features/registration/MeetingsPanel.tsx"),
  "MeetingsPanel",
);
const AuthPanel = lazyNamed(
  () => import("./features/auth/AuthPanel.tsx"),
  "AuthPanel",
);
const ResetPasswordPanel = lazyNamed(
  () => import("./features/auth/ResetPasswordPanel.tsx"),
  "ResetPasswordPanel",
);
const CalendarRedirect = lazyNamed(
  () => import("./features/meetings/CalendarRedirect.tsx"),
  "CalendarRedirect",
);
const PrivacyPolicy = lazyNamed(
  () => import("./features/legal/PrivacyPolicy.tsx"),
  "PrivacyPolicy",
);
const TermsOfService = lazyNamed(
  () => import("./features/legal/TermsOfService.tsx"),
  "TermsOfService",
);
const LoadingView = () => (
  <div className="route-loading" role="status">
    <Coffee />
    <span>Cargando…</span>
  </div>
);
const emptyEntry = (): RegistryEntry => ({
  id: crypto.randomUUID(),
  fullName: "",
  email: "",
  phone: "",
  school: "harvard",
  graduationYear: new Date().getFullYear(),
  active: true,
  registered: false,
  notes: "",
  source: "manual",
  updatedAt: new Date().toISOString(),
});
function App() {
  const requestedView = new URLSearchParams(window.location.search).get("view");
  const meetingDeepLink = requestedView === "meetings";
  const resetPasswordDeepLink = requestedView === "reset-password";
  const auth = useAuth();
  const toast = useToast();
  const { config: meetingConfig } = useMeetingConfig(auth.configured);
  const schools = meetingConfig.schools;
  const [showAccess, setShowAccess] = useState(meetingDeepLink),
    [publicSignupActive, setPublicSignupActive] = useState(false),
    [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<
      | "auth"
      | "membership"
      | "profile"
      | "signup"
      | "verify"
      | "dashboard"
      | "registry"
      | "matching"
      | "config"
      | "validations"
      | "participants"
      | "meetings"
      | "reputation"
      | "notifications"
      | "reset-password"
    >(meetingDeepLink ? "meetings" : resetPasswordDeepLink ? "reset-password" : "auth"),
    [entries, setEntries] = useState<RegistryEntry[]>(loadRegistry),
    [editing, setEditing] = useState<RegistryEntry | null>(null),
    [query, setQuery] = useState(""),
    [verification, setVerification] = useState({ email: "", phone: "" }),
    [result, setResult] = useState<
      ReturnType<typeof matchRegistry> | undefined
    >(),
    [preview, setPreview] = useState<CsvPreviewRow[] | null>(null),
    [registryPage, setRegistryPage] = useState(1),
    [registrySchool, setRegistrySchool] = useState<School | "">(""),
    [registryRegistered, setRegistryRegistered] = useState<
      "all" | "registered" | "unregistered"
    >("all"),
    [registryYear, setRegistryYear] = useState(""),
    [registryTotal, setRegistryTotal] = useState(0),
    [remoteCounts, setRemoteCounts] = useState({
      all: 0,
      active: 0,
      inactive: 0,
      imported: 0,
    }),
    [registryRefresh, setRegistryRefresh] = useState(0),
    [registryLoading, setRegistryLoading] = useState(false);
  const remoteRegistry = auth.isAdmin && auth.configured;
  useEffect(() => {
    if (!meetingDeepLink || auth.loading || auth.user) return;
    const timer = window.setTimeout(
      () => document.getElementById("acceso")?.scrollIntoView(),
      0,
    );
    return () => clearTimeout(timer);
  }, [auth.loading, auth.user, meetingDeepLink]);
  useEffect(() => {
    if (!remoteRegistry) saveRegistry(entries);
  }, [entries, remoteRegistry]);
  useEffect(() => {
    if (!remoteRegistry) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setRegistryLoading(true);
      void loadAdminRegistryPage({
        query,
        school: registrySchool || undefined,
        registered:
          registryRegistered === "all"
            ? undefined
            : registryRegistered === "registered",
        year: registryYear ? Number(registryYear) : undefined,
        page: registryPage,
        pageSize: 10,
      })
        .then((result) => {
          if (!active) return;
          setEntries(result.items);
          setRegistryTotal(result.total);
          setRemoteCounts(result.counts);
        })
        .catch(() =>
          toast.error("No se pudo cargar el directorio desde Supabase."),
        )
        .finally(() => {
          if (active) setRegistryLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    query,
    registryRegistered,
    registryPage,
    registryRefresh,
    registrySchool,
    registryYear,
    remoteRegistry,
    toast,
  ]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!q ||
          [e.fullName, e.email, e.phone, schoolLabel(e.school, schools)].some(
            (v) => v.toLowerCase().includes(q),
          )) &&
        (!registrySchool || e.school === registrySchool) &&
        (registryRegistered === "all" ||
          e.registered === (registryRegistered === "registered")) &&
        (!registryYear || e.graduationYear === Number(registryYear)),
    );
  }, [
    entries,
    query,
    registryRegistered,
    registrySchool,
    registryYear,
    schools,
  ]);
  const localCounts = useMemo(
    () => ({
      all: entries.length,
      active: entries.filter((e) => e.active).length,
      inactive: entries.filter((e) => !e.active).length,
      imported: entries.filter((e) => e.source === "csv").length,
    }),
    [entries],
  );
  const counts = remoteRegistry ? remoteCounts : localCounts,
    registryPageSize = 10,
    registryTotalItems = remoteRegistry ? registryTotal : filtered.length,
    registryPages = Math.max(
      1,
      Math.ceil(registryTotalItems / registryPageSize),
    ),
    safeRegistryPage = Math.min(registryPage, registryPages),
    pagedRegistry = remoteRegistry
      ? entries
      : filtered.slice(
          (safeRegistryPage - 1) * registryPageSize,
          safeRegistryPage * registryPageSize,
        );
  function verify(e: React.FormEvent) {
    e.preventDefault();
    setResult(matchRegistry(entries, verification.email, verification.phone));
  }
  async function upsert(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const next = {
      ...editing,
      fullName: editing.fullName.trim(),
      email: editing.email.trim(),
      phone: editing.phone.trim(),
      updatedAt: new Date().toISOString(),
    };
    try {
      const saved = auth.configured ? await saveAdminRegistryEntry(next) : next;
      setEntries((c) =>
        c.some((i) => i.id === saved.id)
          ? c.map((i) => (i.id === saved.id ? saved : i))
          : [saved, ...c],
      );
      setEditing(null);
      if (remoteRegistry) setRegistryRefresh((value) => value + 1);
    } catch {
      toast.error("No se pudo guardar el registro en el padrón.");
    }
  }
  async function selectCsv(file?: File) {
    if (!file) return;
    setPreview(parseRegistryCsv(await file.text(), entries));
  }
  async function commitImport() {
    if (!preview) return;
    const valid = preview
      .filter((r) => r.entry && !r.duplicate)
      .map((r) => ({
        ...r.entry!,
        id: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
      }));
    try {
      const saved = auth.configured ? await importAdminRegistry(valid) : valid;
      setEntries((c) => [...saved, ...c]);
      setPreview(null);
      if (remoteRegistry) {
        setRegistryPage(1);
        setRegistryRefresh((value) => value + 1);
      }
    } catch {
      toast.error(
        "No se pudo importar el padrón. Revisa duplicados y permisos.",
      );
    }
  }
  if (window.location.pathname.startsWith("/cal/"))
    return (
      <Suspense fallback={<LoadingView />}>
        <CalendarRedirect
          code={window.location.pathname.replace(/^\/cal\//, "").replace(/\/$/, "")}
        />
      </Suspense>
    );
  if (
    window.location.pathname === "/privacy" ||
    window.location.pathname === "/privacy/"
  )
    return (
      <Suspense fallback={<LoadingView />}>
        <PrivacyPolicy />
      </Suspense>
    );
  if (
    window.location.pathname === "/terms" ||
    window.location.pathname === "/terms/"
  )
    return (
      <Suspense fallback={<LoadingView />}>
        <TermsOfService />
      </Suspense>
    );
  return (
    <main>
      <header className={`topbar${auth.isAdmin ? " topbar-admin" : ""}`}>
        <Brand />
        <button
          className="nav-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        <nav
          id="primary-navigation"
          className={menuOpen ? "open" : ""}
          onClick={() => setMenuOpen(false)}
        >
          {auth.user && !publicSignupActive ? (
            auth.isAdmin ? (
              <button
                className={view === "auth" ? "active" : ""}
                onClick={() => setView("auth")}
              >
                Mi cuenta
              </button>
            ) : (
              <>
                <button
                  className={view === "signup" ? "active" : ""}
                  onClick={() => setView("signup")}
                >
                  Disponibilidad
                </button>
                <button
                  className={view === "meetings" ? "active" : ""}
                  onClick={() => setView("meetings")}
                >
                  Mis citas
                </button>
                <button
                  className={view === "profile" ? "active" : ""}
                  onClick={() => setView("profile")}
                >
                  Mi perfil
                </button>
                <button
                  className={view === "auth" ? "active" : ""}
                  onClick={() => setView("auth")}
                >
                  Mi cuenta
                </button>
              </>
            )
          ) : (
            <button
              className={`nav-cta${showAccess ? " active" : ""}`}
              onClick={() => {
                setShowAccess(true);
                setView("auth");
                setTimeout(
                  () =>
                    document
                      .getElementById("acceso")
                      ?.scrollIntoView({ behavior: "smooth" }),
                  0,
                );
              }}
            >
              Login
            </button>
          )}
          {auth.isAdmin && (
            <>
              <button
                className={view === "dashboard" ? "active" : ""}
                onClick={() => setView("dashboard")}
              >
                <LayoutDashboard size={15} /> Panel
              </button>
              <button
                className={view === "registry" ? "active" : ""}
                onClick={() => setView("registry")}
              >
                <BookUser size={15} /> Directorio
              </button>
              <button
                className={view === "validations" ? "active" : ""}
                onClick={() => setView("validations")}
              >
                <UserCheck size={15} /> Solicitudes
              </button>
              <button
                className={view === "participants" ? "active" : ""}
                onClick={() => setView("participants")}
              >
                <Users size={15} /> Participantes
              </button>
              <button
                className={view === "reputation" ? "active" : ""}
                onClick={() => setView("reputation")}
              >
                <ShieldCheck size={15} /> Reputación
              </button>
              <button
                className={view === "notifications" ? "active" : ""}
                onClick={() => setView("notifications")}
              >
                <RefreshCw size={15} /> Notificaciones
              </button>
              <button
                className={view === "matching" ? "active" : ""}
                onClick={() => setView("matching")}
              >
                <Shuffle size={15} /> Matching
              </button>
              <button
                className={view === "config" ? "active" : ""}
                onClick={() => setView("config")}
              >
                <CalendarCheck size={15} /> Configuración
              </button>
            </>
          )}
        </nav>
      </header>
      <Suspense fallback={<LoadingView />}>
        {view === "reset-password" ? (
          <ResetPasswordPanel />
        ) : view === "auth" ? (
          <AuthPanel
            showAccess={showAccess}
            onShowAccess={() => {
              setShowAccess(true);
              setTimeout(
                () =>
                  document
                    .getElementById("acceso")
                    ?.scrollIntoView({ behavior: "smooth" }),
                0,
              );
            }}
            onPublicSignupStart={() => setPublicSignupActive(true)}
            onAuthenticated={() => setPublicSignupActive(false)}
          />
        ) : !auth.user &&
          (view === "profile" || view === "signup" || view === "meetings") ? (
          <AuthPanel
            showAccess
            onShowAccess={() => setShowAccess(true)}
            onPublicSignupStart={() => setPublicSignupActive(true)}
            onAuthenticated={() => setPublicSignupActive(false)}
          />
        ) : auth.isAdmin && ["profile", "signup"].includes(view) ? (
          <section className="verify-view">
            <div className="completion-card">
              <ShieldCheck />
              <h1>Cuenta administrativa</h1>
            </div>
          </section>
        ) : !auth.isAdmin &&
          [
            "dashboard",
            "registry",
            "validations",
            "participants",
            "reputation",
            "notifications",
            "matching",
            "config",
          ].includes(view) ? (
          <section className="verify-view">
            <div className="completion-card">
              <ShieldCheck />
              <h1>Acceso administrativo</h1>
            </div>
          </section>
        ) : view === "dashboard" ? (
          <AdminDashboard onNavigate={setView} />
        ) : view === "meetings" ? (
          <MeetingsPanel />
        ) : view === "profile" ? (
          <ProfilePanel />
        ) : view === "signup" ? (
          <RegistrationPanel />
        ) : view === "verify" ? (
          <section className="verify-view">
            <div className="eyebrow">
              <ShieldCheck size={14} /> Comunidad verificada
            </div>
            <h1>Confirma tus datos para comenzar.</h1>
            <p className="lede">
              Puedes completar tu perfil y disponibilidad aunque tu solicitud
              quede pendiente. Solo participarás en el matching cuando seas
              aprobado.
            </p>
            <form className="verify-card" onSubmit={verify}>
              <label>
                Correo registrado
                <input
                  type="email"
                  value={verification.email}
                  onChange={(e) =>
                    setVerification({ ...verification, email: e.target.value })
                  }
                />
              </label>
              <span className="or">o</span>
              <label>
                WhatsApp registrado
                <input
                  value={verification.phone}
                  onChange={(e) =>
                    setVerification({ ...verification, phone: e.target.value })
                  }
                />
              </label>
              <button
                className="primary"
                disabled={
                  !verification.email.trim() && !verification.phone.trim()
                }
              >
                <Search size={17} /> Comprobar padrón
              </button>
            </form>
            {result && (
              <div
                className={`verification-result ${result.entry || result.basis === "ambiguous" ? "pending" : "missing"}`}
              >
                {result.entry ? (
                  <>
                    <CheckCircle2 />
                    <div>
                      <strong>Coincidencia sugerida</strong>
                      <p>
                        Encontramos a {result.entry.fullName} en el padrón. Un
                        administrador debe revisar y aprobar la cuenta.
                      </p>
                      <button className="primary">
                        Completar perfil y disponibilidad
                      </button>
                    </div>
                  </>
                ) : result.basis === "ambiguous" ? (
                  <>
                    <UserCheck />
                    <div>
                      <strong>Revisión manual necesaria</strong>
                      <p>
                        Encontramos varias coincidencias. Puedes continuar; no
                        entrarás al matching hasta que un administrador resuelva
                        la solicitud.
                      </p>
                      <button className="primary">
                        Continuar como pendiente
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle />
                    <div>
                      <strong>Solicitud pendiente</strong>
                      <p>
                        No hubo una coincidencia confiable. Puedes completar tus
                        datos para que el equipo del club los revise.
                      </p>
                      <button className="primary">Completar perfil</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        ) : view === "registry" ? (
          <section className="registry-view">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <ShieldCheck size={14} /> Administración
                </div>
                <h1>Directorio de la comunidad</h1>
                <p>
                  Base de datos de miembros verificados de la comunidad.
                  Cuando alguien se inscribe con un correo o celular que ya
                  está aquí, se aprueba automáticamente — sin pasar por
                  revisión manual.
                </p>
              </div>
              <div className="heading-actions">
                <label className="secondary upload">
                  <FileUp size={17} /> Importar CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => void selectCsv(e.target.files?.[0])}
                  />
                </label>
                <button
                  className="primary"
                  onClick={() =>
                    setEditing({
                      ...emptyEntry(),
                      school: schools[0]?.id ?? "harvard",
                    })
                  }
                >
                  <Plus size={17} /> Agregar
                </button>
              </div>
            </div>
            <div className="stats stats-single">
              <article>
                <span>En el directorio</span>
                <strong>{counts.all}</strong>
              </article>
            </div>
            <div className="table-card">
              <div className="table-toolbar registry-toolbar">
                <label className="search">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setRegistryPage(1);
                    }}
                    placeholder="Buscar nombre, correo, teléfono o afiliación"
                  />
                </label>
                <select
                  value={registrySchool}
                  onChange={(event) => {
                    setRegistrySchool(event.target.value as School | "");
                    setRegistryPage(1);
                  }}
                  aria-label="Filtrar por afiliación"
                >
                  <option value="">Todas las afiliaciones</option>
                  {schools.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  value={registryRegistered}
                  onChange={(event) => {
                    setRegistryRegistered(
                      event.target.value as typeof registryRegistered,
                    );
                    setRegistryPage(1);
                  }}
                  aria-label="Filtrar por estado"
                >
                  <option value="all">Todos los estados</option>
                  <option value="registered">Activo</option>
                  <option value="unregistered">Sin registrar</option>
                </select>
                <input
                  className="compact-filter"
                  type="number"
                  min="1900"
                  max="2100"
                  value={registryYear}
                  onChange={(event) => {
                    setRegistryYear(event.target.value);
                    setRegistryPage(1);
                  }}
                  placeholder="Año"
                  aria-label="Filtrar por año"
                />
                <span>
                  {registryLoading
                    ? "Cargando…"
                    : `${registryTotalItems} registros`}
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Miembro</th>
                      <th>Afiliación</th>
                      <th>Año</th>
                      <th>Contacto</th>
                      <th>Origen</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRegistry.map((entry) => (
                      <tr
                        key={entry.id}
                        className={!entry.active ? "inactive-row" : ""}
                      >
                        <td>
                          <strong>{entry.fullName}</strong>
                          {entry.notes && <small>{entry.notes}</small>}
                        </td>
                        <td>{schoolLabel(entry.school, schools)}</td>
                        <td>{entry.graduationYear}</td>
                        <td>
                          <span>{entry.email || "—"}</span>
                          <small>{entry.phone || "—"}</small>
                        </td>
                        <td>{entry.source}</td>
                        <td>
                          <span
                            className={`badge ${entry.registered ? "approved" : "inactive"}`}
                          >
                            {entry.registered ? "Activo" : "Sin registrar"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            onClick={() => setEditing(entry)}
                            title="Editar"
                          >
                            <Pencil size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={safeRegistryPage}
                totalPages={registryPages}
                totalItems={registryTotalItems}
                pageSize={registryPageSize}
                onPageChange={setRegistryPage}
              />
            </div>
          </section>
        ) : view === "matching" ? (
          <MatchingPanel />
        ) : view === "validations" ? (
          <ValidationPanel />
        ) : view === "participants" ? (
          <ParticipantsPanel />
        ) : view === "reputation" ? (
          <ReputationPanel />
        ) : view === "notifications" ? (
          <NotificationMonitorPanel />
        ) : (
          <ConfigPanel />
        )}
      </Suspense>
      {editing && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={upsert}>
            <div className="modal-head">
              <div>
                <h2>
                  {entries.some((e) => e.id === editing.id)
                    ? "Editar alumni"
                    : "Agregar alumni"}
                </h2>
                <p>La desactivación conserva relaciones e historial.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setEditing(null)}
              >
                <X />
              </button>
            </div>
            <div className="form-grid">
              <label className="wide">
                Nombre
                <input
                  required
                  value={editing.fullName}
                  onChange={(e) =>
                    setEditing({ ...editing, fullName: e.target.value })
                  }
                />
              </label>
              <label>
                Correo
                <input
                  type="email"
                  value={editing.email}
                  onChange={(e) =>
                    setEditing({ ...editing, email: e.target.value })
                  }
                />
              </label>
              <label>
                Teléfono
                <input
                  value={editing.phone}
                  onChange={(e) =>
                    setEditing({ ...editing, phone: e.target.value })
                  }
                />
              </label>
              <label>
                Escuela
                <select
                  value={editing.school}
                  onChange={(e) =>
                    setEditing({ ...editing, school: e.target.value as School })
                  }
                >
                  {schools.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Año
                <input
                  type="number"
                  min="1900"
                  max="2100"
                  value={editing.graduationYear}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      graduationYear: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="wide">
                Notas
                <textarea
                  value={editing.notes}
                  onChange={(e) =>
                    setEditing({ ...editing, notes: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(null)}
              >
                Cancelar
              </button>
              <button className="primary">Guardar</button>
            </div>
          </form>
        </div>
      )}
      {preview && (
        <div className="modal-backdrop">
          <div className="modal import-modal">
            <div className="modal-head">
              <div>
                <h2>Previsualizar importación</h2>
                <p>Nada se guarda hasta confirmar.</p>
              </div>
              <button className="icon-button" onClick={() => setPreview(null)}>
                <X />
              </button>
            </div>
            <div className="import-summary">
              {preview.filter((r) => r.entry && !r.duplicate).length} nuevos ·{" "}
              {preview.filter((r) => r.duplicate).length} duplicados ·{" "}
              {preview.filter((r) => r.errors.length).length} con errores
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Nombre</th>
                    <th>Contacto</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.entry?.fullName || "—"}</td>
                      <td>{r.entry?.email || r.entry?.phone || "—"}</td>
                      <td>
                        {r.errors.join(", ") ||
                          (r.duplicate ? "Posible duplicado" : "Listo")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setPreview(null)}>
                Cancelar
              </button>
              <button className="primary" onClick={() => void commitImport()}>
                Importar registros válidos
              </button>
            </div>
          </div>
        </div>
      )}
      <footer className="site-footer">
        <span>© 2026 CALIMA MEDIA LLC</span>
        <a href="/privacy">Política de Privacidad</a>
        <a href="/terms">Condiciones del Servicio</a>
        <a href="mailto:coffeemeet.clientes@gmail.com">Contacto</a>
      </footer>
    </main>
  );
}
export default App;

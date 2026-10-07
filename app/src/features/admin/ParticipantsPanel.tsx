import { useEffect, useMemo, useState } from "react";
import { Clock3, LogOut, Search, Trash2, Users } from "lucide-react";
import {
  adminDeleteAccount,
  adminWithdrawWeeklyParticipation,
  loadAdminParticipantsPage,
  loadConfirmedPreviousWeekPage,
  loadLiveConfirmationsPage,
  type AdminParticipant,
  type ConfirmedPreviousWeekPage,
  type LiveConfirmationsPage,
  type LiveParticipant,
  type WeeklyParticipant,
  type WeeklyStatus,
} from "../../data/adminParticipantsRepository.ts";
import { loadParticipants, removeParticipant } from "../../data/participants.ts";
import { loadMeetingConfig } from "../../data/meetingConfig.ts";
import { schoolLabel } from "../../domain/coffeemeet.ts";
import { useAuth } from "../auth/useAuth.ts";
import { Pagination } from "./Pagination.tsx";
import { useToast } from "../feedback/ToastProvider.tsx";
import { confirmDestructive } from "../feedback/confirmDestructive.ts";

const pageSize = 10;
const WEEKDAYS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];
function shortDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()}/${d.getMonth() + 1}`;
}
function confirmedAtLabel(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const weekday = WEEKDAYS[d.getDay()];
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "p.m." : "a.m.";
  hours = hours % 12 || 12;
  return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${d.getDate()}/${d.getMonth() + 1}, ${hours}:${minutes} ${ampm}`;
}

type Tab = "registered" | "previous" | "live";
const emptyPrevious: ConfirmedPreviousWeekPage = {
  items: [],
  total: 0,
  previousWeekCode: "",
  previousWeekMonday: "",
  counts: { confirmed: 0, notConfirmed: 0, withdrawn: 0 },
};
const emptyLive: LiveConfirmationsPage = {
  windowOpen: false,
  items: [],
  total: 0,
  counts: { confirmed: 0, pending: 0, withdrawn: 0 },
  opensAt: "",
  closesAt: "",
};

export function ParticipantsPanel() {
  const auth = useAuth();
  const toast = useToast();
  const remote = auth.configured && auth.isAdmin;
  const weekCode = loadMeetingConfig().weekCode;
  const [tab, setTab] = useState<Tab>("registered");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const [registered, setRegistered] = useState<AdminParticipant[]>([]);
  const [registeredTotal, setRegisteredTotal] = useState(0);
  const [selectedRegistered, setSelectedRegistered] =
    useState<AdminParticipant>();

  const [previousFilter, setPreviousFilter] = useState<WeeklyStatus>();
  const [previous, setPrevious] = useState(emptyPrevious);
  const [selectedPrevious, setSelectedPrevious] =
    useState<WeeklyParticipant>();

  const [live, setLive] = useState(emptyLive);
  const [selectedLive, setSelectedLive] = useState<LiveParticipant>();

  const [loading, setLoading] = useState(remote);

  const localParticipants: AdminParticipant[] = loadParticipants()
    .filter((p) => p.verificationStatus === "approved")
    .map((p) => ({
      id: p.id,
      fullName: p.fullName,
      email: p.email,
      alumniEmail: p.alumniEmail,
      phone: p.phone,
      linkedinUrl: p.linkedin,
      school: p.school,
      graduationYear: p.graduationYear,
      createdAt: p.updatedAt,
    }));
  const localFiltered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return !needle
      ? localParticipants
      : localParticipants.filter((p) =>
          [p.fullName, p.email, p.alumniEmail, p.phone].some((value) =>
            value.toLowerCase().includes(needle),
          ),
        );
  }, [localParticipants, query]);

  function switchTab(next: Tab) {
    setTab(next);
    setQuery("");
    setPage(1);
    setPreviousFilter(undefined);
    setSelectedRegistered(undefined);
    setSelectedPrevious(undefined);
    setSelectedLive(undefined);
  }

  useEffect(() => {
    if (!remote || tab !== "registered") return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadAdminParticipantsPage({ query, page, pageSize })
        .then((result) => {
          if (!active) return;
          setRegistered(result.participants);
          setRegisteredTotal(result.total);
        })
        .catch(() => {
          if (active) toast.error("No pudimos cargar los participantes.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tab, page, query, refreshKey, remote, toast]);

  useEffect(() => {
    if (!remote || tab !== "previous") return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadConfirmedPreviousWeekPage({
        weekCode,
        query,
        filter: previousFilter,
        page,
        pageSize,
      })
        .then((result) => {
          if (!active) return;
          setPrevious(result);
        })
        .catch(() => {
          if (active)
            toast.error("No pudimos cargar la semana previa confirmada.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tab, page, query, previousFilter, refreshKey, remote, weekCode, toast]);

  useEffect(() => {
    if (!remote || tab !== "live") return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadLiveConfirmationsPage({ weekCode, query, page, pageSize })
        .then((result) => {
          if (!active) return;
          setLive(result);
        })
        .catch(() => {
          if (active) toast.error("No pudimos cargar las confirmaciones en vivo.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tab, page, query, refreshKey, remote, weekCode, toast]);

  async function confirmDeleteAccount(id: string, fullName: string) {
    const ok = await confirmDestructive({
      title: "Borrar cuenta",
      text: `Se eliminarán de forma permanente el perfil, disponibilidad, contactos conocidos, citas e historial de ${fullName}. Esta acción no se puede deshacer.`,
      confirmText: "Sí, borrar esta cuenta",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      if (remote) {
        await adminDeleteAccount(id);
      } else {
        removeParticipant(id);
      }
      toast.success(`Cuenta de ${fullName} borrada.`);
      setSelectedRegistered(undefined);
      setSelectedPrevious(undefined);
      setSelectedLive(undefined);
      setRefreshKey((value) => value + 1);
    } catch {
      toast.error("No pudimos borrar la cuenta. Intenta de nuevo.");
    } finally {
      setDeleting(false);
    }
  }

  async function withdrawThisWeek(participant: LiveParticipant) {
    const ok = await confirmDestructive({
      title: "Retirar de esta semana",
      text: `${participant.fullName} no entrará al sorteo de esta semana. Podrá volver a confirmar normalmente la próxima semana, sin hacer nada especial.`,
      confirmText: "Sí, retirar de esta semana",
    });
    if (!ok) return;
    setWithdrawing(true);
    try {
      await adminWithdrawWeeklyParticipation(participant.id, weekCode);
      toast.success(`${participant.fullName} quedó retirado de esta semana.`);
      setSelectedLive(undefined);
      setRefreshKey((value) => value + 1);
    } catch {
      toast.error("No pudimos retirar a este participante. Intenta de nuevo.");
    } finally {
      setWithdrawing(false);
    }
  }

  const registeredItems = remote ? registered : localFiltered;
  const registeredTotalItems = remote ? registeredTotal : localFiltered.length;
  const registeredPages = Math.max(
    1,
    Math.ceil(registeredTotalItems / pageSize),
  );
  const safeRegisteredPage = Math.min(page, registeredPages);
  const visibleRegistered = remote
    ? registeredItems
    : registeredItems.slice(
        (safeRegisteredPage - 1) * pageSize,
        safeRegisteredPage * pageSize,
      );

  const previousPages = Math.max(1, Math.ceil(previous.total / pageSize));
  const livePages = Math.max(1, Math.ceil(live.total / pageSize));

  const previousLabel: Record<WeeklyStatus, string> = {
    confirmed: "Confirmó",
    not_confirmed: "No confirmó",
    withdrawn: "Se retiró",
  };
  const previousChipLabel: Record<WeeklyStatus, string> = {
    confirmed: "Confirmaron",
    not_confirmed: "No confirmaron",
    withdrawn: "Se retiraron",
  };
  const liveLabel: Record<LiveParticipant["status"], string> = {
    confirmed: "Confirmado",
    pending: "Pendiente",
    withdrawn: "Retirado",
  };
  const previousTone: Record<WeeklyStatus, string> = {
    confirmed: "tone-green",
    not_confirmed: "tone-crimson",
    withdrawn: "tone-muted",
  };
  const liveTone: Record<LiveParticipant["status"], string> = {
    confirmed: "tone-green",
    pending: "tone-gold",
    withdrawn: "tone-crimson",
  };

  return (
    <section className="registry-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Users size={14} /> Administración
          </div>
          <h1>Participantes</h1>
        </div>
      </div>
      <div className="participants-tabs">
        <button
          className={tab === "registered" ? "active" : ""}
          onClick={() => switchTab("registered")}
        >
          Registrados <em>{registeredTotalItems}</em>
        </button>
        <button
          className={tab === "previous" ? "active" : ""}
          onClick={() => switchTab("previous")}
        >
          Confirmados — semana previa <em>{previous.counts.confirmed}</em>
        </button>
        <button
          className={tab === "live" ? "active" : ""}
          onClick={() => switchTab("live")}
        >
          <span className="live-dot" /> Confirmaciones en vivo — semana actual
        </button>
      </div>

      {tab === "previous" && (
        <p className="tab-hint">
          Corte fijo del lunes {shortDate(previous.previousWeekMonday)}, 10:00
          a.m. — no cambia hasta la próxima semana. Toca una categoría para
          filtrar la lista.
        </p>
      )}
      {tab === "live" && (
        <div className="window-notice">
          <Clock3 size={16} />
          Esta vista solo tiene datos entre <strong>domingo 7 p.m.</strong> y{" "}
          <strong>lunes 10 a.m.</strong> — la ventana de confirmación de la
          semana entrante. Fuera de esa ventana aparece vacía.
        </div>
      )}

      {tab === "previous" && (
        <div className="status-chip-row">
          <button
            type="button"
            className={`status-chip tone-green ${previousFilter === "confirmed" ? "active" : ""}`}
            onClick={() => {
              setPreviousFilter(
                previousFilter === "confirmed" ? undefined : "confirmed",
              );
              setPage(1);
            }}
          >
            <strong>{previous.counts.confirmed}</strong>
            <span>Confirmaron</span>
          </button>
          <button
            type="button"
            className={`status-chip tone-crimson ${previousFilter === "not_confirmed" ? "active" : ""}`}
            onClick={() => {
              setPreviousFilter(
                previousFilter === "not_confirmed"
                  ? undefined
                  : "not_confirmed",
              );
              setPage(1);
            }}
          >
            <strong>{previous.counts.notConfirmed}</strong>
            <span>No confirmaron</span>
          </button>
          <button
            type="button"
            className={`status-chip tone-muted ${previousFilter === "withdrawn" ? "active" : ""}`}
            onClick={() => {
              setPreviousFilter(
                previousFilter === "withdrawn" ? undefined : "withdrawn",
              );
              setPage(1);
            }}
          >
            <strong>{previous.counts.withdrawn}</strong>
            <span>Se retiraron</span>
          </button>
        </div>
      )}
      {tab === "live" && live.windowOpen && (
        <div className="status-chip-row">
          <div className="status-chip tone-green">
            <strong>{live.counts.confirmed}</strong>
            <span>Confirmados hasta ahora</span>
          </div>
          <div className="status-chip tone-gold">
            <strong>{live.counts.pending}</strong>
            <span>Pendientes de responder</span>
          </div>
          <div className="status-chip tone-crimson">
            <strong>{live.counts.withdrawn}</strong>
            <span>Retirados de esta semana</span>
          </div>
        </div>
      )}

      {tab === "previous" && previousFilter && (
        <p className="tab-filter-note">
          Mostrando: <strong>{previousChipLabel[previousFilter]}</strong> (
          {previous.total}) — filtro activo por el chip de arriba.
        </p>
      )}

      {(tab !== "live" || live.windowOpen) && (
        <div className="validation-layout">
          <div className="table-card">
            <div className="table-toolbar">
              <label className="search">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Buscar participante"
                />
              </label>
              <span>
                {loading
                  ? "Cargando…"
                  : tab === "registered"
                    ? registeredTotalItems
                    : tab === "previous"
                      ? previous.total
                      : live.total}
              </span>
            </div>

            {tab === "registered" &&
              visibleRegistered.map((participant) => (
                <button
                  className={`request-row ${participant.id === selectedRegistered?.id ? "active" : ""}`}
                  key={participant.id}
                  onClick={() => setSelectedRegistered(participant)}
                >
                  <div>
                    <strong>{participant.fullName}</strong>
                    <small>
                      {participant.email} · {participant.phone}
                    </small>
                  </div>
                </button>
              ))}
            {tab === "previous" &&
              previous.items.map((participant) => (
                <button
                  className={`request-row ${participant.id === selectedPrevious?.id ? "active" : ""}`}
                  key={participant.id}
                  onClick={() => setSelectedPrevious(participant)}
                >
                  <div>
                    <strong>{participant.fullName}</strong>
                    <small>{participant.email}</small>
                  </div>
                </button>
              ))}
            {tab === "live" &&
              live.items.map((participant) => (
                <button
                  className={`request-row with-status ${participant.id === selectedLive?.id ? "active" : ""}`}
                  key={participant.id}
                  onClick={() => setSelectedLive(participant)}
                >
                  <div>
                    <strong>{participant.fullName}</strong>
                    <small>{participant.email}</small>
                  </div>
                  <span className={`status-pill ${liveTone[participant.status]}`}>
                    {liveLabel[participant.status]}
                  </span>
                </button>
              ))}

            {!loading &&
              ((tab === "registered" && !visibleRegistered.length) ||
                (tab === "previous" && !previous.items.length) ||
                (tab === "live" && !live.items.length)) && (
                <div className="empty">No hay participantes en esta vista.</div>
              )}

            {tab === "registered" && (
              <Pagination
                page={safeRegisteredPage}
                totalPages={registeredPages}
                totalItems={registeredTotalItems}
                pageSize={pageSize}
                onPageChange={setPage}
                label="participantes"
              />
            )}
            {tab === "previous" && (
              <Pagination
                page={Math.min(page, previousPages)}
                totalPages={previousPages}
                totalItems={previous.total}
                pageSize={pageSize}
                onPageChange={setPage}
                label="participantes"
              />
            )}
            {tab === "live" && (
              <Pagination
                page={Math.min(page, livePages)}
                totalPages={livePages}
                totalItems={live.total}
                pageSize={pageSize}
                onPageChange={setPage}
                label="participantes"
              />
            )}
          </div>

          <div className="table-card review-pane">
            {tab === "registered" &&
              (!selectedRegistered ? (
                <div className="empty-state">
                  <Users />
                  <h2>Selecciona un participante</h2>
                </div>
              ) : (
                <>
                  <div className="section-title">
                    <h2>{selectedRegistered.fullName}</h2>
                  </div>
                  <dl>
                    <dt>Correo</dt>
                    <dd>
                      {selectedRegistered.email ||
                        selectedRegistered.alumniEmail ||
                        "—"}
                    </dd>
                    <dt>Teléfono</dt>
                    <dd>{selectedRegistered.phone || "—"}</dd>
                    <dt>Afiliación</dt>
                    <dd>{schoolLabel(selectedRegistered.school) || "—"}</dd>
                    <dt>Promoción</dt>
                    <dd>{selectedRegistered.graduationYear || "—"}</dd>
                    <dt>LinkedIn</dt>
                    <dd>
                      {selectedRegistered.linkedinUrl ? (
                        <a
                          href={selectedRegistered.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver perfil
                        </a>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </dl>
                  <div className="danger-zone">
                    <h3>Zona de peligro</h3>
                    <p>
                      Borrar esta cuenta elimina permanentemente su perfil,
                      disponibilidad, citas e historial de CoffeeMeet. No es
                      reversible.
                    </p>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={deleting}
                      onClick={() =>
                        void confirmDeleteAccount(
                          selectedRegistered.id,
                          selectedRegistered.fullName,
                        )
                      }
                    >
                      <Trash2 size={15} />{" "}
                      {deleting ? "Borrando…" : "Borrar cuenta"}
                    </button>
                  </div>
                </>
              ))}

            {tab === "previous" &&
              (!selectedPrevious ? (
                <div className="empty-state">
                  <Users />
                  <h2>Selecciona un participante</h2>
                </div>
              ) : (
                <>
                  <div className="section-title">
                    <h2>{selectedPrevious.fullName}</h2>
                    <span
                      className={`status-pill ${previousTone[selectedPrevious.status]}`}
                    >
                      {previousLabel[selectedPrevious.status]} — semana previa
                    </span>
                  </div>
                  <dl>
                    <dt>Correo</dt>
                    <dd>{selectedPrevious.email || "—"}</dd>
                    <dt>Teléfono</dt>
                    <dd>{selectedPrevious.phone || "—"}</dd>
                    <dt>Afiliación</dt>
                    <dd>{schoolLabel(selectedPrevious.school) || "—"}</dd>
                    <dt>LinkedIn</dt>
                    <dd>
                      {selectedPrevious.linkedin ? (
                        <a
                          href={selectedPrevious.linkedin}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver perfil
                        </a>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </dl>
                  <div className="danger-zone">
                    <h3>Zona de peligro</h3>
                    <p>
                      Borrar esta cuenta elimina permanentemente su perfil,
                      disponibilidad, citas e historial de CoffeeMeet. No es
                      reversible.
                    </p>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={deleting}
                      onClick={() =>
                        void confirmDeleteAccount(
                          selectedPrevious.id,
                          selectedPrevious.fullName,
                        )
                      }
                    >
                      <Trash2 size={15} />{" "}
                      {deleting ? "Borrando…" : "Borrar cuenta"}
                    </button>
                  </div>
                  <p className="review-note">
                    Esta semana ya cerró — no hay acción de pausar aquí. Para
                    pausar a alguien antes del cierre, usa la pestaña
                    "Confirmaciones en vivo".
                  </p>
                </>
              ))}

            {tab === "live" &&
              (!selectedLive ? (
                <div className="empty-state">
                  <Users />
                  <h2>Selecciona un participante</h2>
                </div>
              ) : (
                <>
                  <div className="section-title">
                    <h2>{selectedLive.fullName}</h2>
                    <span
                      className={`status-pill ${liveTone[selectedLive.status]}`}
                    >
                      {liveLabel[selectedLive.status]} — semana actual
                    </span>
                  </div>
                  <dl>
                    <dt>Correo</dt>
                    <dd>{selectedLive.email || "—"}</dd>
                    <dt>Teléfono</dt>
                    <dd>{selectedLive.phone || "—"}</dd>
                    <dt>Afiliación</dt>
                    <dd>{schoolLabel(selectedLive.school) || "—"}</dd>
                    {selectedLive.confirmedAt && (
                      <>
                        <dt>Confirmó</dt>
                        <dd>{confirmedAtLabel(selectedLive.confirmedAt)}</dd>
                      </>
                    )}
                  </dl>
                  {selectedLive.status !== "withdrawn" && (
                    <div className="modal-actions">
                      <button
                        type="button"
                        className="danger-button"
                        disabled={withdrawing}
                        onClick={() => void withdrawThisWeek(selectedLive)}
                      >
                        <LogOut size={15} />{" "}
                        {withdrawing ? "Retirando…" : "Retirar de esta semana"}
                      </button>
                    </div>
                  )}
                  <p className="review-note">
                    Disponible solo mientras la ventana de confirmación sigue
                    abierta. No borra la cuenta — la persona vuelve a poder
                    confirmar la próxima semana sin hacer nada.
                  </p>
                </>
              ))}
          </div>
        </div>
      )}
      {tab === "live" && !live.windowOpen && (
        <div className="table-card">
          <div className="empty">
            Fuera de la ventana de confirmación. Vuelve entre el domingo 7:00
            p.m. y el lunes 10:00 a.m.
          </div>
        </div>
      )}
    </section>
  );
}

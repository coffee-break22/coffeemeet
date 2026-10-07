import { useEffect, useState } from "react";
import {
  CalendarDays,
  ExternalLink,
  MapPin,
  Phone,
  Video,
  XCircle,
} from "lucide-react";
import {
  cancelMyMeeting,
  loadMyMeetings,
  type MyMeeting,
} from "../../data/myMeetingsRepository.ts";
import { useAuth } from "../auth/useAuth.ts";
import { confirmDestructive } from "../feedback/confirmDestructive.ts";

const cancelled = new Set(["cancelled_on_time", "late_cancellation"]);
const labels: Record<string, string> = {
  confirmed: "Confirmada",
  attendance_pending: "Esperando asistencia",
  completed: "Realizada",
  no_show: "Inasistencia",
  attendance_disputed: "En revisión",
  cancelled_on_time: "Cancelada",
  late_cancellation: "Cancelación tardía",
};

function place(slotId: string) {
  const parts = slotId.split("|");
  return parts[0] === "virtual"
    ? { virtual: true, label: "Google Meet" }
    : { virtual: false, label: `${parts[1]}, ${parts[0]}` };
}

export function MeetingsPanel() {
  const auth = useAuth();
  const [items, setItems] = useState<MyMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState("");
  const [now] = useState(() => Date.now());
  const requestedMeeting = new URLSearchParams(window.location.search).get(
    "meeting",
  );

  async function refresh() {
    setLoading(true);
    setMessage("");
    try {
      setItems(auth.user?.demo ? [] : await loadMyMeetings());
    } catch {
      setMessage("No pudimos cargar tus citas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void (auth.user?.demo ? Promise.resolve([]) : loadMyMeetings())
      .then((data) => {
        if (active) setItems(data);
      })
      .catch(() => {
        if (active) setMessage("No pudimos cargar tus citas.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.user?.demo]);

  async function requestCancel(item: MyMeeting) {
    const partnerName = item.partner.name
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const ok = await confirmDestructive({
      title: "Cancelar cita",
      html: `<p>Café con <strong>${partnerName}</strong>. La otra persona será notificada y el evento se eliminará de Google Calendar.</p><p style="margin-top:10px"><strong>¿Cómo se clasifica?</strong><br/>Con 3 horas o más de anticipación no hay penalización. Después se registra como cancelación tardía. Si ya completaste antes una cita con esta misma persona, el sistema lo detecta en el historial y la deja exenta automáticamente.</p>`,
      confirmText: "Confirmar cancelación",
    });
    if (ok) await cancel(item);
  }

  async function cancel(item: MyMeeting) {
    setBusy(item.id);
    setMessage("");
    try {
      const result = await cancelMyMeeting(item.id);
      await refresh();
      setMessage(
        result.cancellationExempt
          ? "Cita cancelada. No afecta tu historial porque ya habías completado anteriormente un encuentro con esta persona."
          : result.meetingStatus === "late_cancellation"
            ? "Cita cancelada con menos de 3 horas de anticipación; quedó registrada como tardía."
            : "Cita cancelada a tiempo. La otra persona será notificada.",
      );
    } catch {
      setMessage("No pudimos cancelar la cita. Verifica que siga activa.");
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="registry-view meetings-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <CalendarDays size={14} /> Agenda
          </div>
          <h1>Mis citas</h1>
        </div>
        <button className="secondary" onClick={() => void refresh()} disabled={loading}>
          Actualizar
        </button>
      </div>
      {message && <div className="inline-message">{message}</div>}
      {loading ? (
        <div className="empty-state">
          <CalendarDays />
          <h2>Cargando citas…</h2>
        </div>
      ) : !items.length ? (
        <div className="empty-state">
          <CalendarDays />
          <h2>Aún no tienes citas</h2>
          <p>Cuando se confirme un match, aparecerá aquí.</p>
        </div>
      ) : (
        <div className="meeting-list">
          {items.map((item) => {
            const where = place(item.slotId);
            const scheduled = new Date(item.scheduledAt).getTime();
            const active =
              !cancelled.has(item.status) &&
              item.status !== "completed" &&
              scheduled > now;
            const pastPending =
              !cancelled.has(item.status) &&
              item.status !== "completed" &&
              scheduled <= now;
            return (
              <article
                className={`meeting-card${requestedMeeting === item.id ? " meeting-card-highlighted" : ""}`}
                key={item.id}
              >
                <div className="meeting-date">
                  <strong>
                    {new Intl.DateTimeFormat("es-CO", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    }).format(new Date(item.scheduledAt))}
                  </strong>
                  <span>
                    {new Intl.DateTimeFormat("es-CO", {
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(item.scheduledAt))}
                  </span>
                </div>
                <div className="meeting-main">
                  <span className={`badge ${cancelled.has(item.status) ? "inactive" : "approved"}`}>
                    {item.cancellationExempt
                      ? "Exenta por encuentro previo"
                      : (labels[item.status] ?? item.status)}
                  </span>
                  <h2>Café con {item.partner.name}</h2>
                  <p>{where.virtual ? <Video /> : <MapPin />}{where.label}</p>
                  <div className="meeting-contact">
                    <a href={`tel:${item.partner.phone}`}><Phone /> {item.partner.phone}</a>
                    <a href={`mailto:${item.partner.email}`}>{item.partner.email}</a>
                    {item.partner.linkedin && (
                      <a href={item.partner.linkedin} target="_blank" rel="noreferrer">
                        LinkedIn <ExternalLink />
                      </a>
                    )}
                  </div>
                  {pastPending && (
                    <small className="meeting-past-note">
                      La hora de esta cita ya pasó. Su resultado se registra mediante la encuesta de WhatsApp.
                    </small>
                  )}
                </div>
                <div className="meeting-actions">
                  {item.meetLink && active && (
                    <a className="primary" href={item.meetLink} target="_blank" rel="noreferrer">
                      <Video /> Entrar a Meet
                    </a>
                  )}
                  {active && (
                    <button
                      className="danger-button"
                      disabled={busy === item.id}
                      onClick={() => void requestCancel(item)}
                    >
                      <XCircle /> {busy === item.id ? "Cancelando…" : "Cancelar cita"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

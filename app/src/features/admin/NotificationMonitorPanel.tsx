import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LogOut,
  MessageSquareText,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  loadNotificationPage,
  loadWhatsAppConnection,
  requestWhatsAppCommand,
  retryNotification,
  type NotificationJob,
  type NotificationStatus,
  type WhatsAppConnectionState,
} from "../../data/adminNotificationRepository.ts";
import { Pagination } from "./Pagination.tsx";
const labels: Record<string, string> = {
  calendar: "Google Calendar",
  calendar_cancel: "Cancelar Calendar",
  match_whatsapp: "Aviso de match",
  meeting_reminder: "Recordatorio",
  attendance_survey: "Encuesta",
  meeting_cancelled: "Cancelación",
  weekly_confirmation: "Confirmación semanal",
  weekly_reactivation: "Reactivación",
  availability_update_required: "Actualizar disponibilidad",
  weekly_no_match: "Sin match",
  weekly_holiday: "Festivo",
};
const statusLabels: Record<NotificationStatus, string> = {
  pending: "Pendiente",
  processing: "Procesando",
  succeeded: "Enviada",
  failed: "Fallida",
  cancelled: "Cancelada",
};
const pageSize = 12;
export function NotificationMonitorPanel() {
  const [items, setItems] = useState<NotificationJob[]>([]),
    [filter, setFilter] = useState<"all" | NotificationStatus>("all"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [query, setQuery] = useState(""),
    [queryInput, setQueryInput] = useState(""),
    [viewing, setViewing] = useState<NotificationJob>(),
    [counts, setCounts] = useState<Record<NotificationStatus, number>>({
      pending: 0,
      processing: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    }),
    [retrying, setRetrying] = useState<string>(),
    [connection, setConnection] = useState<WhatsAppConnectionState>(),
    [workerOnline, setWorkerOnline] = useState(false),
    [connectionBusy, setConnectionBusy] = useState(false),
    [confirmLogout,setConfirmLogout]=useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await loadNotificationPage(
        filter === "all" ? undefined : filter,
        page,
        pageSize,
        query,
      );
      const nextTotalPages = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > nextTotalPages) {
        setPage(nextTotalPages);
        return;
      }
      setItems(result.items);
      setTotal(result.total);
      setCounts(result.counts);
    } catch {
      setError("No pudimos cargar las notificaciones.");
    } finally {
      setLoading(false);
    }
  }, [filter, page, query]);
  useEffect(() => {
    const debounce = setTimeout(() => {
      setPage(1);
      setQuery(queryInput);
    }, 350);
    return () => clearTimeout(debounce);
  }, [queryInput]);
  const refreshConnection = useCallback(async () => {
    try {
      const next = await loadWhatsAppConnection();
      setConnection(next);
      setWorkerOnline(
        Boolean(
          next.heartbeatAt &&
          new Date().getTime() - new Date(next.heartbeatAt).getTime() < 45000,
        ),
      );
    } catch {
      setWorkerOnline(false);
      setError("No pudimos consultar la conexión de WhatsApp.");
    }
  }, []);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && page === 1) void refresh();
    };
    const initial = setTimeout(() => void refresh(), 0),
      timer = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [page, refresh]);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refreshConnection();
    };
    const initial = setTimeout(() => void refreshConnection(), 0),
      timer = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refreshConnection]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize)),
    safePage = Math.min(page, totalPages);
  async function retry(id: string) {
    setRetrying(id);
    try {
      await retryNotification(id);
      await refresh();
    } catch {
      setError("No se pudo reintentar la notificación.");
    } finally {
      setRetrying(undefined);
    }
  }
  async function connectionCommand(command: "reconnect" | "logout") {
    if(command==="logout"&&!confirmLogout){setConfirmLogout(true);return}
    setConnectionBusy(true);
    setError("");
    try {
      await requestWhatsAppCommand(command);
      setConfirmLogout(false);
      await refreshConnection();
    } catch {
      setError("No se pudo ejecutar la acción sobre WhatsApp.");
    } finally {
      setConnectionBusy(false);
    }
  }
  const statusLabel: Record<string, string> = {
    offline: "Desconectado",
    connecting: "Conectando",
    awaiting_qr: "Esperando escaneo",
    connected: "Conectado",
    reconnecting: "Reconectando",
    logged_out: "Sesión cerrada",
    error: "Error",
  };
  return (
    <section className="registry-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <ShieldCheck size={14} /> Administración
          </div>
          <h1>Monitor de notificaciones</h1>
        </div>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => void Promise.all([refresh(), refreshConnection()])}
        >
          <RefreshCw /> Actualizar
        </button>
      </div>
      {error && <div className="inline-message">{error}</div>}
      <article className="table-card whatsapp-connection-card">
        <div className="whatsapp-connection-info">
          <div className="section-title">
            <h2>Conexión de WhatsApp</h2>
            {connection?.status === "connected" ? <Wifi /> : <WifiOff />}
          </div>
          <div className="connection-status-line">
            <span
              className={`badge ${connection?.status === "connected" ? "approved" : connection?.status === "error" || connection?.status === "logged_out" ? "inactive" : "pending"}`}
            >
              {connection ? statusLabel[connection.status] : "Consultando"}
            </span>
            <span className={workerOnline ? "worker-online" : "worker-offline"}>
              {workerOnline ? "Worker activo" : "Worker sin señal"}
            </span>
          </div>
          {connection?.phone && <p>Número vinculado: +{connection.phone}</p>}
          {connection?.lastError && (
            <p className="notification-error">{connection.lastError}</p>
          )}
          <div className="connection-actions">
            <button
              className="primary"
              disabled={connectionBusy || !workerOnline}
              onClick={() => void connectionCommand("reconnect")}
            >
              <RefreshCw />
              {connection?.status === "logged_out"
                ? "Conectar y generar QR"
                : "Reconectar"}
            </button>
            {connection?.status === "connected" && (
              <button
                className="secondary danger-button"
                disabled={connectionBusy}
                onClick={() => void connectionCommand("logout")}
              >
                <LogOut /> Cerrar sesión
              </button>
            )}
          </div>
        </div>
        {connection?.status === "awaiting_qr" && connection.qrDataUrl && (
          <div className="whatsapp-qr">
            <div>
              <QrCode />
              <strong>Escanea desde WhatsApp</strong>
            </div>
            <img src={connection.qrDataUrl} alt="QR para vincular WhatsApp" />
            <small>Dispositivos vinculados → Vincular dispositivo</small>
          </div>
        )}
      </article>
      <div className="stats notification-stats">
        <article>
          <span>Pendientes</span>
          <strong>{counts.pending ?? 0}</strong>
          <Clock3 />
        </article>
        <article>
          <span>Procesando</span>
          <strong>{counts.processing ?? 0}</strong>
          <RefreshCw />
        </article>
        <article>
          <span>Enviadas</span>
          <strong>{counts.succeeded ?? 0}</strong>
          <CheckCircle2 />
        </article>
        <article>
          <span>Con error</span>
          <strong>{(counts.failed ?? 0) + (counts.cancelled ?? 0)}</strong>
          <AlertTriangle />
        </article>
      </div>
      <div className="reputation-tabs">
        {(
          [
            "all",
            "pending",
            "processing",
            "succeeded",
            "failed",
            "cancelled",
          ] as const
        ).map((status) => (
          <button
            key={status}
            className={filter === status ? "active" : ""}
            onClick={() => {
              setFilter(status);
              setPage(1);
            }}
          >
            {status === "all" ? "Todas" : statusLabels[status]}
          </button>
        ))}
      </div>
      <div className="table-card notification-table">
        <div className="table-toolbar">
          <label className="search">
            <Search size={16} />
            <input
              type="search"
              placeholder="Buscar por nombre o teléfono del destinatario…"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              aria-label="Buscar notificaciones por destinatario"
            />
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th>Intentos</th>
                <th>Destino</th>
                <th>Error</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{labels[item.kind] ?? item.kind}</strong>
                  </td>
                  <td>
                    <span
                      className={`badge ${item.status === "succeeded" ? "approved" : item.status === "failed" || item.status === "cancelled" ? "inactive" : "pending"}`}
                    >
                      {statusLabels[item.status]}
                    </span>
                  </td>
                  <td>
                    {new Date(
                      item.status === "pending" || item.status === "processing"
                        ? item.nextAttemptAt
                        : (item.processedAt ?? item.nextAttemptAt),
                    ).toLocaleString("es-CO")}
                    <small>
                      {item.status === "pending" || item.status === "processing"
                        ? "programada"
                        : "procesada"}
                    </small>
                  </td>
                  <td>{item.attemptCount}</td>
                  <td>
                    <strong>{item.destinationName ?? "Proceso interno"}</strong>
                    <small>{item.destinationPhone ?? "—"}</small>
                  </td>
                  <td>
                    <small className="notification-error">
                      {item.lastError ?? "—"}
                    </small>
                  </td>
                  <td>
                    <div className="notification-row-actions">
                    {item.sentText && (
                      <button
                        className="secondary"
                        onClick={() => setViewing(item)}
                        title="Ver el mensaje enviado"
                      >
                        <MessageSquareText size={16} /> Ver mensaje
                      </button>
                    )}
                    {(item.status === "failed" ||
                      item.status === "cancelled") && (
                      <button
                        className="secondary"
                        disabled={retrying === item.id}
                        onClick={() => void retry(item.id)}
                      >
                        <RefreshCw /> Reintentar
                      </button>
                    )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !items.length && (
          <div className="empty-state">
            <CheckCircle2 />
            <h2>
              {query
                ? "Ninguna notificación coincide con esa búsqueda"
                : "No hay notificaciones en esta vista"}
            </h2>
          </div>
        )}
        <Pagination
          page={safePage}
          totalPages={totalPages}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={setPage}
          label="notificaciones"
        />
      </div>
      {confirmLogout&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setConfirmLogout(false)}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="logout-title"><div className="modal-head"><div><h2 id="logout-title">Cerrar sesión de WhatsApp</h2><p>El número dejará de enviar y recibir mensajes de CoffeeMeet.</p></div></div><p>Para conectarlo nuevamente tendrás que generar y escanear otro código QR.</p><div className="modal-actions"><button className="secondary" onClick={()=>setConfirmLogout(false)}>Volver</button><button className="danger-button" disabled={connectionBusy} onClick={()=>void connectionCommand("logout")}>{connectionBusy?"Cerrando…":"Cerrar sesión"}</button></div></section></div>}
      {viewing && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setViewing(undefined);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sent-message-title"
          >
            <div className="modal-head">
              <div>
                <h2 id="sent-message-title">Mensaje enviado</h2>
                <p>
                  {labels[viewing.kind] ?? viewing.kind} · para{" "}
                  {viewing.destinationName ?? "proceso interno"}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Cerrar"
                onClick={() => setViewing(undefined)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="sent-message-body">{viewing.sentText}</p>
          </section>
        </div>
      )}
    </section>
  );
}

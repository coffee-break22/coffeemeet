import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Search,
  ShieldCheck,
  UserCheck,
  XCircle,
} from "lucide-react";
import {
  decideVerification,
  type VerificationRequest,
} from "../../application/verification.ts";
import { setParticipantVerification } from "../../data/participants.ts";
import {
  loadVerificationRequests,
  saveVerificationRequests,
} from "../../data/verificationRequests.ts";
import {
  loadAdminVerificationPage,
  saveAdminVerificationDecision,
} from "../../data/adminVerificationRepository.ts";
import { useAuth } from "../auth/useAuth.ts";
import { Pagination } from "./Pagination.tsx";
import { useToast } from "../feedback/ToastProvider.tsx";

const pageSize = 8;

export function ValidationPanel() {
  const auth = useAuth();
  const toast = useToast();
  const remote = auth.configured && auth.isAdmin;
  const [requests, setRequests] = useState<VerificationRequest[]>(
    loadVerificationRequests,
  );
  const [selected, setSelected] = useState<VerificationRequest>();
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(remote ? 0 : requests.length);
  const [pendingTotal, setPendingTotal] = useState(
    requests.filter((r) => r.status === "pending").length,
  );
  const [loading, setLoading] = useState(remote);
  const [refreshKey, setRefreshKey] = useState(0);

  const localFiltered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return requests.filter(
      (request) =>
        request.status === "pending" &&
        (!needle ||
          [
            request.snapshot.fullName,
            request.snapshot.email,
            request.snapshot.phone,
          ].some((value) => value.toLowerCase().includes(needle))),
    );
  }, [query, requests]);
  const totalItems = remote ? total : localFiltered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRequests = remote
    ? requests
    : localFiltered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const minimumDataComplete = Boolean(
    selected?.snapshot.fullName &&
      (selected.snapshot.email || selected.snapshot.alumniEmail),
  );

  useEffect(() => {
    if (!remote) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      setLoading(true);
      void loadAdminVerificationPage({
        query,
        status: "pending",
        page,
        pageSize,
      })
        .then((result) => {
          if (!active) return;
          setRequests(result.requests);
          setTotal(result.total);
          setPendingTotal(result.pendingTotal);
        })
        .catch(() => {
          if (active) toast.error("No se pudieron cargar las validaciones.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [page, query, refreshKey, remote, toast]);

  useEffect(() => {
    if (!remote) return;
    const refresh = () => {
      if (document.visibilityState === "visible")
        setRefreshKey((value) => value + 1);
    };
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [remote]);

  function select(request: VerificationRequest) {
    setSelected(request);
    setNotes(request.decision?.notes ?? "");
  }

  async function decide(statusValue: "approved" | "rejected") {
    if (!selected) return;
    try {
      const out = decideVerification(selected, {
        status: statusValue,
        notes,
        actorId: auth.user?.id ?? "local-admin",
      });
      if (remote) {
        await saveAdminVerificationDecision({
          requestId: selected.id,
          status: statusValue,
          notes,
        });
        setSelected(undefined);
        setRefreshKey((value) => value + 1);
      } else {
        const next = requests.map((request) =>
          request.id === selected.id ? out.request : request,
        );
        setRequests(next);
        saveVerificationRequests(next);
        setParticipantVerification(selected.userId, statusValue);
        setPendingTotal(
          next.filter((request) => request.status === "pending").length,
        );
        setSelected(undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      console.error("No se pudo guardar la decisión de validación", error);
      toast.error(
        message.includes("ADMIN_REQUIRED")
          ? "Tu sesión ya no tiene permisos de administrador. Vuelve a iniciar sesión."
          : message.includes("VERIFICATION_NOT_FOUND")
            ? "Esta solicitud ya no existe. Actualiza la lista."
            : message
              ? `No se pudo guardar la decisión: ${message}`
              : "No se pudo guardar la decisión.",
      );
    }
  }

  return (
    <section className="registry-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <UserCheck size={14} /> Administración
          </div>
          <h1>Solicitudes</h1>
          <p>
            Si el correo o el celular de una inscripción coincide con el
            directorio, se aprueba sola, al instante.
          </p>
        </div>
        <div className="validation-count">
          <strong>{pendingTotal}</strong>
          <span>pendiente{pendingTotal === 1 ? "" : "s"}</span>
        </div>
      </div>
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
                placeholder="Buscar solicitud"
              />
            </label>
            <span>{loading ? "Cargando…" : totalItems}</span>
          </div>
          {visibleRequests.map((request) => (
            <button
              className={`request-row ${request.id === selected?.id ? "active" : ""}`}
              key={request.id}
              onClick={() => select(request)}
            >
              <span className={`badge ${request.status}`}>
                {request.status}
              </span>
              <div>
                <strong>{request.snapshot.fullName}</strong>
                <small>
                  {request.snapshot.email} · {request.snapshot.phone}
                </small>
              </div>
            </button>
          ))}
          {!loading && !visibleRequests.length && (
            <div className="empty">No hay solicitudes en esta vista.</div>
          )}
          <Pagination
            page={safePage}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
            label="solicitudes"
          />
        </div>
        <div className="table-card review-pane">
          {!selected ? (
            <div className="empty-state">
              <UserCheck />
              <h2>Selecciona una solicitud</h2>
            </div>
          ) : (
            <>
              <div className="section-title">
                <h2>{selected.snapshot.fullName}</h2>
                <span className={`badge ${selected.status}`}>
                  {selected.status}
                </span>
              </div>
              <div className="no-match-banner">
                <AlertTriangle size={16} />
                No coincide con nadie del directorio — requiere aprobación
                manual.
              </div>
              <div className="comparison comparison-single">
                <div>
                  <h3>Datos registrados</h3>
                  <dl>
                    <dt>Correo</dt>
                    <dd>
                      {selected.snapshot.email ||
                        selected.snapshot.alumniEmail ||
                        "—"}
                    </dd>
                    <dt>Teléfono</dt>
                    <dd>{selected.snapshot.phone || "—"}</dd>
                    <dt>Afiliación</dt>
                    <dd>{selected.snapshot.school || "—"}</dd>
                    <dt>Promoción</dt>
                    <dd>{selected.snapshot.graduationYear || "—"}</dd>
                    <dt>LinkedIn</dt>
                    <dd>
                      {selected.snapshot.linkedin ? (
                        <a
                          href={selected.snapshot.linkedin}
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
                </div>
              </div>
              <label className="decision-notes">
                Notas administrativas
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Motivo o evidencia de la decisión"
                />
              </label>
              {selected.decision && (
                <div className="audit-chip">
                  <ShieldCheck size={14} /> Administrador ·{" "}
                  {new Date(selected.decision.decidedAt).toLocaleString(
                    "es-CO",
                  )}
                </div>
              )}
              <div className="modal-actions">
                <button
                  className="reject-button"
                  onClick={() => void decide("rejected")}
                >
                  <XCircle size={16} /> Rechazar
                </button>
                <button
                  className="primary"
                  disabled={!minimumDataComplete}
                  onClick={() => void decide("approved")}
                >
                  <CheckCircle2 size={16} /> Aprobar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  RefreshCw,
  Shuffle,
} from "lucide-react";
import {
  confirmMatchBatch,
  generateMatchBatch,
  type BatchStore,
  type MatchBatch,
} from "../../application/matchBatches.ts";
import type { MatchParticipant, UnmatchedReason } from "../../domain/matching.ts";
import { loadParticipants } from "../../data/participants.ts";
import { useMeetingConfig } from "../../data/useMeetingConfig.ts";
import { weekRangeLabel, weeklyMatchingOpensAt } from "../../data/meetingConfig.ts";
import {
  cleanupRemoteTestData,
  confirmRemoteMatchBatch,
  loadAdminMatchingData,
  saveRemoteMatchDraft,
} from "../../data/adminMatchingRepository.ts";
import { useAuth } from "../auth/useAuth.ts";
import { loadSimulatedClock } from "../../data/simulatedClockRepository.ts";
import { WeeklyStatusPanel } from "./WeeklyStatusPanel.tsx";
import { useToast } from "../feedback/ToastProvider.tsx";
const KEY = "coffeemeet.match-batches.v1";
const unmatchedReasonLabel: Record<UnmatchedReason, string> = {
  pending_approval: "Aprobación pendiente",
  rejected: "Solicitud rechazada",
  blocked: "Cuenta bloqueada",
  holiday_only: "Solo eligió fechas bloqueadas",
  known_contacts: "Excluido por contactos",
  only_new_people_no_candidates: "Solo quería gente nueva",
  no_compatible_availability: "Nadie más en su horario",
  odd_compatible_pool: "Grupo con número impar de personas",
};
const virtual = (date: string, time: string, city: string) => ({
  id: `v-${date}-${time}`,
  date,
  time,
  mode: "virtual" as const,
  city,
});
const physical = (date: string, time: string, city: string, place: string) => ({
  id: `p-${city}-${date}-${time}`,
  date,
  time,
  mode: "in_person" as const,
  city,
  place,
});
const demoPeople: MatchParticipant[] = [
  {
    id: "ana",
    fullName: "Ana Martínez",
    phone: "+573001110001",
    email: "ana@example.com",
    city: "Bogotá",
    verificationStatus: "approved",
    blocked: false,
    knownPhones: [],
    knownEmails: [],
    onlyNewPeople: false,
    completedMeetingCount: 0,
    slots: [
      physical("2026-09-02", "08:00", "Bogotá", "Café Centro"),
      virtual("2026-09-03", "18:00", "Bogotá"),
    ],
  },
  {
    id: "bruno",
    fullName: "Bruno Silva",
    phone: "+573001110002",
    email: "bruno@example.com",
    city: "Bogotá",
    verificationStatus: "approved",
    blocked: false,
    knownPhones: [],
    knownEmails: [],
    onlyNewPeople: false,
    completedMeetingCount: 2,
    slots: [physical("2026-09-02", "08:00", "Bogotá", "Café Centro")],
  },
  {
    id: "carla",
    fullName: "Carla Ríos",
    phone: "+573001110003",
    email: "carla@example.com",
    city: "Cali",
    verificationStatus: "approved",
    blocked: false,
    knownPhones: [],
    knownEmails: [],
    onlyNewPeople: false,
    completedMeetingCount: 1,
    slots: [virtual("2026-09-03", "18:00", "Cali")],
  },
  {
    id: "diego",
    fullName: "Diego León",
    phone: "+573001110004",
    email: "diego@example.com",
    city: "Bogotá",
    verificationStatus: "approved",
    blocked: false,
    knownPhones: [],
    knownEmails: [],
    onlyNewPeople: false,
    completedMeetingCount: 4,
    slots: [physical("2026-09-02", "08:00", "Bogotá", "Café Centro")],
  },
  {
    id: "elena",
    fullName: "Elena Cruz",
    phone: "+573001110005",
    email: "elena@example.com",
    city: "Medellín",
    verificationStatus: "approved",
    blocked: false,
    knownPhones: [],
    knownEmails: [],
    onlyNewPeople: false,
    completedMeetingCount: 0,
    slots: [virtual("2026-09-03", "18:00", "Medellín")],
  },
  {
    id: "felipe",
    fullName: "Felipe Mora",
    phone: "+573001110006",
    email: "felipe@example.com",
    city: "Bogotá",
    verificationStatus: "pending",
    blocked: false,
    knownPhones: [],
    knownEmails: [],
    onlyNewPeople: false,
    completedMeetingCount: 0,
    slots: [physical("2026-09-02", "08:00", "Bogotá", "Café Centro")],
  },
  {
    id: "gabi",
    fullName: "Gabriela Soto",
    phone: "+573001110007",
    email: "gabi@example.com",
    city: "Bogotá",
    verificationStatus: "approved",
    blocked: true,
    knownPhones: [],
    knownEmails: [],
    onlyNewPeople: false,
    completedMeetingCount: 1,
    slots: [physical("2026-09-02", "08:00", "Bogotá", "Café Centro")],
  },
];
function attemptTimeLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "p.m." : "a.m.";
  hours = hours % 12 || 12;
  const time = `${hours}:${minutes} ${ampm}`;
  if (d.toDateString() === now.toDateString()) return `hoy, ${time}`;
  return `${d.getDate()}/${d.getMonth() + 1}, ${time}`;
}
const load = (): BatchStore => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{"batches":[]}');
  } catch {
    return { batches: [] };
  }
};
export function MatchingPanel() {
  const auth = useAuth();
  const toast = useToast();
  const {
    config,
    loading: configLoading,
    error: configError,
  } = useMeetingConfig(auth.configured);
  const savedPeople = loadParticipants();
  const [weekOverride, setWeekOverride] = useState<string>(),
    [weekInputFocused, setWeekInputFocused] = useState(false),
    [remotePeople, setRemotePeople] = useState<MatchParticipant[]>([]),
    [history, setHistory] = useState([
      { userAId: "ana", userBId: "bruno", completedAt: "2026-05-10" },
    ]),
    [store, setStore] = useState<BatchStore>(load),
    [selectedId, setSelectedId] = useState<string>(),
    [participantCounts, setParticipantCounts] = useState({
      registered: 0,
      approved: 0,
      confirmed: 0,
      eligible: 0,
    }),
    [currentTime, setCurrentTime] = useState(() => Date.now());
  const [simulatedNow, setSimulatedNow] = useState<number>();
  const [testMode, setTestMode] = useState(false);
  const [cleaningTests, setCleaningTests] = useState(false);
  const [matchingRefresh, setMatchingRefresh] = useState(0);
  const weekCode = weekOverride ?? config.weekCode;
  const matchingOpensAt = weeklyMatchingOpensAt(weekCode);
  const effectiveNow = simulatedNow ?? currentTime;
  const matchingIsOpen = Boolean(
    matchingOpensAt && effectiveNow >= matchingOpensAt.getTime(),
  );
  const matchingOpeningLabel = matchingOpensAt?.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  const eligibleSaved = savedPeople.filter(
    (p) => p.weekCode === weekCode && !p.withdrawn,
  );
  const people: MatchParticipant[] = auth.configured
    ? remotePeople
    : savedPeople.length
      ? eligibleSaved
      : demoPeople;
  const names = new Map(people.map((p) => [p.id, p.fullName]));
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!auth.configured) return;
    let cancelled = false;
    const refresh = () =>
      void loadSimulatedClock()
        .then((clock) => {
          if (!cancelled)
            setSimulatedNow(
              clock.enabled && clock.simulatedAt
                ? new Date(clock.simulatedAt).getTime()
                : undefined,
            );
        })
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [auth.configured]);
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(store)), [store]);
  useEffect(() => {
    if (!auth.configured || !auth.isAdmin) return;
    let active = true;
    void loadAdminMatchingData(weekCode)
      .then((data) => {
        if (active) {
          setRemotePeople(data.participants);
          setHistory(data.history);
          setStore({ batches: data.batches });
          setParticipantCounts(data.counts);
        }
      })
      .catch(() => toast.error("No se pudieron cargar los datos de matching."));
    return () => {
      active = false;
    };
  }, [auth.configured, auth.isAdmin, toast, weekCode, matchingRefresh]);
  async function cleanupTests(){
    setCleaningTests(true);
    try{
      const result=await cleanupRemoteTestData();
      if(result.status==='waiting_calendar') toast.info(`El worker está eliminando ${result.pendingCalendar} evento${result.pendingCalendar===1?'':'s'} de Calendar. Repite la limpieza en unos segundos.`);
      else toast.success(`${result.deletedBatches} lote${result.deletedBatches===1?'':'s'} de prueba eliminado${result.deletedBatches===1?'':'s'}.`);
      setMatchingRefresh(value=>value+1);
    }catch(error){
      const detail=error instanceof Error?error.message:'';
      toast.error(detail.includes('PGRST202')?'Falta aplicar la migración 202609040005_test_data_cleanup.sql.':'No se pudieron limpiar las pruebas.');
    }finally{setCleaningTests(false)}
  }
  const current = useMemo(
    () =>
      store.batches.find((b) => b.id === selectedId) ??
      [...store.batches]
        .reverse()
        .find((b) => b.weekCode === weekCode && b.status !== "superseded"),
    [store, selectedId, weekCode],
  );
  async function generate(regenerate = false) {
    try {
      const out = generateMatchBatch(store, {
        weekCode,
        participants: people,
        history,
        blockedDates: config.days
          .filter((day) => day.blocked)
          .map((day) => day.date),
        regenerate,
        isTest: testMode,
      });
      if (auth.configured) {
        const persisted = await saveRemoteMatchDraft(out.batch, regenerate);
        const batch = { ...out.batch, ...persisted };
        setStore({
          batches: out.store.batches.map((item) =>
            item.id === out.batch.id ? batch : item,
          ),
        });
        setSelectedId(batch.id);
      } else {
        setStore(out.store);
        setSelectedId(out.batch.id);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      if (detail.includes("MATCHING_NOT_OPEN"))
        toast.info(`El matching de la semana del ${weekRangeLabel(weekCode)} abre el ${matchingOpeningLabel} (hora de Colombia).`);
      else if (detail.includes("PGRST202") && detail.includes("p_test_mode"))
        toast.error(
          "Falta aplicar en Supabase la migración 202609040002_integral_test_mode.sql.",
        );
      else
        toast.error(
          detail
            ? `No se pudo generar el borrador: ${detail}`
            : "No se pudo generar el borrador de matching.",
        );
    }
  }
  async function confirm(batch: MatchBatch) {
    try {
      if (auth.configured) await confirmRemoteMatchBatch(batch.id);
      const out = confirmMatchBatch(store, batch.id);
      setStore(out.store);
      setSelectedId(out.batch.id);
    } catch {
      toast.error(
        "No se pudo confirmar el lote. Verifica que siga vigente y que ningún participante tenga otro match.",
      );
    }
  }
  return (
    <section className="registry-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Shuffle size={14} /> Operación semanal
          </div>
          <h1>Matching semanal</h1>
        </div>
        <div className="heading-actions">
          <label className="week-range-selector">
            Semana
            <input
              value={
                weekInputFocused
                  ? weekCode
                  : `${weekRangeLabel(weekCode)} (${weekCode})`
              }
              onFocus={() => setWeekInputFocused(true)}
              onBlur={() => setWeekInputFocused(false)}
              onChange={(e) => setWeekOverride(e.target.value)}
              pattern="\d{4}-W\d{2}"
            />
          </label>
          <button
            className="primary"
            disabled={configLoading || (!matchingIsOpen && !testMode)}
            title={
              matchingIsOpen || testMode
                ? "Generar borrador"
                : `Disponible el ${matchingOpeningLabel} (hora de Colombia)`
            }
            onClick={() => void generate(false)}
          >
            <Shuffle size={17} /> Generar borrador
          </button>
        </div>
      </div>
      {!matchingIsOpen && (
        <label className="test-mode-toggle">
          <input
            type="checkbox"
            checked={testMode}
            onChange={(event) => setTestMode(event.target.checked)}
          />
          <span>
            <strong>Modo de prueba</strong>
            <small>
              Cuando está activado, el lote que generes NO cuenta para las
              estadísticas ni la reputación, y se confirma sin esperar el
              horario habitual — pero SÍ envía los WhatsApp reales (match,
              recordatorio y encuesta llegan en segundos, no en horas, para
              poder revisar el flujo rápido).
            </small>
          </span>
        </label>
      )}
      {testMode && (
        <div className="test-mode-banner">
          <FlaskConical size={16} />
          <span>
            Estás en modo de prueba — el próximo lote que generes va a enviar
            WhatsApp reales (en segundos, no en horas), pero no va a contar en
            las estadísticas ni en la reputación.
          </span>
        </div>
      )}
      {!testMode && current?.isTest && (
        <div className="test-mode-banner">
          <FlaskConical size={16} />
          <span>
            El intento que ves abajo se generó en modo de prueba: ya envió sus
            WhatsApp reales, pero no cuenta para las estadísticas. Desmarca
            "Modo de prueba" y pulsa "Generar borrador" si en cambio quieres
            un lote que sí cuente, en cuanto se habilite.
          </span>
        </div>
      )}
      {simulatedNow !== undefined && (
        <div className="inline-message" role="status">
          🕒 Reloj simulado activo: se está usando{" "}
          {new Date(simulatedNow).toLocaleString("es-CO", {
            timeZone: "America/Bogota",
            dateStyle: "long",
            timeStyle: "short",
          })}{" "}
          (hora de Colombia) en vez de la hora real de tu equipo para decidir
          si el matching ya está abierto.
        </div>
      )}
      {auth.configured&&store.batches.some(batch=>batch.isTest)&&(
        <div className="test-cleanup-bar"><span>Los lotes de prueba no afectan la reputación ni el historial productivo.</span><button className="secondary" disabled={cleaningTests} onClick={()=>void cleanupTests()}>{cleaningTests?'Limpiando…':'Limpiar pruebas'}</button></div>
      )}
      {!matchingIsOpen && !testMode && matchingOpeningLabel && (
        <div className="inline-message" role="status">
          El borrador de la semana del {weekRangeLabel(weekCode)} se
          habilitará el {matchingOpeningLabel}, hora de Colombia. Hasta
          entonces los participantes pueden confirmar o modificar su
          disponibilidad.
        </div>
      )}
      <div className="eligibility-note">
        Solo pueden participar en el matching los participantes confirmados.
        Un participante registrado que no confirmó esta semana no entra al
        cálculo, sin importar su disponibilidad guardada.
      </div>
      {configError && (
        <div className="inline-message">
          {configError} Se muestra la última versión disponible.
        </div>
      )}
      <div className="stats stats-single">
        <article>
          <span>Confirmados esta semana</span>
          <strong>
            {auth.configured
              ? participantCounts.confirmed
              : eligibleSaved.length}
          </strong>
        </article>
      </div>
      {!current ? (
        <div className="empty-state">
          <Shuffle />
          <h2>Aún no hay borrador</h2>
          <p>
            Genera la propuesta para revisar parejas y excepciones antes de
            confirmar.
          </p>
        </div>
      ) : (
        <>
          <div className="batch-banner">
            <div>
              <strong>
                Intento {current.revision} —{" "}
                {attemptTimeLabel(current.createdAt)} —{" "}
                {current.result.pairs.length} parejas
              </strong>
              <details className="tech-details">
                <summary>Ver detalles técnicos</summary>
                <dl>
                  <dt>ID</dt>
                  <dd>{current.id}</dd>
                  <dt>Huella</dt>
                  <dd>{current.fingerprint}</dd>
                  <dt>Estado</dt>
                  <dd>
                    {current.isTest
                      ? "Prueba"
                      : current.status === "confirmed"
                        ? "Confirmado"
                        : "Borrador"}
                  </dd>
                </dl>
              </details>
            </div>
            <div className="batch-actions">
              <div>
                <button
                  className="secondary"
                  disabled={current.status === "confirmed"}
                  onClick={() => void generate(true)}
                >
                  <RefreshCw size={15} /> Regenerar
                </button>
                <small>Vuelve a calcular con los datos actuales</small>
              </div>
              <div>
                <button
                  className="primary"
                  disabled={current.status === "confirmed"}
                  onClick={() => void confirm(current)}
                >
                  <CheckCircle2 size={16} /> Confirmar lote
                </button>
                <small>Envía notificaciones reales — no se puede deshacer</small>
              </div>
            </div>
          </div>
          <div className="review-grid">
            <div className="table-card">
              <div className="section-title">
                <h2>Parejas propuestas</h2>
                <span>{current.result.pairs.length}</span>
              </div>
              {current.result.pairs.map((pair, i) => (
                <article
                  className="pair-card"
                  key={`${pair.userAId}-${pair.userBId}`}
                >
                  <div className="pair-number">{i + 1}</div>
                  <div>
                    <strong>
                      {names.get(pair.userAId)} × {names.get(pair.userBId)}
                    </strong>
                    <p>
                      {pair.slot.date} · {pair.slot.time} ·{" "}
                      {pair.slot.mode === "virtual"
                        ? "Virtual"
                        : `${pair.slot.city} · ${pair.slot.place}`}
                    </p>
                    <small>{pair.explanation.join(" · ")}</small>
                  </div>
                  {pair.lastResort && (
                    <div className="score">
                      <em>
                        <AlertTriangle size={12} /> Último recurso
                      </em>
                    </div>
                  )}
                </article>
              ))}
            </div>
            <div className="table-card">
              <div className="section-title">
                <h2>Sin match</h2>
                <span>{current.result.unmatched.length}</span>
              </div>
              {current.result.unmatched.map((item) => (
                <article className="unmatched-card" key={item.userId}>
                  <strong>{names.get(item.userId)}</strong>
                  <span>{unmatchedReasonLabel[item.reason]}</span>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </div>
          {current.status === "confirmed" && (
            <aside className="success-note">
              <CheckCircle2 />
              <p>
                <strong>Prueba confirmada</strong>
              </p>
            </aside>
          )}
        </>
      )}
      <div className="table-card weekly-status-card">
        <WeeklyStatusPanel
          weekCode={weekCode}
          blockedDates={config.days
            .filter((day) => day.blocked)
            .map((day) => day.date)}
        />
      </div>
      <div className="history">
        <h2>Historial de revisiones</h2>
        {store.batches
          .filter((b) => b.weekCode === weekCode)
          .map((b) => (
            <button
              key={b.id}
              onClick={() => setSelectedId(b.id)}
              className={b.id === current?.id ? "active" : ""}
            >
              Intento {b.revision} — {attemptTimeLabel(b.createdAt)} —{" "}
              {b.result.pairs.length} parejas
            </button>
          ))}
      </div>
    </section>
  );
}

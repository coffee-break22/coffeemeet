import { useEffect, useState } from "react";
import { AlertTriangle, Clock3, Pencil, Plus, Settings, Trash2 } from "lucide-react";
import {
  dateForWeekday,
  loadMeetingConfig,
  saveMeetingConfig,
  weekRangeLabel,
  WEEKDAY_ORDER,
  type MeetingConfig,
} from "../../data/meetingConfig.ts";
import {
  loadMeetingConfigChangeImpact,
  loadRemoteMeetingConfig,
  saveRemoteMeetingConfig,
} from "../../data/meetingConfigRepository.ts";
import {
  loadSimulatedClock,
  setSimulatedClock,
  type SimulatedClockState,
} from "../../data/simulatedClockRepository.ts";
import { useAuth } from "../auth/useAuth.ts";
import { useToast } from "../feedback/ToastProvider.tsx";
import { confirmDestructive } from "../feedback/confirmDestructive.ts";
function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export function ConfigPanel() {
  const auth = useAuth();
  const toast = useToast();
  const [config, setConfig] = useState<MeetingConfig>(loadMeetingConfig),
    [hydrated, setHydrated] = useState(!auth.configured);
  const [editingCategoryLabel, setEditingCategoryLabel] = useState(false);
  useEffect(() => {
    if (!auth.configured || !auth.isAdmin) return;
    let active = true;
    void loadRemoteMeetingConfig()
      .then((value) => {
        if (active) {
          setConfig(value);
          setHydrated(true);
        }
      })
      .catch(() =>
        toast.error("No se pudo cargar la configuración de Supabase."),
      );
    return () => {
      active = false;
    };
  }, [auth.configured, auth.isAdmin, toast]);
  useEffect(() => {
    if (!hydrated) return;
    saveMeetingConfig(config);
    if (!auth.configured) return;
    const timer = setTimeout(() => {
      void saveRemoteMeetingConfig(config).catch(() =>
        toast.error("No se pudo guardar la configuración."),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [config, hydrated, auth.configured, toast]);
  const [clock, setClock] = useState<SimulatedClockState>({
      enabled: false,
      simulatedAt: null,
      updatedAt: null,
    }),
    [clockDraftEnabled, setClockDraftEnabled] = useState(false),
    [clockDraftAt, setClockDraftAt] = useState(""),
    [savingClock, setSavingClock] = useState(false);
  useEffect(() => {
    if (!auth.configured || !auth.isAdmin) return;
    let active = true;
    void loadSimulatedClock()
      .then((state) => {
        if (!active) return;
        setClock(state);
        setClockDraftEnabled(state.enabled);
        setClockDraftAt(state.simulatedAt ? toLocalInputValue(state.simulatedAt) : "");
      })
      .catch(() =>
        toast.error("No se pudo cargar el estado del reloj simulado."),
      );
    return () => {
      active = false;
    };
  }, [auth.configured, auth.isAdmin, toast]);
  async function saveClock() {
    setSavingClock(true);
    try {
      const atIso = clockDraftEnabled
        ? new Date(clockDraftAt).toISOString()
        : null;
      await setSimulatedClock(clockDraftEnabled, atIso);
      setClock({
        enabled: clockDraftEnabled,
        simulatedAt: atIso,
        updatedAt: new Date().toISOString(),
      });
      toast.success(
        clockDraftEnabled
          ? "Reloj simulado activado."
          : "Reloj simulado desactivado — todo vuelve a tiempo real.",
      );
    } catch {
      toast.error("No se pudo guardar el reloj simulado.");
    } finally {
      setSavingClock(false);
    }
  }
  const [dialog, setDialog] = useState<{
    kind:
      | "city"
      | "place"
      | "time"
      | "school"
      | "day"
      | "removeSchool";
    cityId?: string;
    value: string;
  }>();
  const usedWeekdays = new Set(config.days.map((day) => day.label));
  const availableWeekdays = WEEKDAY_ORDER.filter(
    (weekday) => !usedWeekdays.has(weekday),
  );
  async function confirmAvailabilityChange(
    next: MeetingConfig,
    title: string,
    option: string,
  ) {
    try {
      const impact = await loadMeetingConfigChangeImpact(next);
      const details = impact.affectedParticipants
        ? `La opción ${option} aparece en la disponibilidad de ${impact.affectedParticipants} participante${impact.affectedParticipants === 1 ? "" : "s"}. ${impact.participantsRequiringUpdate} ${impact.participantsRequiringUpdate === 1 ? "deberá" : "deberán"} actualizarla para participar. Las citas ya creadas y el historial no cambiarán.`
        : `La opción ${option} dejará de aparecer en futuras selecciones. Las citas ya creadas y el historial no cambiarán.`;
      const confirmed = await confirmDestructive({
        title,
        text: details,
        confirmText: "Sí, aplicar cambio",
      });
      if (confirmed) setConfig(next);
      return confirmed;
    } catch {
      toast.error("No pudimos calcular cuántos participantes serían afectados. No se guardó el cambio.");
      return false;
    }
  }
  async function submitDialog() {
    if (!dialog) return;
    const value = dialog.value.trim(),
      id = slug(value);
    if (dialog.kind === "removeSchool" && dialog.cityId) {
      if (config.schools.length === 1) {
        toast.error(`Debe existir al menos una ${config.schoolCategoryLabel.toLowerCase()}.`);
        return;
      }
      setConfig((c) => ({
        ...c,
        schools: c.schools.filter((school) => school.id !== dialog.cityId),
      }));
    } else if (dialog.kind === "school" && value) {
      if (!id || config.schools.some((school) => school.id === id)) {
        toast.error(`Esa ${config.schoolCategoryLabel.toLowerCase()} ya existe o su nombre no es válido.`);
        return;
      }
      setConfig((c) => ({
        ...c,
        schools: [...c.schools, { id, name: value }],
      }));
    } else if (dialog.kind === "city" && value)
      setConfig((c) => ({
        ...c,
        cities: [...c.cities, { id, name: value, places: [] }],
      }));
    else if (dialog.kind === "place" && dialog.cityId && value)
      setConfig((c) => ({
        ...c,
        cities: c.cities.map((city) =>
          city.id === dialog.cityId
            ? {
                ...city,
                places: [...city.places, { id: slug(value), name: value }],
              }
            : city,
        ),
      }));
    else if (dialog.kind === "time") {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        toast.error("Escribe una hora válida en formato HH:MM.");
        return;
      }
      setConfig((c) => ({
        ...c,
        times: [...new Set([...c.times, value])].sort(),
      }));
    } else if (dialog.kind === "day" && value) {
      const weekdayIndex = WEEKDAY_ORDER.indexOf(value);
      if (weekdayIndex === -1) {
        toast.error("Elige un día válido.");
        return;
      }
      setConfig((c) => ({
        ...c,
        days: [
          ...c.days,
          {
            label: value,
            date: dateForWeekday(c.weekCode, weekdayIndex),
            enabled: true,
            blocked: false,
            reason: "",
            disabledOther: false,
            otherReason: "",
          },
        ].sort(
          (a, b) =>
            WEEKDAY_ORDER.indexOf(a.label) - WEEKDAY_ORDER.indexOf(b.label),
        ),
      }));
    }
    setDialog(undefined);
  }
  return (
    <section className="registry-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Settings size={14} /> Administración
          </div>
          <h1>Configuración de encuentros</h1>
          <p className="week-subtitle">
            Semana actual: <strong>{weekRangeLabel(config.weekCode, true)}</strong>{" "}
            <small>(uso interno: {config.weekCode})</small>
          </p>
        </div>
        <span className="autosave">Autoguardado</span>
      </div>
      <div className="config-grid">
        <div className="table-card config-card">
          <div className="section-title">
            {editingCategoryLabel ? (
              <input
                autoFocus
                className="category-label-input"
                value={config.schoolCategoryLabel}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    schoolCategoryLabel: e.target.value,
                  }))
                }
                onBlur={() => setEditingCategoryLabel(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setEditingCategoryLabel(false);
                }}
              />
            ) : (
              <h2>
                {config.schoolCategoryLabel}{" "}
                <button
                  type="button"
                  className="icon-button"
                  title="Renombrar categoría"
                  onClick={() => setEditingCategoryLabel(true)}
                >
                  <Pencil size={14} />
                </button>
              </h2>
            )}
            {config.schoolCategoryEnabled && (
              <button
                className="secondary"
                onClick={() => setDialog({ kind: "school", value: "" })}
              >
                <Plus size={14} /> {config.schoolCategoryLabel}
              </button>
            )}
          </div>
          <label className="category-toggle">
            <input
              type="checkbox"
              checked={config.schoolCategoryEnabled}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  schoolCategoryEnabled: e.target.checked,
                }))
              }
            />
            <span>
              Mi comunidad usa esta categoría (desactívalo si no aplica, por
              ejemplo para un club de barrio)
            </span>
          </label>
          {!config.schoolCategoryEnabled && (
            <p className="category-disabled-note">
              Esta categoría está oculta para tu comunidad. Actívala arriba
              para volver a administrarla.
            </p>
          )}
          {config.schoolCategoryEnabled &&
            config.schools.map((school) => (
              <article className="city-config" key={school.id}>
                <div>
                  <span>
                    <strong>{school.name}</strong>
                  </span>
                  <button
                    className="icon-button"
                    title={`Quitar ${config.schoolCategoryLabel.toLowerCase()}`}
                    onClick={() =>
                      setDialog({
                        kind: "removeSchool",
                        cityId: school.id,
                        value: school.name,
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
        </div>
        <div className="table-card config-card">
          <div className="section-title">
            <h2>Ciudades y lugares</h2>
            <button
              className="secondary"
              onClick={() => setDialog({ kind: "city", value: "" })}
            >
              <Plus size={14} /> Ciudad
            </button>
          </div>
          {config.cities.map((city) => (
            <article className="city-config" key={city.id}>
              <div>
                <strong>{city.name}</strong>
                <button
                  className="icon-button"
                  title="Quitar ciudad"
                  onClick={() =>
                    void confirmAvailabilityChange(
                      {
                        ...config,
                        cities: config.cities.filter(
                          (candidate) => candidate.id !== city.id,
                        ),
                      },
                      "Quitar ciudad",
                      city.name,
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="place-list">
                {city.places.map((place) => (
                  <span key={place.id}>
                    {place.name}
                    <button
                      onClick={() =>
                        void confirmAvailabilityChange(
                          {
                            ...config,
                            cities: config.cities.map((item) =>
                              item.id === city.id
                                ? { ...item, places: item.places.filter((candidate) => candidate.id !== place.id) }
                                : item,
                            ),
                          },
                          "Quitar lugar",
                          place.name,
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  onClick={() =>
                    setDialog({ kind: "place", cityId: city.id, value: "" })
                  }
                >
                  <Plus size={12} /> lugar
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="table-card config-card">
          <div className="section-title">
            <h2>Días y festivos</h2>
            <button
              className="secondary"
              disabled={!availableWeekdays.length}
              title={
                availableWeekdays.length
                  ? undefined
                  : "Ya están configurados los 7 días de la semana"
              }
              onClick={() => setDialog({ kind: "day", value: "" })}
            >
              <Plus size={14} /> Día
            </button>
          </div>
          {config.days.map((day) => (
            <article className="day-config" key={day.date}>
              <label className="switch-line">
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    const next = {
                      ...config,
                      days: config.days.map((item) =>
                        item.date === day.date ? { ...item, enabled } : item,
                      ),
                    };
                    if (enabled) setConfig(next);
                    else void confirmAvailabilityChange(next, "Desactivar día", day.label);
                  }}
                />
                <span>
                  <strong>{day.label}</strong>
                  <small>{day.date}</small>
                </span>
              </label>
              <label className="holiday-toggle">
                <input
                  type="checkbox"
                  checked={day.blocked}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      days: c.days.map((d) =>
                        d.date === day.date
                          ? { ...d, blocked: e.target.checked }
                          : d,
                      ),
                    }))
                  }
                />{" "}
                Inhabilitar por festivo
              </label>
              {day.blocked && (
                <input
                  value={day.reason}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      days: c.days.map((d) =>
                        d.date === day.date
                          ? { ...d, reason: e.target.value }
                          : d,
                      ),
                    }))
                  }
                  placeholder="Motivo opcional"
                />
              )}
              <label
                className={`holiday-toggle ${day.disabledOther ? "active" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={day.disabledOther}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      days: c.days.map((d) =>
                        d.date === day.date
                          ? { ...d, disabledOther: e.target.checked }
                          : d,
                      ),
                    }))
                  }
                />{" "}
                Inhabilitar por otro motivo
              </label>
              {day.disabledOther && (
                <>
                  <input
                    value={day.otherReason}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        days: c.days.map((d) =>
                          d.date === day.date
                            ? { ...d, otherReason: e.target.value }
                            : d,
                        ),
                      }))
                    }
                    placeholder="Motivo"
                  />
                  <small className="other-reason-note">
                    No se envía ningún mensaje ese día — se cancelan todas las
                    notificaciones programadas.
                  </small>
                </>
              )}
            </article>
          ))}
        </div>
        <div className="table-card config-card">
          <div className="section-title">
            <h2>Modalidad virtual</h2>
          </div>
          <div className="rule-note">
            <span className="bullet-dot" />
            <p>
              Virtual siempre está disponible para todas las ciudades — no
              hace falta agregarlo aquí. Si borras un lugar físico que alguien
              ya había elegido, esa persona pierde esa opción la próxima vez
              que se recalculen los matches.
            </p>
          </div>
        </div>
        <div className="table-card config-card">
          <div className="section-title">
            <h2>Horas disponibles</h2>
            <button
              className="secondary"
              onClick={() => setDialog({ kind: "time", value: "17:30" })}
            >
              <Plus size={14} /> Hora
            </button>
          </div>
          <div className="time-list">
            {config.times.map((time) => (
              <span key={time}>
                {time}
                <button
                  onClick={() =>
                    void confirmAvailabilityChange(
                      { ...config, times: config.times.filter((item) => item !== time) },
                      "Quitar hora",
                      time,
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
        {auth.configured && auth.isAdmin && (
          <div className="table-card config-card simulated-clock-card">
            <div className="section-title">
              <h2>
                <Clock3 size={16} /> Reloj simulado
              </h2>
            </div>
            <p className="category-disabled-note">
              Comprime el ciclo semanal (domingo 7pm → lunes 10am → matching →
              recordatorios) para pruebas E2E sin esperar días reales. Afecta
              a TODA la app mientras está activo — no solo a cuentas de
              prueba.
            </p>
            {clock.enabled && (
              <div className="no-match-banner simulated-clock-warning">
                <AlertTriangle size={16} />
                Reloj simulado activo — TODOS los usuarios ven este momento
                como &quot;ahora&quot;, no solo las cuentas de prueba.
              </div>
            )}
            <label className="category-toggle">
              <input
                type="checkbox"
                checked={clockDraftEnabled}
                onChange={(e) => setClockDraftEnabled(e.target.checked)}
              />
              <span>Activar reloj simulado</span>
            </label>
            {clockDraftEnabled && (
              <label>
                Fecha y hora simuladas
                <input
                  type="datetime-local"
                  value={clockDraftAt}
                  onChange={(e) => setClockDraftAt(e.target.value)}
                />
                <small>Se interpreta en la zona horaria de tu navegador.</small>
              </label>
            )}
            <div className="modal-actions">
              <button
                className="primary"
                disabled={
                  savingClock || (clockDraftEnabled && !clockDraftAt)
                }
                onClick={() => void saveClock()}
              >
                {savingClock ? "Guardando…" : "Guardar reloj simulado"}
              </button>
            </div>
            {clock.enabled && clock.simulatedAt && (
              <p className="category-disabled-note">
                Simulando: {new Date(clock.simulatedAt).toLocaleString("es-CO")}
                {clock.updatedAt &&
                  ` · activado ${new Date(clock.updatedAt).toLocaleString("es-CO")}`}
              </p>
            )}
          </div>
        )}
      </div>
      {dialog && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(undefined);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h2>
                {dialog.kind === "city"
                  ? "Agregar ciudad"
                  : dialog.kind === "place"
                    ? "Agregar lugar"
                    : dialog.kind === "time"
                      ? "Agregar hora"
                      : dialog.kind === "day"
                        ? "Agregar día"
                        : dialog.kind === "school"
                          ? `Agregar ${config.schoolCategoryLabel.toLowerCase()}`
                          : dialog.kind === "removeSchool"
                            ? `Quitar ${config.schoolCategoryLabel.toLowerCase()}`
                            : "Agregar"}
              </h2>
            </div>
            {dialog.kind === "removeSchool" ? (
              <p>
                Se quitará <strong>{dialog.value}</strong> de las opciones
                futuras. Los registros existentes conservarán su valor.
              </p>
            ) : dialog.kind === "day" ? (
              <label>
                Día de la semana
                <select
                  autoFocus
                  value={dialog.value}
                  onChange={(event) =>
                    setDialog({ ...dialog, value: event.target.value })
                  }
                >
                  <option value="">Selecciona un día…</option>
                  {availableWeekdays.map((weekday) => (
                    <option key={weekday} value={weekday}>
                      {weekday}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                {dialog.kind === "time" ? "Hora (HH:MM)" : "Nombre"}
                <input
                  autoFocus
                  value={dialog.value}
                  onChange={(event) =>
                    setDialog({ ...dialog, value: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submitDialog();
                  }}
                />
              </label>
            )}
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={() => setDialog(undefined)}
              >
                Volver
              </button>
              <button
                className={
                  dialog.kind === "removeSchool"
                    ? "danger-button"
                    : "primary"
                }
                onClick={() => void submitDialog()}
              >
                {dialog.kind === "removeSchool"
                  ? "Quitar"
                  : "Guardar"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

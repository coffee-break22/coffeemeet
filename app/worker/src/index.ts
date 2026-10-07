import "dotenv/config";
import { google } from "googleapis";
import makeWASocket, {
  DisconnectReason,
  proto,
  useMultiFileAuthState as loadMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import qrcode from "qrcode-terminal";
import { createServer } from "node:http";
import { mkdir, open, readFile, rm, unlink } from "node:fs/promises";
import { parse, resolve } from "node:path";
import {
  confirmParticipation,
  currentWeekCode,
  db,
  incoming,
  jid,
  log,
  publicAppUrl,
} from "./whatsappCommands.js";
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const pollMs = Number(process.env.POLL_INTERVAL_MS ?? 5000),
  authDirectory = resolve(
    process.env.BAILEYS_AUTH_DIR ?? "./auth_info_baileys",
  );
async function resetInvalidAuthState() {
  if (authDirectory === parse(authDirectory).root)
    throw new Error("BAILEYS_AUTH_DIR no puede ser la raíz del disco");
  await rm(authDirectory, { recursive: true, force: true });
  await mkdir(authDirectory, { recursive: true });
  log.info({ authDirectory }, "Invalid Baileys session cleared");
}
const oauth = new google.auth.OAuth2(
  required("GOOGLE_CLIENT_ID"),
  required("GOOGLE_CLIENT_SECRET"),
);
oauth.setCredentials({ refresh_token: required("GOOGLE_REFRESH_TOKEN") });
const calendar = google.calendar({ version: "v3", auth: oauth }),
  calendarId = process.env.GOOGLE_CALENDAR_ID ?? "primary";
const workerLockPath=resolve(`${authDirectory}.worker.lock`);
let workerLock:Awaited<ReturnType<typeof open>>|undefined;
async function acquireWorkerLock(retry=true){
  await mkdir(authDirectory,{recursive:true});
  try{
    workerLock=await open(workerLockPath,'wx');
    await workerLock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    let active=false;
    try{
      const saved=JSON.parse(await readFile(workerLockPath,'utf8')) as {pid?:number};
      if(saved.pid){process.kill(saved.pid,0);active=true}
    }catch{active=false}
    if(active)throw new Error('WORKER_ALREADY_RUNNING: ya existe otra instancia usando esta sesión de WhatsApp.');
    if(!retry)throw new Error('WORKER_LOCK_UNAVAILABLE');
    await unlink(workerLockPath).catch(()=>undefined);
    await acquireWorkerLock(false);
  }
}
async function releaseWorkerLock(){
  await workerLock?.close().catch(()=>undefined);
  workerLock=undefined;
  await unlink(workerLockPath).catch(()=>undefined);
}
type Job = {
  id: string;
  kind: string;
  payload: Record<string, string>;
  attempt_count: number;
  external_id: string | null;
  sent_at: string | null;
};
type Meeting = {
  id: string;
  slot_id: string;
  user_a_id: string;
  user_b_id: string;
  calendar_event_id: string | null;
  meet_link: string | null;
  short_code: string | null;
  status: string;
  is_test: boolean;
};
type Profile = {
  id: string;
  full_name: string;
  calendar_email: string;
  email: string;
  phone: string;
  normalized_phone: string;
  linkedin_url: string | null;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waDelay = () => wait(3000 + Math.floor(Math.random() * 3001));
const jobConcurrency = Math.min(8, Math.max(2, Number(process.env.JOB_CONCURRENCY ?? 4)));
function slot(id: string) {
  const p = id.split("|"),
    virtual = p[0] === "virtual";
  return {
    virtual,
    date: p[virtual ? 1 : 2],
    time: p[virtual ? 2 : 3],
    city: virtual ? "" : p[0],
    place: virtual ? "Virtual" : p[1],
  };
}
const WEEKDAYS = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const MONTHS_LONG = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function formatDate(iso: string) {
  const d = new Date(`${iso}T12:00:00-05:00`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS_LONG[d.getUTCMonth()]}`;
}
async function dayDisabledOther(date: string) {
  const { data: row } = await db
    .from("meeting_config")
    .select("value")
    .eq("key", "current")
    .maybeSingle();
  const days = (row?.value as { days?: { date: string; disabledOther?: boolean; otherReason?: string }[] } | null)
    ?.days;
  const match = days?.find((d) => d.date === date);
  return { disabled: Boolean(match?.disabledOther), reason: match?.otherReason ?? "" };
}
async function context(meetingId: string) {
  const { data: m, error } = await db
    .from("meetings")
    .select("id,slot_id,user_a_id,user_b_id,calendar_event_id,meet_link,short_code,status,is_test")
    .eq("id", meetingId)
    .single();
  if (error) throw error;
  const { data: profiles, error: pe } = await db
    .from("profiles")
    .select(
      "id,full_name,calendar_email,email,phone,normalized_phone,linkedin_url",
    )
    .in("id", [m.user_a_id, m.user_b_id]);
  if (pe) throw pe;
  return { meeting: m as Meeting, profiles: (profiles ?? []) as Profile[] };
}
async function calendarJob(job: Job) {
  const { meeting, profiles } = await context(job.payload.meetingId);
  if (["cancelled_on_time", "late_cancellation"].includes(meeting.status))
    return;
  const s = slot(meeting.slot_id),
    start = `${s.date}T${s.time}:00-05:00`,
    end = new Date(new Date(start).getTime() + 30 * 60000).toISOString(),
    requestId = `coffeemeet-${meeting.id}`;
  const { disabled: dayDisabled, reason: dayDisabledReason } =
    await dayDisabledOther(s.date);
  if (dayDisabled) {
    log.info(
      { meetingId: meeting.id, date: s.date, reason: dayDisabledReason },
      "skipping calendar event and notifications: day disabled by admin",
    );
    return;
  }
  let event = meeting.calendar_event_id
    ? (
        await calendar.events.get({
          calendarId,
          eventId: meeting.calendar_event_id,
        })
      ).data
    : undefined;
  if (!event) {
    const existing = await calendar.events.list({
      calendarId,
      privateExtendedProperty: [`coffeemeetMeetingId=${meeting.id}`],
      maxResults: 1,
      singleEvents: true,
    });
    event = existing.data.items?.[0];
  }
  const attendees = profiles.map((p) => ({
    email: p.calendar_email || p.email,
  }));
  for (const p of profiles)
    if (!(p.calendar_email || p.email))
      log.warn(
        { meetingId: meeting.id, userId: p.id },
        "calendar attendee missing email, invite cannot be delivered",
      );
  if (!event) {
    log.info(
      { meetingId: meeting.id, attendees },
      "creating calendar event with attendees",
    );
    const response = await calendar.events.insert({
      calendarId,
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: {
        summary: "CoffeeMeet · café entre alumni",
        description: `Encuentro de 30 minutos. ID CoffeeMeet: ${meeting.id}`,
        location: s.virtual ? "Google Meet" : `${s.place}, ${s.city}`,
        start: { dateTime: start, timeZone: "America/Bogota" },
        end: { dateTime: end, timeZone: "America/Bogota" },
        attendees,
        extendedProperties: { private: { coffeemeetMeetingId: meeting.id } },
        ...(s.virtual
          ? {
              conferenceData: {
                createRequest: {
                  requestId,
                  conferenceSolutionKey: { type: "hangoutsMeet" },
                },
              },
            }
          : {}),
      },
    });
    event = response.data;
    log.info(
      {
        meetingId: meeting.id,
        eventId: event.id,
        attendees: event.attendees?.map((a) => ({
          email: a.email,
          responseStatus: a.responseStatus,
        })),
      },
      "calendar event created",
    );
  } else if (
    !event.attendees?.some((a) => attendees.some((x) => x.email === a.email))
  ) {
    // El evento ya existía (reintento de job) pero sin los attendees
    // esperados: lo actualizamos para forzar el reenvío del correo de
    // invitación de Google Calendar.
    log.warn(
      { meetingId: meeting.id, eventId: event.id, attendees },
      "reusing calendar event missing attendees, patching to resend invites",
    );
    const patched = await calendar.events.patch({
      calendarId,
      eventId: event.id!,
      sendUpdates: "all",
      requestBody: { attendees },
    });
    event = patched.data;
  }
  const meet =
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
      ?.uri ??
    null;
  if (!event.id) throw new Error("CALENDAR_EVENT_ID_MISSING");
  const { error } = await db
    .from("meetings")
    .update({ calendar_event_id: event.id, meet_link: meet })
    .eq("id", meeting.id);
  if (error) throw error;
  if (s.virtual && !meet) throw new Error("MEET_LINK_PENDING");
  const startMs = new Date(start).getTime(),
    systemNow = await getSystemNow(),
    surveyAt = meeting.is_test
      ? new Date(Date.now() + 45000).toISOString()
      : new Date(startMs + 60 * 60000).toISOString();
  const jobs = profiles.flatMap((p) => [
    {
      kind: "attendance_survey",
      payload: { meetingId: meeting.id, userId: p.id },
      idempotency_key: `attendance-survey:${meeting.id}:${p.id}`,
      next_attempt_at: surveyAt,
    },
    ...(meeting.is_test
      ? [{
          kind: "meeting_reminder",
          payload: { meetingId: meeting.id, userId: p.id, label: "prueba" },
          idempotency_key: `meeting-reminder:test:${meeting.id}:${p.id}`,
          next_attempt_at: new Date(Date.now() + 20000).toISOString(),
        }]
      : (() => {
          // El recordatorio de 24h se omite cuando la cita es el martes
          // antes de las 4:00 p. m.: caería el lunes antes de las 11 a. m.,
          // antes de que la persona sepa quién es su match.
          const meetingDay = new Date(`${s.date}T00:00:00-05:00`).getUTCDay(),
            isEarlyTuesday = meetingDay === 2 && s.time < "16:00";
          return (
            [
              ["24h", 24 * 60],
              ["3h", 3 * 60],
              ["30m", 30],
            ] as const
          )
            .filter(([label]) => !(label === "24h" && isEarlyTuesday))
            .map(([label, minutes]) => ({
              kind: "meeting_reminder",
              payload: { meetingId: meeting.id, userId: p.id, label },
              idempotency_key: `meeting-reminder:${label}:${meeting.id}:${p.id}`,
              next_attempt_at: new Date(
                startMs - Number(minutes) * 60000,
              ).toISOString(),
            }))
            .filter((x) => new Date(x.next_attempt_at).getTime() > systemNow);
        })()),
  ]);
  await db.from("outbox").upsert(jobs, { onConflict: "idempotency_key" });
}
async function calendarCancelJob(job: Job) {
  const { meeting } = await context(job.payload.meetingId);
  let eventId = meeting.calendar_event_id;
  if (!eventId) {
    const existing = await calendar.events.list({
      calendarId,
      privateExtendedProperty: [`coffeemeetMeetingId=${meeting.id}`],
      maxResults: 1,
      singleEvents: true,
    });
    eventId = existing.data.items?.[0]?.id ?? null;
  }
  if (!eventId) {
    const { data: creation } = await db
      .from("outbox")
      .select("status")
      .eq("idempotency_key", `calendar:${meeting.id}`)
      .maybeSingle();
    if (creation?.status === "processing")
      throw new Error("CALENDAR_CREATION_STILL_PROCESSING");
  } else {
    try {
      await calendar.events.delete({ calendarId, eventId, sendUpdates: "all" });
    } catch (error) {
      const status = (error as { code?: number; response?: { status?: number } })
        .response?.status ?? (error as { code?: number }).code;
      if (status !== 404 && status !== 410) throw error;
    }
  }
  const { error } = await db
    .from("meetings")
    .update({ calendar_cancelled_at: new Date().toISOString(), meet_link: null })
    .eq("id", meeting.id);
  if (error) throw error;
}
let socket: WASocket | undefined;
let activeSocket: WASocket | undefined;
let connecting = false;
let suppressAutoReconnect = false;
let lastHeartbeatAt = 0;
const healthServer=createServer((request,response)=>{
  if(request.url!=="/"&&request.url!=="/health"){
    response.writeHead(404,{"content-type":"application/json"});
    response.end(JSON.stringify({ok:false}));
    return;
  }
  response.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});
  response.end(JSON.stringify({ok:true,service:"coffeemeet-worker",whatsapp:socket?"connected":"disconnected"}));
});
async function sendTracked(
  job: Job,
  phone: string,
  text: string,
  quickReplies = false,
) {
  if (job.external_id || job.sent_at) return;
  if (!socket) throw new Error("WHATSAPP_NOT_CONNECTED");
  await waDelay();
  const content = quickReplies
    ? {
        text,
        buttons: [
          { buttonId: "SI", buttonText: { displayText: "Sí" }, type: 1 },
          { buttonId: "NO", buttonText: { displayText: "No" }, type: 1 },
        ],
        headerType: 1,
      }
    : { text };
  const sent = await socket.sendMessage(jid(phone), content as any);
  const { error } = await db.rpc("record_outbox_delivery", {
    p_id: job.id,
    p_external_id: sent?.key.id ?? "",
    p_text: text,
  });
  if (error) throw error;
}
function messageText(
  kind: string,
  me: Profile,
  other: Profile,
  m: Meeting,
  label?: string,
) {
  const s = slot(m.slot_id),
    where = s.virtual
      ? `Google Meet: ${m.meet_link ?? "en preparación"}`
      : `${s.place}, ${s.city}`;
  const calendarUrl = `${publicAppUrl}/cal/${m.short_code}`;
  if (kind === "attendance_survey")
    return `Hola ${me.full_name.split(" ")[0]} 👋 ¿Cómo estuvo tu café con ${other.full_name}? ¿Asististe?\n1️⃣ Sí\n2️⃣ No`;
  if (kind === "meeting_cancelled")
    return `⚠️ Tu match, ${other.full_name}, canceló este encuentro. Quedas libre para la próxima semana.`;
  if (kind === "meeting_reminder") {
    if (label === "24h")
      return `Mañana a las ${s.time} tienes café con ${other.full_name} en ${where}.\n📱 WhatsApp: ${other.phone}\n✉️ ${other.email}${other.linkedin_url ? `\n🔗 ${other.linkedin_url}` : ""}\n\n¿No puedes ir? Responde 1️⃣ para cancelar.`;
    if (label === "3h")
      return `En 3 horas: café con ${other.full_name}, ${where}, ${s.time}.\n📱 WhatsApp: ${other.phone}\n\n¿No puedes ir? Responde 1️⃣ para cancelar.`;
    return `¡En 30 minutos! Café con ${other.full_name} en ${where}.\n\n¿No puedes ir? Responde 1️⃣ para cancelar.`;
  }
  return `☕ Tu café CoffeeMeet de esta semana: ${other.full_name}.\n📅 ${formatDate(s.date)} · ${s.time}\n📍 ${where}\n📱 WhatsApp: ${other.phone}\n✉️ ${other.email}${other.linkedin_url ? `\n🔗 ${other.linkedin_url}` : ""}\n\nRecuerda: cancela con 3+ horas de anticipación si no puedes ir · el café dura 30 minutos · cámara encendida si es virtual.\n\n¿Nos regalas una foto para las redes del club? (opcional)\n\n🗓️ Agrégalo a tu calendario: ${calendarUrl}\n\n¿No puedes ir? Responde:\n1️⃣ Cancelar mi cita`;
}
async function whatsappJob(job: Job) {
  if (!socket) throw new Error("WHATSAPP_NOT_CONNECTED");
  const { meeting, profiles } = await context(job.payload.meetingId);
  const { disabled: dayDisabled, reason: dayDisabledReason } =
    await dayDisabledOther(slot(meeting.slot_id).date);
  if (dayDisabled) {
    log.info(
      { meetingId: meeting.id, kind: job.kind, reason: dayDisabledReason },
      "skipping notification: day disabled by admin",
    );
    return;
  }
  const targetId =
      job.kind === "meeting_cancelled"
        ? profiles.find((p) => p.id !== job.payload.cancelled_by)?.id
        : job.payload.userId,
    me = profiles.find((p) => p.id === targetId),
    other = profiles.find((p) => p.id !== targetId);
  if (!me || !other) throw new Error("PROFILE_NOT_FOUND");
  if (
    ["match_whatsapp", "meeting_reminder"].includes(job.kind) &&
    slot(meeting.slot_id).virtual &&
    !meeting.meet_link
  )
    throw new Error("MEET_LINK_PENDING");
  const body = messageText(job.kind, me, other, meeting, job.payload.label);
  await sendTracked(job, me.phone, body, job.kind === "attendance_survey");
  if (job.kind === "attendance_survey")
    await db.from("survey_sessions").upsert({
      meeting_id: meeting.id,
      user_id: me.id,
      step: "awaiting_occurred",
      updated_at: new Date().toISOString(),
    });
}
function isoMonday(weekCode: string) {
  const [y, w] = weekCode.split("-W").map(Number),
    jan4 = new Date(Date.UTC(y, 0, 4)),
    day = jan4.getUTCDay() || 7;
  return new Date(Date.UTC(y, 0, 4 - day + 1 + (w - 1) * 7));
}
function colombiaAt(date: Date, hour: number) {
  return new Date(
    `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00:00-05:00`,
  );
}
// Reloj simulado (E2E multi-semana): cuando está activo en la base de datos,
// las decisiones del ciclo semanal (corte de confirmación, recordatorios)
// usan este "ahora" en vez del real. Cacheado unos segundos para no golpear
// la base en cada vuelta del loop; el resto del worker (heartbeat, pacing
// del propio loop) sigue usando Date.now() real a propósito.
let cachedSystemNow: { value: number; fetchedAt: number } | null = null;
async function getSystemNow(): Promise<number> {
  const real = Date.now();
  if (cachedSystemNow && real - cachedSystemNow.fetchedAt < 5000)
    return cachedSystemNow.value;
  const { data, error } = await db.rpc("admin_get_simulated_clock");
  const row = Array.isArray(data) ? data[0] : data;
  const value =
    !error && row?.enabled && row.simulated_at
      ? new Date(row.simulated_at as string).getTime()
      : real;
  if (row?.enabled)
    log.warn({ simulatedAt: row.simulated_at }, "reloj simulado activo");
  cachedSystemNow = { value, fetchedAt: real };
  return value;
}
async function scheduleWeeklyConfirmation() {
  // Decisión del cliente (hallazgo 1, pruebas E2E): si solo un lado de la
  // encuesta de asistencia respondió, se usa su reporte como definitivo
  // una vez pasa el domingo de esa semana — deja margen para que
  // conteste el otro lado antes de decidir con uno solo. No bloquea el
  // resto del ciclo semanal si falla.
  await db.rpc("finalize_pending_attendance_reports").then(({ error }) => {
    if (error)
      log.error({ err: error }, "finalize_pending_attendance_reports failed");
  });
  const { error: advanceError } = await db.rpc("advance_weekly_config");
  if (advanceError) throw advanceError;
  const { data: row, error } = await db
    .from("meeting_config")
    .select("value")
    .eq("key", "current")
    .maybeSingle();
  if (error || !row?.value) return;
  const weekCode = String((row.value as { weekCode?: string }).weekCode ?? "");
  if (!/^\d{4}-W\d{2}$/.test(weekCode)) return;
  const monday = isoMonday(weekCode),
    cutoff = colombiaAt(monday, 10);
  if ((await getSystemNow()) >= cutoff.getTime()) {
    await db.rpc("close_weekly_confirmations", { p_week_code: weekCode });
    return;
  }
  await db.rpc("prepare_weekly_confirmations", { p_week_code: weekCode });
  await db.rpc("prepare_weekly_reactivations", { p_week_code: weekCode });
  const { data: pending } = await db
    .from("weekly_participations")
    .select("user_id")
    .eq("week_code", weekCode)
    .eq("status", "pending");
  if (!pending?.length) return;
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() - 1);
  const jobs = pending.flatMap((p) => [
    {
      kind: "weekly_confirmation",
      payload: { userId: p.user_id, weekCode, stage: "sunday" },
      idempotency_key: `weekly-confirmation:sunday:${weekCode}:${p.user_id}`,
      next_attempt_at: colombiaAt(sunday, 19).toISOString(),
    },
    {
      kind: "weekly_confirmation",
      payload: { userId: p.user_id, weekCode, stage: "monday" },
      idempotency_key: `weekly-confirmation:monday:${weekCode}:${p.user_id}`,
      next_attempt_at: colombiaAt(monday, 8).toISOString(),
    },
  ]);
  await db.from("outbox").upsert(jobs, { onConflict: "idempotency_key" });
}
async function weeklyReactivationJob(job: Job) {
  if (!socket) throw new Error("WHATSAPP_NOT_CONNECTED");
  const { data: profile, error } = await db
    .from("profiles")
    .select("id,full_name,phone")
    .eq("id", job.payload.userId)
    .single();
  if (error) throw error;
  const { data: participation } = await db
    .from("weekly_participations")
    .select("status")
    .eq("user_id", profile.id)
    .eq("week_code", job.payload.weekCode)
    .maybeSingle();
  if (participation) return;
  const { data: pref } = await db
    .from("contact_preferences")
    .select("opted_out")
    .eq("user_id", profile.id)
    .maybeSingle();
  if (pref?.opted_out) return;
  await sendTracked(
    job,
    profile.phone,
    `Hola ${profile.full_name.split(" ")[0]} 👋 Hay ${job.payload.newCount} alumni activos esta semana en tu ciudad o virtualmente con quienes todavía no has tomado café. Si quieres participar, responde REACTIVAR antes de las 10:00 a. m. del lunes. Si prefieres no recibir estas invitaciones, responde STOP.`,
  );
}
async function dormantNoticeJob(job: Job) {
  if (!socket) throw new Error("WHATSAPP_NOT_CONNECTED");
  const { data: profile, error } = await db
    .from("profiles")
    .select("id,full_name,phone,dormant_since")
    .eq("id", job.payload.userId)
    .single();
  if (error) throw error;
  // Ya se reactivó antes de que este aviso (agendado para el domingo)
  // llegara a procesarse: no tiene sentido avisarle que está dormido.
  if (!profile.dormant_since) return;
  const { data: lastAvailability } = await db
    .from("weekly_availabilities")
    .select("week_code")
    .eq("user_id", profile.id)
    .eq("is_active", true)
    .order("week_code", { ascending: false })
    .limit(1)
    .maybeSingle();
  const summary = lastAvailability
    ? await availabilitySummary(profile.id, lastAvailability.week_code)
    : "sin disponibilidad guardada";
  await sendTracked(
    job,
    profile.phone,
    `*☕ Te extrañamos por acá — ¿seguimos?*\n\nTu taza de café se siente un poco sola ☕😢 — llevas 3 semanas sin aparecer por CoffeeMeet, y la extrañamos. Tu disponibilidad sigue guardada: ${summary}.\n\nResponde REACTIVAR para volver a participar.`,
  );
}
async function weeklyOutcomeJob(job: Job) {
  if (!socket) throw new Error("WHATSAPP_NOT_CONNECTED");
  const { data: profile, error } = await db
    .from("profiles")
    .select("id,full_name,phone")
    .eq("id", job.payload.userId)
    .single();
  if (error) throw error;
  const { data: participation } = await db
    .from("weekly_participations")
    .select("status")
    .eq("user_id", profile.id)
    .eq("week_code", job.payload.weekCode)
    .maybeSingle();
  if (participation?.status !== "confirmed") return;
  const { data: meeting } = await db
    .from("meetings")
    .select("id")
    .eq("week_code", job.payload.weekCode)
    .or(`user_a_id.eq.${profile.id},user_b_id.eq.${profile.id}`)
    .neq("status", "draft")
    .limit(1)
    .maybeSingle();
  if (meeting) return;
  const first = profile.full_name.split(" ")[0];
  if (job.kind === "weekly_holiday") {
    await sendTracked(
      job,
      profile.phone,
      `🎉 Esta semana hay un festivo que afecta tus días elegidos, así que no hay CoffeeMeet. ¡Nos vemos la próxima semana!`,
    );
    return;
  }
  const alternatives = [
    `😅 Esta semana el algoritmo no encontró a nadie libre para tu café, ${first}. Le echamos la culpa a las matemáticas, no a ti. Nos vemos la próxima semana.`,
    `☕ Esta semana tu café quedó esperando pareja, ${first}. No hubo match compatible, pero tu disponibilidad sigue activa para la próxima ronda.`,
    `🙈 Esta vez el algoritmo se quedó corto contigo, ${first}. Prometemos intentarlo mejor la próxima semana; no necesitas hacer nada.`,
    `🔍 Buscamos y buscamos, ${first}, pero no apareció nadie compatible esta semana. Tu inscripción sigue activa para la próxima.`,
    `😬 Esta semana el café se quedó frío: no hubo con quién emparejarte, ${first}. La próxima semana lo volvemos a intentar.`,
  ];
  let hash = 0;
  for (const char of `${profile.id}:${job.payload.weekCode}`)
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  await sendTracked(
    job,
    profile.phone,
    alternatives[hash % alternatives.length],
  );
}
async function availabilitySummary(userId: string, weekCode: string) {
  const { data: rows } = await db
    .from("weekly_availabilities")
    .select("slot_id")
    .eq("user_id", userId)
    .eq("week_code", weekCode)
    .eq("is_active", true);
  const slots = (rows ?? []).map((r) => slot(r.slot_id));
  const places = Array.from(
      new Set(slots.map((s) => (s.virtual ? "Virtual" : s.place))),
    ),
    dates = Array.from(new Set(slots.map((s) => formatDate(s.date)))),
    times = Array.from(new Set(slots.map((s) => s.time)));
  return places.length
    ? `${places.join(", ")} · ${dates.join(", ")} · ${times.join(", ")}`
    : "sin disponibilidad guardada";
}
async function weeklyConfirmationJob(job: Job) {
  if (!socket) throw new Error("WHATSAPP_NOT_CONNECTED");
  const { data: p, error } = await db
    .from("profiles")
    .select("id,full_name,phone")
    .eq("id", job.payload.userId)
    .single();
  if (error) throw error;
  const { data: participation } = await db
    .from("weekly_participations")
    .select("status")
    .eq("user_id", p.id)
    .eq("week_code", job.payload.weekCode)
    .maybeSingle();
  if (participation?.status !== "pending") return;
  const first = p.full_name.split(" ")[0],
    summary = await availabilitySummary(p.id, job.payload.weekCode),
    options = "Responde con un número:\n1️⃣ Confirmar\n2️⃣ Editar mi disponibilidad\n3️⃣ Cancelar esta semana";
  const text =
    job.payload.stage === "monday"
      ? `⏰ Aún no confirmas tu café de esta semana (${summary}). Si no confirmas antes de las 10:00 a. m., no podrás participar esta semana.\n\n${options}`
      : `Hola ${first} 👋 Tu disponibilidad de esta semana: ${summary}. Confirmar es obligatorio para participar en el sorteo de esta semana.\n\n${options}`;
  await sendTracked(job, p.phone, text);
}
async function weeklyConfirmedAckJob(job: Job) {
  if (!socket) throw new Error("WHATSAPP_NOT_CONNECTED");
  const { data: p, error } = await db
    .from("profiles")
    .select("id,full_name,phone")
    .eq("id", job.payload.userId)
    .single();
  if (error) throw error;
  const first = p.full_name.split(" ")[0];
  await sendTracked(
    job,
    p.phone,
    `✅ Confirmado, ${first}. Participarás en el sorteo de esta semana si hay alguien compatible disponible — te avisamos en cuanto se arme tu match.`,
  );
}
async function accountDeletionJob(job: Job) {
  const { error } = await db.auth.admin.deleteUser(job.payload.userId);
  // Idempotente: si ya no existe en Auth (reintento, o ya se borró antes),
  // lo tratamos como éxito en vez de reintentar para siempre.
  if (error && !/not.*found/i.test(error.message)) throw error;
}
async function processJob(job: Job) {
  if (job.kind === "calendar") await calendarJob(job);
  else if (job.kind === "calendar_cancel") await calendarCancelJob(job);
  else if (job.kind === "weekly_confirmation") await weeklyConfirmationJob(job);
  else if (job.kind === "weekly_confirmed_ack") await weeklyConfirmedAckJob(job);
  else if (job.kind === "weekly_reactivation") await weeklyReactivationJob(job);
  else if (job.kind === "dormant_notice") await dormantNoticeJob(job);
  else if (job.kind === "account_deletion") await accountDeletionJob(job);
  else if (["weekly_no_match", "weekly_holiday"].includes(job.kind))
    await weeklyOutcomeJob(job);
  else if (
    [
      "match_whatsapp",
      "meeting_reminder",
      "attendance_survey",
      "meeting_cancelled",
    ].includes(job.kind)
  )
    await whatsappJob(job);
  else throw new Error(`UNSUPPORTED_JOB:${job.kind}`);
}
async function poll() {
  let lastSchedule = 0,
    lastConnectionControl = 0,
    lastCleanup = 0;
  const inFlight = new Set<Promise<void>>();
  const dispatch = (job: Job) => {
    const task = (async () => {
      try {
        await processJob(job);
        await db.rpc("complete_outbox_job", { p_id: job.id });
        log.info({ jobId: job.id, kind: job.kind }, "job complete");
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await db.rpc("fail_outbox_job", { p_id: job.id, p_error: detail });
        log.error({ jobId: job.id, err: detail }, "job failed");
      }
    })();
    inFlight.add(task);
    void task.finally(() => inFlight.delete(task));
  };
  for (;;) {
    if (Date.now() - lastConnectionControl > 3000) {
      await handleConnectionCommand().catch((error) =>
        log.error({ err: error }, "WhatsApp control failed"),
      );
      lastConnectionControl = Date.now();
    }
    if (Date.now() - lastSchedule > 300000) {
      await scheduleWeeklyConfirmation().catch((error) =>
        log.error({ err: error }, "weekly schedule failed"),
      );
      lastSchedule = Date.now();
    }
    if (Date.now() - lastCleanup > 86400000) {
      await db.rpc("cleanup_operational_notifications").then(({ error }) => {
        if (error && error.code !== "PGRST202")
          log.error({ err: error }, "notification cleanup failed");
      });
      lastCleanup = Date.now();
    }
    if (inFlight.size >= jobConcurrency) {
      await Promise.race(inFlight);
      continue;
    }
    const { data, error } = await db.rpc("claim_outbox_job");
    if (error) {
      log.error({ err: error }, "claim failed");
      await wait(pollMs);
      continue;
    }
    const job = (data?.[0] ?? null) as Job | null;
    if (!job) {
      await wait(pollMs);
      continue;
    }
    dispatch(job);
  }
}
async function updateConnectionState(values: Record<string, unknown>) {
  const { error } = await db.from("whatsapp_worker_state").upsert({
    singleton: true,
    ...values,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
async function handleConnectionCommand() {
  if (Date.now() - lastHeartbeatAt >= 15000) {
    const { error: heartbeatError } = await db
      .from("whatsapp_worker_state")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("singleton", true);
    if (heartbeatError) throw heartbeatError;
    lastHeartbeatAt = Date.now();
  }
  const { data, error } = await db
    .from("whatsapp_worker_state")
    .select("requested_command,status")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw error;
  const command = data?.requested_command as "reconnect" | "logout" | null;
  if (!command) return;
  const { error: clearError } = await db
    .from("whatsapp_worker_state")
    .update({ requested_command: null, requested_at: null })
    .eq("singleton", true)
    .eq("requested_command", command);
  if (clearError) throw clearError;
  suppressAutoReconnect = true;
  const current = activeSocket;
  socket = undefined;
  activeSocket = undefined;
  if (command === "logout") {
    if (current) await current.logout().catch(() => undefined);
    await updateConnectionState({
      status: "logged_out",
      qr_data_url: null,
      phone: null,
      connected_at: null,
      last_error: null,
    });
    suppressAutoReconnect = false;
    return;
  }
  current?.end(new Error("ADMIN_RECONNECT"));
  if (data?.status === "logged_out") await resetInvalidAuthState();
  await updateConnectionState({
    status: "reconnecting",
    qr_data_url: null,
    last_error: null,
  });
  suppressAutoReconnect = false;
  setTimeout(() => void connect(), 500);
}
// Sin esto, cuando WhatsApp pide reenviar un mensaje porque no pudo
// descifrarlo en algún dispositivo del destinatario (típico el celular
// principal, visto como "Esperando el mensaje" sin fin), Baileys no
// tiene cómo volver a cifrarlo y el mensaje nunca llega. Los jobs del
// outbox (sendTracked) ya guardan el texto en outbox.sent_text; las
// respuestas directas a comandos entrantes (incoming(), más abajo) no
// pasan por outbox, así que se guardan aparte en este cache acotado.
const sentMessageCache = new Map<string, string>();
function rememberSent(id: string | null | undefined, text: string) {
  if (!id) return;
  sentMessageCache.set(id, text);
  if (sentMessageCache.size > 500) {
    const oldest = sentMessageCache.keys().next().value;
    if (oldest) sentMessageCache.delete(oldest);
  }
}
async function getMessage(
  key: proto.IMessageKey,
): Promise<proto.IMessage | undefined> {
  if (!key.id) return undefined;
  const cached = sentMessageCache.get(key.id);
  if (cached) return { conversation: cached };
  const { data } = await db
    .from("outbox")
    .select("sent_text")
    .eq("external_id", key.id)
    .maybeSingle();
  return data?.sent_text ? { conversation: data.sent_text } : undefined;
}
async function connect() {
  if (connecting || activeSocket) return;
  connecting = true;
  await updateConnectionState({ status: "connecting", last_error: null }).catch(
    (error) => log.error({ err: error }, "could not publish connecting state"),
  );
  try {
    const { state, saveCreds } = await loadMultiFileAuthState(authDirectory);
    const sock = makeWASocket({
      auth: state,
      logger: log.child({ module: "baileys" }),
      markOnlineOnConnect: false,
      getMessage,
    });
    activeSocket = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        log.info("QR de WhatsApp generado; escanéalo desde Admin > Notificaciones");
        if (process.env.SHOW_QR_IN_TERMINAL === "true")
          qrcode.generate(qr, { small: true });
        void QRCode.toDataURL(qr, { width: 320, margin: 2 })
          .then((qrDataUrl) =>
            updateConnectionState({
              status: "awaiting_qr",
              qr_data_url: qrDataUrl,
              last_error: null,
            }),
          )
          .catch((error) =>
            log.error({ err: error }, "could not publish WhatsApp QR"),
          );
      }
      if (connection === "open") {
        socket = sock;
        void updateConnectionState({
          status: "connected",
          qr_data_url: null,
          phone: sock.user?.id.split(":")[0] ?? null,
          connected_at: new Date().toISOString(),
          last_error: null,
        });
        log.info("WhatsApp connected");
      }
      if (connection === "close") {
        if (socket === sock) socket = undefined;
        if (activeSocket === sock) activeSocket = undefined;
        const status = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = status === DisconnectReason.loggedOut;
        void updateConnectionState({
          status: loggedOut ? "logged_out" : "offline",
          qr_data_url: null,
          last_error: loggedOut
            ? "La sesión fue cerrada. Vuelve a conectar para generar un QR."
            : lastDisconnect?.error instanceof Error
              ? lastDisconnect.error.message
              : null,
        });
        if (!loggedOut && !suppressAutoReconnect)
          setTimeout(() => void connect(), 3000);
        else if (loggedOut) log.error("WhatsApp logged out");
        if (!loggedOut)
          log.warn({ status, retryInMs: 3000 }, "WhatsApp disconnected; reconnecting");
      }
    });
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (msg.key.fromMe || !msg.key.remoteJid) continue;
        // Cuando WhatsApp direcciona el mensaje por @lid (identificador
        // interno, no el número), Baileys expone el número real por
        // separado en key.senderPn — nunca en un campo "remoteJidAlt", que
        // no existe en esta librería (bug real: ese fallback nunca
        // funcionó, por eso mensajes de números con @lid nunca se
        // resolvían y "Incoming WhatsApp sender could not be matched").
        const senderJid =
          msg.key.remoteJid.endsWith("@lid") &&
          msg.key.senderPn?.endsWith("@s.whatsapp.net")
            ? msg.key.senderPn
            : msg.key.remoteJid;
        const message = msg.message as any;
        let nativeReply = "";
        try {
          nativeReply = JSON.parse(
            message?.interactiveResponseMessage?.nativeFlowResponseMessage
              ?.paramsJson ?? "{}",
          ).id ?? "";
        } catch {
          nativeReply = "";
        }
        const text =
          message?.conversation ??
          message?.extendedTextMessage?.text ??
          message?.buttonsResponseMessage?.selectedButtonId ??
          message?.templateButtonReplyMessage?.selectedId ??
          message?.listResponseMessage?.singleSelectReply?.selectedRowId ??
          nativeReply;
        await incoming(senderJid, text, (targetJid, body) =>
          sock.sendMessage(targetJid, { text: body }).then((sent) => {
            rememberSent(sent?.key.id, body);
          }),
        );
      }
    });
  } catch (error) {
    activeSocket = undefined;
    const detail = error instanceof Error ? error.message : String(error);
    await updateConnectionState({ status: "error", last_error: detail }).catch(
      () => undefined,
    );
    throw error;
  } finally {
    connecting = false;
  }
}
async function main() {
  await acquireWorkerLock();
  const port=Number(process.env.PORT??10000);
  await new Promise<void>((resolveListen,rejectListen)=>{
    healthServer.once("error",rejectListen);
    healthServer.listen(port,"0.0.0.0",()=>resolveListen());
  });
  log.info(
    {
      pollIntervalMs: pollMs,
      authDirectory,
      calendar: calendarId,
    },
    "CoffeeMeet worker starting",
  );
  const { error } = await db
    .from("whatsapp_worker_state")
    .select("singleton")
    .eq("singleton", true)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo iniciar el worker contra Supabase: ${error.message}. Verifica las variables y las migraciones del worker.`,
    );
  }
  log.info("Supabase ready; starting Baileys and outbox polling");
  await connect();
  await poll();
}

process.on("unhandledRejection", (error) => {
  log.error({ err: error }, "Unhandled worker rejection");
});
process.on("uncaughtException", (error) => {
  log.fatal({ err: error }, "Uncaught worker exception");
  process.exit(1);
});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{healthServer.close();void releaseWorkerLock().finally(()=>process.exit(0))});

main().catch((error) => {
  log.fatal({ err: error }, "CoffeeMeet worker could not start");
  process.exit(1);
});

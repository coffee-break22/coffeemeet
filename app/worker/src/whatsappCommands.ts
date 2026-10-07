import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";

// Lógica de negocio de los comandos de WhatsApp entrantes, separada de
// index.ts (que además arranca Baileys, el servidor HTTP y el polling en
// cuanto se importa — no es seguro importar nada de ahí desde un script).
// Este módulo NO tiene efectos secundarios más allá de crear el cliente de
// Supabase, así que tanto el worker real (index.ts) como scripts/simulate.ts
// pueden importarlo sin arrancar una segunda instancia de nada.

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

export const db = createClient(
  required("SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
export const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
export const publicAppUrl = (process.env.PUBLIC_APP_URL ?? "http://localhost:5173").replace(/\/$/, "");

export const jid = (phone: string) => phone.replace(/\D/g, "") + "@s.whatsapp.net";

export async function currentWeekCode(): Promise<string> {
  const { data: row } = await db
    .from("meeting_config")
    .select("value")
    .eq("key", "current")
    .maybeSingle();
  return String((row?.value as { weekCode?: string } | null)?.weekCode ?? "");
}

// Copia mínima del reloj simulado de index.ts (mismo patrón, caché de 5s) —
// se duplica en vez de importarse porque index.ts es quien importa DE este
// archivo, no al revés.
let cachedNow: { value: number; fetchedAt: number } | null = null;
export async function getSystemNow(): Promise<number> {
  const real = Date.now();
  if (cachedNow && real - cachedNow.fetchedAt < 5000) return cachedNow.value;
  const { data, error } = await db.rpc("admin_get_simulated_clock");
  const row = Array.isArray(data) ? data[0] : data;
  const value =
    !error && row?.enabled && row.simulated_at
      ? new Date(row.simulated_at as string).getTime()
      : real;
  cachedNow = { value, fetchedAt: real };
  return value;
}

// slot_id: "virtual|fecha|hora" o "ciudad|lugar|fecha|hora". Horario fijo
// America/Bogota (UTC-5, sin horario de verano en Colombia).
function slotScheduledAt(slotId: string): number | null {
  const parts = slotId.split("|"),
    virtual = parts[0] === "virtual",
    date = parts[virtual ? 1 : 2],
    time = parts[virtual ? 2 : 3];
  if (!date || !time) return null;
  const at = new Date(`${date}T${time}:00-05:00`).getTime();
  return Number.isNaN(at) ? null : at;
}

// `sendFn` abstrae el envío real por WhatsApp (sock.sendMessage en el
// worker) para poder reutilizar exactamente esta misma lógica de negocio
// desde scripts/simulate.ts sin depender de una conexión real de Baileys —
// ahí `sendFn` solo registra en consola lo que el bot habría respondido.
export type SendFn = (jid: string, text: string) => Promise<void>;

export async function confirmParticipation(
  profile: { id: string; phone: string },
  sendFn: SendFn,
) {
  const weekCode = await currentWeekCode();
  const { error } = await db.rpc("confirm_weekly_participation", {
    p_week_code: weekCode,
    p_user_id: profile.id,
  });
  await sendFn(
    jid(profile.phone),
    error
      ? "No pudimos confirmar: el plazo puede haber cerrado o tu cuenta aún no está aprobada."
      : "¡Confirmado! Participarás en el matching de esta semana si existe una disponibilidad compatible.",
  );
}

export async function incoming(senderJid: string, raw: string, sendFn: SendFn) {
  const phone = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
  const clean = raw.trim(),
    text = clean
      .toUpperCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  const { data: profile } = await db
    .from("profiles")
    .select("id,phone,dormant_since")
    .or(`normalized_phone.eq.+${phone},normalized_phone.eq.${phone}`)
    .maybeSingle();
  if (!profile) {
    log.warn({ jidType: senderJid.split("@")[1] ?? "unknown" }, "Incoming WhatsApp sender could not be matched");
    return;
  }
  if (text === "STOP") {
    await db.from("contact_preferences").upsert({
      user_id: profile.id,
      opted_out: true,
      updated_at: new Date().toISOString(),
    });
    await sendFn(
      jid(profile.phone),
      "Listo. No volveremos a enviarte invitaciones de reactivación. Puedes escribir REACTIVAR cuando quieras retomar.",
    );
    return;
  }
  if (text === "REACTIVAR") {
    const wasDormant = profile.dormant_since !== null;
    await db.from("contact_preferences").upsert({
      user_id: profile.id,
      opted_out: false,
      updated_at: new Date().toISOString(),
    });
    const weekCode = await currentWeekCode();
    const { error } = await db.rpc("reactivate_weekly_participation", {
      p_user_id: profile.id,
      p_week_code: weekCode,
    });
    await sendFn(
      jid(profile.phone),
      error
        ? "No pudimos reactivarte: el plazo puede haber cerrado o falta una disponibilidad anterior."
        : wasDormant
          ? "¡Qué bueno tenerte de vuelta! ☕ El próximo domingo te llega el mensaje normal para confirmar tu semana."
          : "¡Listo! Reactivamos y confirmamos tu última disponibilidad para esta semana.",
    );
    return;
  }
  if (text === "CONFIRMAR") {
    await confirmParticipation(profile, sendFn);
    return;
  }
  const { data: session } = await db
    .from("survey_sessions")
    .select("meeting_id,user_id,step")
    .eq("user_id", profile.id)
    .neq("step", "completed")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Sin encuesta activa: "1"/"2"/"3" se resuelven según el contexto real del
  // usuario — inscripción semanal pendiente de confirmar (B1/B2), o una cita
  // ya asignada esta semana (B3/B4/B5/B6, cancelar sin entrar a la app).
  // Son estados mutuamente excluyentes en el ciclo normal, así que no hace
  // falta recordar cuál fue el último mensaje enviado.
  if (!session) {
    if (!["1", "2", "3"].includes(text)) return;
    // Prioridad: si tiene una cita activa por cancelar, "1" cancela esa
    // cita — sin filtrar por la "semana actual", porque el puntero de
    // semana ya avanzó al cerrar el lunes, antes de que la cita de esa
    // semana (que ocurre días después) siquiera pase. De lo contrario,
    // el sistema ya suele tener lista una participación 'pending' para la
    // semana siguiente (preparada de fondo aunque su B1 no se haya
    // enviado todavía), y ese "1" se confundiría con confirmarla en vez
    // de cancelar la cita — bug real encontrado en pruebas E2E.
    //
    // Pero "la cita activa más reciente" (order by created_at desc) no
    // basta: si una cita de una semana MUY anterior quedó sin resolver
    // (por ejemplo el hueco ya documentado de reporte de asistencia de un
    // solo lado, que dejan la cita en 'attendance_pending' indefinidamente
    // sin ningún incidente), esa cita vieja puede seguir siendo "la más
    // reciente entre las que siguen abiertas" una vez que la cita real de
    // la semana en curso ya se resolvió (queda 'completed', fuera de este
    // filtro). Encontrado 3 veces en pruebas E2E (semanas 3 y 4): un "1"
    // pensado para confirmar la semana nueva terminó cancelando por error
    // una cita de dos semanas atrás, generando incluso una sanción real.
    // Por eso además se exige que la fecha/hora de la cita sea reciente
    // (una cita real solo puede necesitar cancelarse antes de que ocurra
    // o poco después, nunca semanas después) — una cita de dos+ semanas
    // atrás nunca es candidata, sin importar su estado.
    if (text === "1") {
      const { data: meetings } = await db
        .from("meetings")
        .select("id,slot_id")
        .or(`user_a_id.eq.${profile.id},user_b_id.eq.${profile.id}`)
        .in("status", ["confirmed", "attendance_pending"])
        .order("created_at", { ascending: false });
      const now = await getSystemNow(),
        recentWindowMs = 9 * 24 * 60 * 60 * 1000,
        meeting = (meetings ?? []).find((m) => {
          const scheduledAt = slotScheduledAt(m.slot_id);
          return scheduledAt !== null && now - scheduledAt <= recentWindowMs;
        });
      if (meeting) {
        const { error } = await db.rpc("cancel_meeting", {
          p_meeting_id: meeting.id,
          p_cancelled_by: profile.id,
        });
        await sendFn(
          jid(profile.phone),
          error
            ? "No pudimos cancelar la cita. Verifica que siga activa."
            : "Cita cancelada. Avisamos a la otra persona.",
        );
        return;
      }
    }
    const weekCode = await currentWeekCode();
    const { data: participation } = await db
      .from("weekly_participations")
      .select("status")
      .eq("user_id", profile.id)
      .eq("week_code", weekCode)
      .maybeSingle();
    if (participation?.status === "pending") {
      if (text === "1") {
        await confirmParticipation(profile, sendFn);
        return;
      }
      if (text === "2") {
        await sendFn(
          jid(profile.phone),
          `Aquí puedes editar tu disponibilidad o retirarte de esta semana:\n${publicAppUrl}/`,
        );
        return;
      }
      const { error } = await db.rpc("withdraw_weekly_registration", {
        p_week_code: weekCode,
        p_user_id: profile.id,
      });
      await sendFn(
        jid(profile.phone),
        error
          ? "No pudimos retirarte: el plazo puede haber cerrado."
          : "Listo, quedaste fuera del sorteo de esta semana. Tu disponibilidad guardada no se borra — puedes volver a participar la próxima semana.",
      );
      return;
    }
    return;
  }
  if (session.step === "awaiting_comment") {
    if (text !== "OMITIR") {
      const { error } = await db.rpc("save_attendance_comment", {
        p_meeting_id: session.meeting_id,
        p_user_id: profile.id,
        p_comment: clean.slice(0, 1000),
      });
      if (error) {
        await sendFn(
          jid(profile.phone),
          "No pudimos guardar el comentario. Intenta de nuevo o responde OMITIR.",
        );
        return;
      }
    }
    await db
      .from("survey_sessions")
      .update({ step: "completed", updated_at: new Date().toISOString() })
      .eq("meeting_id", session.meeting_id)
      .eq("user_id", profile.id);
    await sendFn(
      jid(profile.phone),
      text === "OMITIR"
        ? "Gracias. Tu encuesta quedó registrada."
        : "Gracias por compartir tu comentario. Tu encuesta quedó registrada ☕",
    );
    return;
  }
  const answer = text === "1" ? "SI" : text === "2" ? "NO" : text;
  if (!["SI", "NO"].includes(answer)) return;
  const advanceStep = (step: string) =>
    db
      .from("survey_sessions")
      .update({ step, updated_at: new Date().toISOString() })
      .eq("meeting_id", session.meeting_id)
      .eq("user_id", profile.id);
  const askComment = async (message: string) => {
    await advanceStep("awaiting_comment");
    await sendFn(jid(profile.phone), message);
  };
  // Q1 "¿Fuiste?": si sí, preguntamos si tu match llegó (antes se asumía
  // que sí sin preguntar); si no, preguntamos si avisaste.
  if (session.step === "awaiting_occurred") {
    if (answer === "SI") {
      await advanceStep("awaiting_partner_arrived");
      await sendFn(jid(profile.phone), "¿Tu match llegó o se conectó?\n1️⃣ Sí\n2️⃣ No");
    } else {
      await advanceStep("awaiting_self_notice");
      await sendFn(jid(profile.phone), "¿Avisaste que no ibas a llegar?\n1️⃣ Sí\n2️⃣ No");
    }
    return;
  }
  // Q2 (tras "sí fui"): si el match también llegó, quedó completo; si no,
  // preguntamos si te avisó.
  if (session.step === "awaiting_partner_arrived") {
    if (answer === "SI") {
      await db.rpc("record_attendance_report", {
        p_meeting_id: session.meeting_id,
        p_reporter_id: profile.id,
        p_meeting_occurred: true,
        p_self_attended: true,
        p_partner_attended: true,
      });
      await askComment(
        "Gracias. ¿Quieres dejar un comentario sobre la experiencia? Escríbelo ahora o responde OMITIR.",
      );
    } else {
      await advanceStep("awaiting_partner_notice");
      await sendFn(jid(profile.phone), "¿Te avisó que no iba a llegar?\n1️⃣ Sí\n2️⃣ No");
    }
    return;
  }
  // Q3 (tras "fui, mi match no llegó"): pregunta informativa; el reporte
  // igual queda como self=true, partner=false.
  if (session.step === "awaiting_partner_notice") {
    await db.rpc("record_attendance_report", {
      p_meeting_id: session.meeting_id,
      p_reporter_id: profile.id,
      p_meeting_occurred: false,
      p_self_attended: true,
      p_partner_attended: false,
    });
    await askComment(
      "Gracias, quedó registrado. ¿Quieres agregar un comentario? Escríbelo ahora o responde OMITIR.",
    );
    return;
  }
  // Q2' (tras "no fui"): pregunta informativa; el reporte queda como
  // self=false, partner=null (no puede reportar por la otra persona).
  if (session.step === "awaiting_self_notice") {
    await db.rpc("record_attendance_report", {
      p_meeting_id: session.meeting_id,
      p_reporter_id: profile.id,
      p_meeting_occurred: false,
      p_self_attended: false,
      p_partner_attended: null,
    });
    await askComment(
      "Gracias, quedó registrado. ¿Quieres agregar un comentario? Escríbelo ahora o responde OMITIR.",
    );
  }
}

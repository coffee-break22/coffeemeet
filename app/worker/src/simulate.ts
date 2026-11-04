import { db, incoming, jid } from "./whatsappCommands.js";

// Script de línea de comandos para simular una respuesta entrante de
// WhatsApp de un contacto de prueba (sin teléfono/WhatsApp real), sin
// depender de Baileys. Reutiliza exactamente la misma lógica de negocio
// que procesa mensajes reales (whatsappCommands.ts) — mismos RPC, mismas
// reglas — así que el resultado en la base de datos es idéntico al de una
// respuesta real. Lo único que cambia es que, en vez de enviar el mensaje
// de vuelta por WhatsApp, lo imprime en la terminal.
//
// Uso:
//   npx tsx src/simulate.ts <quién> <mensaje>
//
// <quién> puede ser el teléfono (con o sin +) o un pedazo del nombre/correo
// del perfil de prueba. <mensaje> es exactamente lo que esa persona
// "escribiría" — 1, 2, 3, SI, NO, CONFIRMAR, STOP, REACTIVAR, OMITIR, o un
// comentario libre.
//
// Ejemplos:
//   npx tsx src/simulate.ts "Ana Alumni" 1        (confirma su semana, o cancela su cita si ya tiene una asignada)
//   npx tsx src/simulate.ts +573001112233 2       (según el contexto: editar disponibilidad, o "no" en la encuesta)
//   npx tsx src/simulate.ts ana@example.com OMITIR

async function resolveProfile(who: string) {
  const digits = who.replace(/\D/g, "");
  if (digits.length >= 7) {
    const { data } = await db
      .from("profiles")
      .select("id,full_name,phone,normalized_phone")
      .or(`normalized_phone.eq.+${digits},normalized_phone.eq.${digits}`)
      .maybeSingle();
    if (data) return data;
  }
  const { data: matches } = await db
    .from("profiles")
    .select("id,full_name,phone,normalized_phone,email")
    .or(`full_name.ilike.%${who}%,email.ilike.%${who}%`)
    .limit(5);
  if (!matches || matches.length === 0) {
    throw new Error(`No encontré ningún perfil que coincida con "${who}".`);
  }
  if (matches.length > 1) {
    const list = matches.map((m) => `  - ${m.full_name} (${m.phone}) — ${m.email}`).join("\n");
    throw new Error(
      `"${who}" coincide con más de un perfil, sé más específico:\n${list}`,
    );
  }
  return matches[0];
}

async function main() {
  const [who, ...rest] = process.argv.slice(2);
  const message = rest.join(" ");
  if (!who || !message) {
    console.error(
      'Uso: npx tsx src/simulate.ts <teléfono, nombre o correo> <mensaje>\nEjemplo: npx tsx src/simulate.ts "Ana Alumni" 1',
    );
    process.exit(1);
  }
  const profile = await resolveProfile(who);
  const senderJid = jid(profile.phone);
  console.log(`\n📲 Simulando mensaje entrante de ${profile.full_name} (${profile.phone}): "${message}"\n`);
  let replied = false;
  await incoming(senderJid, message, async (_targetJid, text) => {
    replied = true;
    console.log(`🤖 [el bot habría respondido a ${profile.full_name}]:\n${text}\n`);
  });
  if (!replied) {
    console.log(
      "ℹ️  El bot no habría respondido nada a este mensaje en este estado (comportamiento normal para texto no reconocido, o si no aplicaba ninguna acción).",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌", error instanceof Error ? error.message : error);
    process.exit(1);
  });

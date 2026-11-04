import { db } from "./whatsappCommands.js";
import { PASSWORD, WEEK_CODE, testParticipants, type SeedRow } from "./testParticipantsData.js";

// Crea las 25 cuentas de prueba completas del CSV "CM_2609 - Perfiles de
// prueba" directamente (cuenta + perfil aprobado + disponibilidad +
// participación pendiente + contactos excluidos), sin pasar por el
// formulario público — pensado para escenarios de matching muy específicos
// (cadenas, puentes, pools impares, exclusiones, cruce de ciudad) que serían
// tediosos de armar registrándose uno por uno.
//
// Los slot_id ya están resueltos contra la configuración real vigente de
// la semana 2026-W40 (martes 29/09, miércoles 30/09, jueves 01/10) al
// momento de escribir este script — si la configuración de días/lugares
// cambia antes de correrlo, hay que re-derivar las fechas.
//
// Uso: npx tsx src/seedTestAccounts.ts

const rows = testParticipants;

async function seedRow(row: SeedRow) {
  const normalizedEmail = row.email.toLowerCase().trim();
  const { data: existing } = await db
    .from("profiles")
    .select("id")
    .eq("normalized_email", normalizedEmail)
    .maybeSingle();
  let userId = existing?.id as string | undefined;
  if (!userId) {
    const { data: created, error } = await db.auth.admin.createUser({
      email: normalizedEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`crear usuario: ${error.message}`);
    userId = created.user?.id;
    if (!userId) throw new Error("createUser no devolvió id");
  }
  const linkedinUrl = row.linkedin.startsWith("http") ? row.linkedin : `https://${row.linkedin}`;
  const { error } = await db.rpc("admin_seed_test_participant", {
    p_user_id: userId,
    p_full_name: row.fullName,
    p_email: normalizedEmail,
    p_phone: row.phone,
    p_linkedin_url: linkedinUrl,
    p_school: row.school,
    p_graduation_year: row.graduationYear,
    p_city: row.city,
    p_only_new_people: row.onlyNewPeople,
    p_week_code: WEEK_CODE,
    p_slot_ids: row.slots,
    p_known_phone: row.knownPhone ?? null,
    p_notes: row.notes,
  });
  if (error) throw new Error(`admin_seed_test_participant: ${error.message}`);
  return userId;
}

async function main() {
  let ok = 0,
    failed = 0;
  for (const row of rows) {
    try {
      const id = await seedRow(row);
      console.log(`✅ ${row.fullName} (${id}) — ${row.slots.length} slot(s)`);
      ok++;
    } catch (error) {
      console.error(`❌ ${row.fullName}:`, error instanceof Error ? error.message : error);
      failed++;
    }
  }
  console.log(`\n${ok} cuentas creadas, ${failed} fallidas, de ${rows.length} totales.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error fatal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });

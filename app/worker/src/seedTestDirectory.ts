import { db } from "./whatsappCommands.js";
import { testParticipants } from "./testParticipantsData.js";

// Crea la fila del Directorio (alumni_registry) para cada una de las 25
// cuentas de prueba ya sembradas por seedTestAccounts.ts, y vincula su
// verification_request a esa coincidencia (registry_id + match_basis)
// para que quede igual que el flujo real: "el correo/teléfono coincide con
// el directorio" en vez de "aprobación manual".
//
// Uso: npx tsx src/seedTestDirectory.ts (correr DESPUÉS de seedTestAccounts.ts)

async function seedDirectoryRow(row: (typeof testParticipants)[number]) {
  const normalizedEmail = row.email.toLowerCase().trim();

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("normalized_email", normalizedEmail)
    .maybeSingle();
  if (!profile) throw new Error("no existe el perfil — corre primero seedTestAccounts.ts");

  const { error } = await db.rpc("admin_seed_test_directory_entry", {
    p_user_id: profile.id,
    p_full_name: row.fullName,
    p_email: normalizedEmail,
    p_phone: row.phone,
    p_school: row.school,
    p_graduation_year: row.graduationYear,
  });
  if (error) throw new Error(`admin_seed_test_directory_entry: ${error.message}`);
}

async function main() {
  let ok = 0,
    failed = 0;
  for (const row of testParticipants) {
    try {
      await seedDirectoryRow(row);
      console.log(`✅ ${row.fullName}`);
      ok++;
    } catch (error) {
      console.error(`❌ ${row.fullName}:`, error instanceof Error ? error.message : error);
      failed++;
    }
  }
  console.log(`\n${ok} vinculados al directorio, ${failed} fallidos, de ${testParticipants.length} totales.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error fatal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });

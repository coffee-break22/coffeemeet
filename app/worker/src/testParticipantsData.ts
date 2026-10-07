// Dataset compartido del CSV "CM_2609 - Perfiles de prueba", usado tanto
// por seedTestAccounts.ts (crea cuenta+perfil+disponibilidad) como por
// seedTestDirectory.ts (crea la fila del Directorio correspondiente a cada
// una, para que la solicitud quede vinculada por coincidencia real en vez
// de aprobación "manual"). Los slot_id están resueltos contra la semana
// 2026-W40 (martes 29/09, miércoles 30/09, jueves 01/10).

export interface SeedRow {
  fullName: string;
  email: string;
  phone: string;
  linkedin: string;
  school: "harvard" | "mit";
  graduationYear: number;
  city: string;
  onlyNewPeople: boolean;
  knownPhone?: string;
  notes: string;
  slots: string[];
}

export const WEEK_CODE = "2026-W40";
export const PASSWORD = "CoffeeTest2026!";

export const testParticipants: SeedRow[] = [
  { fullName: "Juan Carlos Junca", email: "emmanuel.boros@gmail.com", phone: "+573012479893", linkedin: "linkedin.com/in/juan-carlos-junca", school: "harvard", graduationYear: 2011, city: "Bogotá", onlyNewPeople: false, notes: "Nodo A de la cadena — solo esta hora.", slots: ["virtual|2026-09-29|08:00"] },
  { fullName: "José Darío Perea", email: "emmanuel.boros2@gmail.com", phone: "+11043321819", linkedin: "linkedin.com/in/josé-darío-perea", school: "mit", graduationYear: 2009, city: "Bogotá", onlyNewPeople: false, notes: "Nodo B — puente entre Junca y Barona.", slots: ["virtual|2026-09-29|08:00", "virtual|2026-09-29|12:30"] },
  { fullName: "Antonio Barona", email: "cliente.petfly@gmail.com", phone: "+16001338908", linkedin: "linkedin.com/in/antonio-barona", school: "harvard", graduationYear: 2015, city: "Bogotá", onlyNewPeople: false, notes: "Nodo C — puente entre Perea y Escobar.", slots: ["virtual|2026-09-29|12:30", "virtual|2026-09-29|17:30"] },
  { fullName: "Óscar Escobar", email: "cliente.kleermindg@gmail.com", phone: "+13863794026", linkedin: "linkedin.com/in/óscar-escobar", school: "mit", graduationYear: 2013, city: "Bogotá", onlyNewPeople: false, notes: "Nodo D de la cadena — solo esta hora.", slots: ["virtual|2026-09-29|17:30"] },
  { fullName: "Cristian Villamizar", email: "cristian.villamizar@example.com", phone: "+15423511615", linkedin: "linkedin.com/in/cristian-villamizar", school: "harvard", graduationYear: 2016, city: "Cali", onlyNewPeople: false, notes: "Única persona en este horario en todo el set — debe quedar en lista de espera.", slots: ["virtual|2026-10-01|18:00"] },
  { fullName: "Pablo A. Uribe", email: "pablo.a.uribe@example.com", phone: "+15940781618", linkedin: "linkedin.com/in/pablo-a.-uribe", school: "mit", graduationYear: 2010, city: "Bogotá", onlyNewPeople: false, notes: "Declara ciudad Bogotá, casilla Virtual.", slots: ["virtual|2026-09-30|08:30"] },
  // Semana 1 (CM_GUIA_de_pruebas.pdf): solo Virtual Miércoles 08:30 — forma
  // el triángulo Uribe–Aldana–Rivera (algoritmo resuelve Rivera+Uribe).
  // En Semana 2 su disponibilidad CAMBIA (reemplaza, no suma) a Pance
  // Jueves 12:30 — ver el evento de "cambio de disponibilidad" de esa
  // semana en la guía, aplicado como edición en vivo, no aquí.
  { fullName: "Jaime Aldana Valdés", email: "jaime.aldana.valdes@example.com", phone: "+14959310341", linkedin: "linkedin.com/in/jaime-aldana-valdés", school: "harvard", graduationYear: 2008, city: "Cali", onlyNewPeople: false, notes: "Semana 1: Virtual Miércoles 08:30 (triángulo con Uribe/Rivera). Semana 2: cambia a Pance Jueves 12:30.", slots: ["virtual|2026-09-30|08:30"] },
  // Semana 1: solo Virtual Miércoles 08:30 (mismo triángulo). Semana 2:
  // cambia (reemplaza) a Granada+Pance Jueves 12:30 — activa el trío con
  // Camilo Enciso. Ver nota de Jaime arriba.
  { fullName: "Sergio Rivera", email: "sergio.rivera@example.com", phone: "+13164752553", linkedin: "linkedin.com/in/sergio-rivera", school: "mit", graduationYear: 2018, city: "Cali", onlyNewPeople: false, notes: "Semana 1: Virtual Miércoles 08:30 (triángulo con Uribe/Aldana). Semana 2: cambia a Granada+Pance Jueves 12:30.", slots: ["virtual|2026-09-30|08:30"] },
  // El CSV original traía "+573013903402" como contacto excluido, pero el
  // WhatsApp real de Valentín Sierra es "+18350305641" — un desajuste en
  // los datos de prueba (no del algoritmo) que hacía que la exclusión
  // nunca se activara. Corregido tras la Semana 1 (ver documento de
  // resultados) para usar el teléfono real.
  { fullName: "Juan Galindo", email: "juan.galindo@example.com", phone: "+14192832764", linkedin: "linkedin.com/in/juan-galindo", school: "harvard", graduationYear: 2012, city: "Bogotá", onlyNewPeople: true, knownPhone: "+18350305641", notes: "Único horario, y su único posible match está excluido a propósito.", slots: ["virtual|2026-09-30|12:30"] },
  { fullName: "Valentín Sierra", email: "valentin.sierra@example.com", phone: "+18350305641", linkedin: "linkedin.com/in/valentín-sierra", school: "mit", graduationYear: 2014, city: "Bogotá", onlyNewPeople: false, notes: "Mismo horario que Galindo, pero Galindo ya lo excluyó — nadie más comparte este horario.", slots: ["virtual|2026-09-30|12:30"] },
  { fullName: "Johanna Lopez Velandia", email: "johanna.lopez.velandia@example.com", phone: "+13953767242", linkedin: "linkedin.com/in/johanna-lopez-velandia", school: "harvard", graduationYear: 2017, city: "Bogotá", onlyNewPeople: false, notes: "1 de 3 personas en este horario (número impar) — solo 2 de las 3 podrán emparejarse.", slots: ["virtual|2026-10-01|08:00"] },
  { fullName: "Camilo José Pabón Porras", email: "camilo.jose.pabon.porras@example.com", phone: "+13884969653", linkedin: "linkedin.com/in/camilo-josé-pabón-porras", school: "mit", graduationYear: 2019, city: "Bogotá", onlyNewPeople: false, notes: "2 de 3 personas en este horario (número impar).", slots: ["virtual|2026-10-01|08:00"] },
  { fullName: "Antonio José Núñez Trujillo", email: "antonio.jose.nunez.trujillo@example.com", phone: "+12871012269", linkedin: "linkedin.com/in/antonio-josé-núñez-trujillo", school: "harvard", graduationYear: 2007, city: "Bogotá", onlyNewPeople: false, notes: "3 de 3 personas en este horario (número impar).", slots: ["virtual|2026-10-01|08:00"] },
  { fullName: "Carlos Sierra", email: "carlos.sierra@example.com", phone: "+11669784801", linkedin: "linkedin.com/in/carlos-sierra", school: "mit", graduationYear: 2020, city: "Bogotá", onlyNewPeople: false, notes: "Dos combinaciones independientes — puede resolver a Parra o a Jimenez, pero no a ambos.", slots: ["virtual|2026-10-01|08:30", "virtual|2026-10-01|12:30"] },
  { fullName: "Gabriel Parra", email: "gabriel.parra@example.com", phone: "+18451462704", linkedin: "linkedin.com/in/gabriel-parra", school: "harvard", graduationYear: 2006, city: "Bogotá", onlyNewPeople: false, notes: "Solo comparte horario con Carlos Sierra — nadie más.", slots: ["virtual|2026-10-01|08:30"] },
  { fullName: "Alejandra Jimenez", email: "alejandra.jimenez@example.com", phone: "+18281489325", linkedin: "linkedin.com/in/alejandra-jimenez", school: "mit", graduationYear: 2021, city: "Bogotá", onlyNewPeople: false, notes: "Solo comparte horario con Carlos Sierra — nadie más.", slots: ["virtual|2026-10-01|12:30"] },
  { fullName: "Mauricio", email: "mauricio@example.com", phone: "+12880957015", linkedin: "linkedin.com/in/mauricio", school: "harvard", graduationYear: 2009, city: "Bogotá", onlyNewPeople: false, notes: "Nodo 1 de la cadena — solo este lugar.", slots: ["Bogotá|Café Centro|2026-10-01|17:30"] },
  { fullName: "Jose Antonio Murillo Dagdug", email: "jose.antonio.murillo.dagdug@example.com", phone: "+14303911718", linkedin: "linkedin.com/in/jose-antonio-murillo-dagdug", school: "mit", graduationYear: 2015, city: "Bogotá", onlyNewPeople: false, notes: "Nodo 2 — puente entre Mauricio y Lopez Obregon.", slots: ["Bogotá|Café Centro|2026-10-01|17:30", "Bogotá|Zona T|2026-10-01|17:30"] },
  { fullName: "Mauricio Lopez Obregon", email: "mauricio.lopez.obregon@example.com", phone: "+12278248963", linkedin: "linkedin.com/in/mauricio-lopez-obregon", school: "harvard", graduationYear: 2012, city: "Bogotá", onlyNewPeople: false, notes: "Nodo 3 — puente entre Murillo y Ribero.", slots: ["Bogotá|Zona T|2026-10-01|17:30", "Bogotá|Zona G|2026-10-01|17:30"] },
  { fullName: "Juan Ribero", email: "juan.ribero@example.com", phone: "+18346578713", linkedin: "linkedin.com/in/juan-ribero", school: "mit", graduationYear: 2017, city: "Bogotá", onlyNewPeople: false, notes: "Nodo 4 de la cadena — solo este lugar.", slots: ["Bogotá|Zona G|2026-10-01|17:30"] },
  { fullName: "Helena del Corral", email: "helena.del.corral@example.com", phone: "+13150983930", linkedin: "linkedin.com/in/helena-del-corral", school: "harvard", graduationYear: 2019, city: "Bogotá", onlyNewPeople: false, notes: "Mismo día/hora que Márquez, pero lugar distinto — y nadie más en ese horario.", slots: ["Bogotá|Zona T|2026-09-30|08:00"] },
  { fullName: "Nicolás Márquez García", email: "nicolas.marquez.garcia@example.com", phone: "+11031051834", linkedin: "linkedin.com/in/nicolás-márquez-garcía", school: "mit", graduationYear: 2014, city: "Bogotá", onlyNewPeople: false, notes: "Mismo día/hora que Del Corral, pero lugar distinto — y nadie más en ese horario.", slots: ["Bogotá|Café Centro|2026-09-30|08:00"] },
  { fullName: "Laura Vargas", email: "laura.vargas@example.com", phone: "+17382997376", linkedin: "linkedin.com/in/laura-vargas", school: "harvard", graduationYear: 2016, city: "Cali", onlyNewPeople: false, notes: "Mismo lugar exacto que Platovsky — caso simple, debe funcionar sin problema.", slots: ["Cali|Granada|2026-09-29|08:30"] },
  { fullName: "Caterina Platovsky", email: "caterina.platovsky@example.com", phone: "+13116566701", linkedin: "linkedin.com/in/caterina-platovsky", school: "mit", graduationYear: 2018, city: "Cali", onlyNewPeople: false, notes: "Mismo lugar exacto que Vargas — caso simple, debe funcionar sin problema.", slots: ["Cali|Granada|2026-09-29|08:30"] },
  { fullName: "Camilo Enciso", email: "camilo.enciso@example.com", phone: "+10651333872", linkedin: "linkedin.com/in/camilo-enciso", school: "harvard", graduationYear: 2010, city: "Cali", onlyNewPeople: false, notes: "1 de 3 — número impar, inevitable que 1 quede sin match.", slots: ["Cali|Granada|2026-10-01|12:30"] },
];

import { normalizePhone, type VerificationStatus } from "./coffeemeet.ts";
import blossom from "./blossom.ts";
export type MeetingMode = "in_person" | "virtual";
export interface AvailabilitySlot {
  id: string;
  date: string;
  time: string;
  mode: MeetingMode;
  city?: string;
  place?: string;
}
export interface MatchParticipant {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  city: string;
  verificationStatus: VerificationStatus;
  blocked: boolean;
  slots: AvailabilitySlot[];
  knownPhones: string[];
  knownEmails: string[];
  onlyNewPeople: boolean;
  completedMeetingCount: number;
  noticeCancellationRate?: number;
  // Regla de prioridad 2 (decisión del cliente tras las pruebas E2E): la
  // pareja de la semana anterior de esta persona no se presentó o la
  // canceló — se quedó sin café por una causa ajena a ella misma.
  hadPartnerIssueLastWeek?: boolean;
  // Regla de prioridad 4: hace cuántas semanas esta persona perdió un
  // empate del matching (quedó sin pareja por "odd_compatible_pool").
  // null = nunca ha perdido uno.
  weeksSinceTiebreakLoss?: number | null;
}
export interface CompletedPair {
  userAId: string;
  userBId: string;
  completedAt: string;
}
export interface MatchPair {
  userAId: string;
  userBId: string;
  slot: AvailabilitySlot;
  score: number;
  lastResort: boolean;
  explanation: string[];
}
export type UnmatchedReason =
  | "pending_approval"
  | "rejected"
  | "blocked"
  | "holiday_only"
  | "known_contacts"
  | "only_new_people_no_candidates"
  | "no_compatible_availability"
  | "odd_compatible_pool";
export interface UnmatchedParticipant {
  userId: string;
  reason: UnmatchedReason;
  detail: string;
}
export interface MatchingResult {
  pairs: MatchPair[];
  unmatched: UnmatchedParticipant[];
}
const pairKey = (a: string, b: string) => [a, b].sort().join(":");
const slotKey = (s: AvailabilitySlot) =>
  `${s.date}|${s.time}|${s.mode}|${s.mode === "virtual" ? "global" : `${s.city}|${s.place}`}`;
function commonSlots(
  a: MatchParticipant,
  b: MatchParticipant,
  blockedDates: Set<string>,
) {
  const right = new Map(
    b.slots
      .filter((s) => !blockedDates.has(s.date))
      .map((s) => [slotKey(s), s]),
  );
  return a.slots.filter(
    (s) => !blockedDates.has(s.date) && right.has(slotKey(s)),
  );
}
const normalizeEmail = (email: string) => email.trim().toLowerCase();
// Solo cuenta como "contacto conocido" desde la perspectiva de quien marcó
// "solo gente que no conozco" y listó el teléfono/correo de la otra persona.
function flaggedAsKnown(owner: MatchParticipant, other: MatchParticipant) {
  if (!owner.onlyNewPeople) return false;
  const otherPhone = normalizePhone(other.phone);
  const otherEmail = normalizeEmail(other.email);
  return (
    owner.knownPhones.map((phone) => normalizePhone(phone)).includes(otherPhone) ||
    (Boolean(otherEmail) &&
      owner.knownEmails.map((email) => normalizeEmail(email)).includes(otherEmail))
  );
}
function knows(a: MatchParticipant, b: MatchParticipant) {
  return flaggedAsKnown(a, b) || flaggedAsKnown(b, a);
}
export function runMatching(
  participants: MatchParticipant[],
  history: CompletedPair[],
  blockedDates: string[] = [],
): MatchingResult {
  const holidays = new Set(blockedDates),
    prior = new Map<string, number>();
  for (const h of history) {
    const k = pairKey(h.userAId, h.userBId);
    prior.set(k, (prior.get(k) ?? 0) + 1);
  }
  const unmatched: UnmatchedParticipant[] = [],
    eligible: MatchParticipant[] = [];
  for (const p of [...participants].sort((a, b) => a.id.localeCompare(b.id))) {
    if (p.verificationStatus === "pending") {
      unmatched.push({
        userId: p.id,
        reason: "pending_approval",
        detail: "Su cuenta todavía no ha sido aprobada por un administrador.",
      });
      continue;
    }
    if (p.verificationStatus === "rejected") {
      unmatched.push({
        userId: p.id,
        reason: "rejected",
        detail: "Su solicitud de registro fue rechazada por un administrador.",
      });
      continue;
    }
    if (p.blocked) {
      unmatched.push({
        userId: p.id,
        reason: "blocked",
        detail:
          "Está bloqueado por una inasistencia anterior; necesita que un administrador le dé una segunda oportunidad.",
      });
      continue;
    }
    if (p.slots.length > 0 && p.slots.every((s) => holidays.has(s.date))) {
      unmatched.push({
        userId: p.id,
        reason: "holiday_only",
        detail:
          "Todos los horarios que eligió caen en días festivos o bloqueados esta semana.",
      });
      continue;
    }
    eligible.push(p);
  }
  type Edge = {
    a: MatchParticipant;
    b: MatchParticipant;
    slots: AvailabilitySlot[];
    priorCount: number;
    score: number;
  };
  const edges: Edge[] = [];
  for (let i = 0; i < eligible.length; i++)
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i],
        b = eligible[j];
      if (knows(a, b)) continue;
      const priorCount = prior.get(pairKey(a.id, b.id)) ?? 0;
      // Quien marcó "solo gente que no conozco" nunca vuelve a verse con
      // alguien con quien ya tuvo café, aunque eso lo deje sin match esta
      // semana. Sin la casilla marcada, repetir sigue siendo posible como
      // último recurso (penalización suave más abajo).
      if (priorCount > 0 && (a.onlyNewPeople || b.onlyNewPeople)) continue;
      const slots = commonSlots(a, b, holidays);
      if (!slots.length) continue;
      // 4 reglas de prioridad del cliente, en orden estricto (cada tramo
      // domina por completo al siguiente, nunca se mezclan): el criterio
      // ya existente de "nunca repetir mientras haya gente nueva" se
      // mantiene por encima de las 4 — confirmado explícitamente con el
      // cliente — así que ocupa el tramo más alto (NEVER_MET_TIER).
      // 1) Maximizar el número de parejas: no se decide aquí, lo
      //    garantiza blossom + tieScale sobre la cardinalidad.
      // 2) Prioridad a quien su pareja anterior no se presentó/canceló.
      // 3) Prioridad a quien tiene menos citas asistidas (ya existía).
      // 4) Rotación de equidad: prioridad a quien perdió el empate más
      //    reciente, como último desempate.
      const NEVER_MET_TIER = 1_000_000_000,
        PARTNER_ISSUE_TIER = 10_000_000,
        partnerIssueBoost =
          (a.hadPartnerIssueLastWeek ? 1 : 0) +
          (b.hadPartnerIssueLastWeek ? 1 : 0),
        fewerMeetingsPenalty =
          (a.completedMeetingCount + b.completedMeetingCount) * 1000,
        fairnessWindow = 8,
        fairnessBoost = (person: MatchParticipant) =>
          person.weeksSinceTiebreakLoss == null
            ? 0
            : Math.max(0, fairnessWindow - person.weeksSinceTiebreakLoss),
        fairnessBonus = fairnessBoost(a) + fairnessBoost(b);
      edges.push({
        a,
        b,
        slots,
        priorCount,
        score:
          (priorCount ? 0 : NEVER_MET_TIER) -
          priorCount * 200 +
          partnerIssueBoost * PARTNER_ISSUE_TIER -
          fewerMeetingsPenalty +
          fairnessBonus -
          ((a.noticeCancellationRate ?? 0) > 0.5 ? 20 : 0) -
          ((b.noticeCancellationRate ?? 0) > 0.5 ? 20 : 0),
      });
    }
  edges.sort(
    (x, y) =>
      y.score - x.score ||
      pairKey(x.a.id, x.b.id).localeCompare(pairKey(y.a.id, y.b.id)),
  );
  const indexById = new Map(
    eligible.map((person, index) => [person.id, index]),
  );
  // maxCardinality conserva primero el máximo número de citas. El peso escalado
  // optimiza después la puntuación total y usa el orden estable solo para desempatar.
  const tieScale = Math.max(
    1,
    Math.floor(eligible.length / 2) * Math.max(edges.length, 1) + 1,
  );
  const weightedEdges = edges.map(
    (edge, rank) =>
      [
        indexById.get(edge.a.id)!,
        indexById.get(edge.b.id)!,
        edge.score * tieScale + (edges.length - rank),
      ] as [number, number, number],
  );
  const weightedMatch = weightedEdges.length
    ? blossom(weightedEdges, true)
    : [];
  const matching = Array.from(
      { length: eligible.length },
      (_, index) => weightedMatch[index] ?? -1,
    ),
    used = new Set<string>(),
    load = new Map<string, number>(),
    pairs: MatchPair[] = [];
  for (let index = 0; index < matching.length; index++) {
    const partner = matching[index];
    if (partner < index) continue;
    const a = eligible[index],
      b = eligible[partner],
      edge = edges.find(
        (candidate) =>
          pairKey(candidate.a.id, candidate.b.id) === pairKey(a.id, b.id),
      );
    if (!edge) continue;
    const slot = [...edge.slots].sort(
      (x, y) =>
        (load.get(slotKey(x)) ?? 0) - (load.get(slotKey(y)) ?? 0) ||
        slotKey(x).localeCompare(slotKey(y)),
    )[0];
    used.add(a.id);
    used.add(b.id);
    load.set(slotKey(slot), (load.get(slotKey(slot)) ?? 0) + 1);
    pairs.push({
      userAId: a.id,
      userBId: b.id,
      slot,
      score: edge.score,
      lastResort: edge.priorCount > 0,
      explanation: [
        edge.priorCount
          ? "Pareja repetida como último recurso"
          : "Nunca se habían reunido",
        `Compatibilidad en ${slot.mode === "virtual" ? "modalidad virtual" : `${slot.city} · ${slot.place}`}`,
        `Carga del slot: ${load.get(slotKey(slot))}`,
      ],
    });
  }
  for (const p of eligible.filter((p) => !used.has(p.id))) {
    const others = eligible.filter((o) => o.id !== p.id);
    const hasContactConflict = others.some(
      (o) => knows(p, o) && commonSlots(p, o, holidays).length > 0,
    );
    const hasPriorOnlyConflict =
      p.onlyNewPeople &&
      others.some(
        (o) =>
          (prior.get(pairKey(p.id, o.id)) ?? 0) > 0 &&
          commonSlots(p, o, holidays).length > 0,
      );
    const hasCompatible = edges.some((e) => e.a.id === p.id || e.b.id === p.id);
    unmatched.push(
      hasContactConflict && !hasCompatible
        ? {
            userId: p.id,
            reason: "known_contacts",
            detail:
              "Las únicas personas con las que coincide en lugar, día y hora están en su lista de contactos que prefiere no repetir.",
          }
        : hasPriorOnlyConflict && !hasCompatible
          ? {
              userId: p.id,
              reason: "only_new_people_no_candidates",
              detail:
                "Eligió conocer solo gente nueva, y las personas con las que coincide en horario ya tomaron un café con ella antes.",
            }
          : hasCompatible
          ? {
              userId: p.id,
              reason: "odd_compatible_pool",
              detail:
                "Coincide en lugar, día y hora con otras personas, pero eran un número impar y a alguien le tocaba quedar sin pareja esta semana.",
            }
          : {
              userId: p.id,
              reason: "no_compatible_availability",
              detail:
                "Nadie más eligió el mismo lugar, día y hora que esta persona esta semana.",
            },
    );
  }
  return {
    pairs,
    unmatched: unmatched.sort((a, b) => a.userId.localeCompare(b.userId)),
  };
}

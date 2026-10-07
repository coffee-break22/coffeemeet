import test from "node:test";
import assert from "node:assert/strict";
import {
  runMatching,
  type AvailabilitySlot,
  type MatchParticipant,
} from "../src/domain/matching.ts";
const inBogota: AvailabilitySlot = {
  id: "b1",
  date: "2026-09-02",
  time: "08:00",
  mode: "in_person",
  city: "Bogotá",
  place: "Café Centro",
};
const virtualBogota: AvailabilitySlot = {
  id: "v1",
  date: "2026-09-03",
  time: "18:00",
  mode: "virtual",
  city: "Bogotá",
};
const person = (
  id: string,
  overrides: Partial<MatchParticipant> = {},
): MatchParticipant => ({
  id,
  fullName: id,
  phone: `+57300${id.padStart(7, "0")}`,
  email: `${id}@example.com`,
  city: "Bogotá",
  verificationStatus: "approved",
  blocked: false,
  slots: [inBogota],
  knownPhones: [],
  knownEmails: [],
  onlyNewPeople: false,
  completedMeetingCount: 0,
  ...overrides,
});
test("solo approved y no bloqueados participan", () => {
  const r = runMatching(
    [
      person("1"),
      person("2", { verificationStatus: "pending" }),
      person("3", { blocked: true }),
    ],
    [],
  );
  assert.equal(r.pairs.length, 0);
  assert.equal(
    r.unmatched.find((x) => x.userId === "2")?.reason,
    "pending_approval",
  );
  assert.equal(r.unmatched.find((x) => x.userId === "3")?.reason, "blocked");
});
test("presencial exige misma ciudad y lugar", () => {
  const cali = { ...inBogota, id: "c1", city: "Cali" };
  const r = runMatching(
    [person("1"), person("2", { city: "Cali", slots: [cali] })],
    [],
  );
  assert.equal(r.pairs.length, 0);
  assert.equal(r.unmatched[0].reason, "no_compatible_availability");
});
test("virtual permite match entre ciudades", () => {
  const caliVirtual = { ...virtualBogota, id: "v2", city: "Cali" };
  const r = runMatching(
    [
      person("1", { slots: [virtualBogota] }),
      person("2", { city: "Cali", slots: [caliVirtual] }),
    ],
    [],
  );
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].slot.mode, "virtual");
});
test("contacto conocido solo excluye si se marcó solo gente nueva", () => {
  const b = person("2");
  const a = person("1", { knownPhones: [b.phone], onlyNewPeople: true });
  const r = runMatching([a, b], []);
  assert.equal(r.pairs.length, 0);
  assert.equal(r.unmatched[0].reason, "known_contacts");
});
test("contacto conocido por correo también excluye la pareja", () => {
  const b = person("2");
  const a = person("1", { knownEmails: [b.email], onlyNewPeople: true });
  const r = runMatching([a, b], []);
  assert.equal(r.pairs.length, 0);
  assert.equal(r.unmatched[0].reason, "known_contacts");
});
test("sin marcar la casilla, un contacto conocido NO excluye la pareja", () => {
  const b = person("2");
  const a = person("1", { knownPhones: [b.phone], onlyNewPeople: false });
  const r = runMatching([a, b], []);
  assert.equal(r.pairs.length, 1);
});
test("solo gente nueva sin contactos: nunca repite pareja aunque quede sin match", () => {
  const history = [{ userAId: "1", userBId: "2", completedAt: "2026-01-01" }];
  const a = person("1", { onlyNewPeople: true });
  const b = person("2");
  const r = runMatching([a, b], history);
  assert.equal(r.pairs.length, 0);
  assert.equal(
    r.unmatched.find((x) => x.userId === "1")?.reason,
    "only_new_people_no_candidates",
  );
});
test("sin la casilla, repetir pareja sigue siendo posible como último recurso", () => {
  const history = [{ userAId: "1", userBId: "2", completedAt: "2026-01-01" }];
  const r = runMatching([person("1"), person("2")], history);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].lastResort, true);
});
test("festivo excluye a quien solo tenía ese día", () => {
  const r = runMatching([person("1"), person("2")], [], ["2026-09-02"]);
  assert.equal(r.pairs.length, 0);
  assert.ok(r.unmatched.every((x) => x.reason === "holiday_only"));
});
test("máximo una reunión por persona y explica el impar", () => {
  const r = runMatching([person("1"), person("2"), person("3")], []);
  assert.equal(r.pairs.length, 1);
  assert.equal(new Set(r.pairs.flatMap((p) => [p.userAId, p.userBId])).size, 2);
  assert.equal(r.unmatched.length, 1);
  assert.equal(r.unmatched[0].reason, "odd_compatible_pool");
});
test("prefiere parejas nuevas y marca repetición como último recurso", () => {
  const participants = [person("1"), person("2"), person("3"), person("4")];
  const history = [{ userAId: "1", userBId: "2", completedAt: "2026-01-01" }];
  const r = runMatching(participants, history);
  assert.equal(r.pairs.length, 2);
  assert.ok(r.pairs.every((p) => !p.lastResort));
  const repeat = runMatching([person("1"), person("2")], history);
  assert.equal(repeat.pairs[0].lastResort, true);
  assert.match(repeat.pairs[0].explanation[0], /último recurso/);
});
test("selección es determinista aunque cambie el orden de entrada", () => {
  const people = [person("1"), person("2"), person("3"), person("4")];
  const a = runMatching(people, []).pairs.map((p) => [p.userAId, p.userBId]);
  const b = runMatching([...people].reverse(), []).pairs.map((p) => [
    p.userAId,
    p.userBId,
  ]);
  assert.deepEqual(a, b);
});
test("maximiza el número global de parejas cuando el enfoque voraz perdería una", () => {
  const slot = (id: string): AvailabilitySlot => ({
    id,
    date: "2026-09-04",
    time: id,
    mode: "virtual",
    city: "Bogotá",
  });
  const a = person("1", { slots: [slot("08:00"), slot("09:00")] });
  const b = person("2", { slots: [slot("08:00"), slot("10:00")] });
  const c = person("3", { slots: [slot("09:00")] });
  const d = person("4", { slots: [slot("10:00")] });
  const result = runMatching([a, b, c, d], []);
  assert.equal(result.pairs.length, 2);
  assert.deepEqual(
    new Set(result.pairs.flatMap((pair) => [pair.userAId, pair.userBId])),
    new Set(["1", "2", "3", "4"]),
  );
});

test("penaliza cancelaciones con aviso solo cuando superan el 50 por ciento", () => {
  const atLimit = runMatching(
    [person("1", { noticeCancellationRate: 0.5 }), person("2")],
    [],
  );
  const aboveLimit = runMatching(
    [person("1", { noticeCancellationRate: 0.5001 }), person("2")],
    [],
  );

  assert.equal(atLimit.pairs.length, 1);
  assert.equal(aboveLimit.pairs.length, 1);
  assert.equal(atLimit.pairs[0].score - aboveLimit.pairs[0].score, 20);
});

test("entre matchings máximos elige exactamente la mayor puntuación total", () => {
  const participants = [
    person("1", { completedMeetingCount: 0 }),
    person("2", { completedMeetingCount: 0 }),
    person("3", { completedMeetingCount: 20 }),
    person("4", { completedMeetingCount: 20 }),
  ];
  const history = [
    { userAId: "1", userBId: "2", completedAt: "2026-01-01" },
    { userAId: "3", userBId: "4", completedAt: "2026-01-01" },
  ];
  const result = runMatching(participants, history);
  const selected = new Set(
    result.pairs.map((pair) => [pair.userAId, pair.userBId].sort().join("-")),
  );
  assert.equal(result.pairs.length, 2);
  assert.equal(
    result.pairs.reduce((sum, pair) => sum + pair.score, 0),
    1_999_960_000,
  );
  assert.ok(!selected.has("1-2"));
  assert.ok(!selected.has("3-4"));
});

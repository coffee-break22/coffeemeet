import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceMeetingConfig,
  weeklyMatchingOpensAt,
  type MeetingConfig,
} from "../src/data/meetingConfig.ts";
const config: MeetingConfig = {
  weekCode: "2026-W36",
  schoolCategoryLabel: "Afiliación",
  schoolCategoryEnabled: true,
  schools: [{ id: "harvard", name: "Harvard" }],
  cities: [],
  days: [
    {
      label: "Martes",
      date: "2026-09-01",
      enabled: true,
      blocked: true,
      reason: "Festivo",
      disabledOther: false,
      otherReason: "",
    },
    {
      label: "Miércoles",
      date: "2026-09-02",
      enabled: true,
      blocked: false,
      reason: "",
      disabledOther: false,
      otherReason: "",
    },
  ],
  times: ["12:30"],
};
test("avanza una configuración cerrada a la siguiente semana abierta", () => {
  const next = advanceMeetingConfig(
    config,
    new Date("2026-09-02T12:00:00-05:00"),
  );
  assert.equal(next.weekCode, "2026-W37");
  assert.deepEqual(
    next.days.map((day) => day.date),
    ["2026-09-08", "2026-09-09"],
  );
  assert.equal(next.days[0].blocked, false);
  assert.equal(config.weekCode, "2026-W36");
});
test("resetea 'inhabilitar por otro motivo' al avanzar de semana", () => {
  const withOtherReason: MeetingConfig = {
    ...config,
    days: config.days.map((day, index) =>
      index === 0
        ? { ...day, disabledOther: true, otherReason: "Mantenimiento" }
        : day,
    ),
  };
  const next = advanceMeetingConfig(
    withOtherReason,
    new Date("2026-09-02T12:00:00-05:00"),
  );
  assert.equal(next.days[0].disabledOther, false);
  assert.equal(next.days[0].otherReason, "");
});
test("no modifica una semana cuyo matching todavía no cerró", () => {
  const next = advanceMeetingConfig(
    config,
    new Date("2026-08-31T09:59:59-05:00"),
  );
  assert.deepEqual(next, config);
});
test("puede recuperar varias semanas vencidas sin quedar en una intermedia", () => {
  const next = advanceMeetingConfig(
    config,
    new Date("2026-09-14T10:00:01-05:00"),
  );
  assert.equal(next.weekCode, "2026-W39");
  assert.equal(next.days[0].date, "2026-09-22");
});
test("matching abre el lunes a las 10 en Colombia", () => {
  assert.equal(
    weeklyMatchingOpensAt("2026-W37")?.toISOString(),
    "2026-09-07T15:00:00.000Z",
  );
});

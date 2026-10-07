export interface CityConfig {
  id: string;
  name: string;
  places: { id: string; name: string }[];
}
export interface DayConfig {
  label: string;
  date: string;
  enabled: boolean;
  blocked: boolean;
  reason: string;
  disabledOther: boolean;
  otherReason: string;
}
export interface SchoolConfig {
  id: string;
  name: string;
}
export interface MeetingConfig {
  weekCode: string;
  schoolCategoryLabel: string;
  schoolCategoryEnabled: boolean;
  schools: SchoolConfig[];
  cities: CityConfig[];
  days: DayConfig[];
  times: string[];
}
export const WEEKDAY_ORDER = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

const KEY = "coffeemeet.meeting-config.v1";

export const DEFAULT_CONFIG: MeetingConfig = {
  weekCode: "2026-W36",
  schoolCategoryLabel: "Afiliación",
  schoolCategoryEnabled: true,
  schools: [
    { id: "harvard", name: "Harvard" },
    { id: "mit", name: "MIT" },
    { id: "harvard_mit", name: "Harvard y MIT" },
  ],
  cities: [
    {
      id: "bogota",
      name: "Bogotá",
      places: [
        { id: "cafe-centro", name: "Café Centro" },
        { id: "zona-t", name: "Zona T" },
      ],
    },
    {
      id: "medellin",
      name: "Medellín",
      places: [
        { id: "poblado", name: "El Poblado" },
        { id: "laureles", name: "Laureles" },
      ],
    },
    {
      id: "cali",
      name: "Cali",
      places: [
        { id: "granada", name: "Granada" },
        { id: "pance", name: "Pance" },
      ],
    },
  ],
  days: [
    {
      label: "Martes",
      date: "2026-09-01",
      enabled: true,
      blocked: false,
      reason: "",
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
    {
      label: "Jueves",
      date: "2026-09-03",
      enabled: true,
      blocked: false,
      reason: "",
      disabledOther: false,
      otherReason: "",
    },
  ],
  times: ["08:00", "12:30", "18:00"],
};

export function normalizeMeetingConfig(
  config: Partial<MeetingConfig>,
): MeetingConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    schools:
      Array.isArray(config.schools) && config.schools.length
        ? config.schools
        : DEFAULT_CONFIG.schools,
    cities: Array.isArray(config.cities)
      ? config.cities
      : DEFAULT_CONFIG.cities,
    days: (Array.isArray(config.days) ? config.days : DEFAULT_CONFIG.days).map(
      (day) => {
        const partial = day as Partial<DayConfig>;
        return {
          disabledOther: false,
          otherReason: "",
          ...partial,
        } as DayConfig;
      },
    ),
    times: Array.isArray(config.times) ? config.times : DEFAULT_CONFIG.times,
    schoolCategoryLabel:
      config.schoolCategoryLabel ?? DEFAULT_CONFIG.schoolCategoryLabel,
    schoolCategoryEnabled:
      config.schoolCategoryEnabled ?? DEFAULT_CONFIG.schoolCategoryEnabled,
  };
}
export function loadMeetingConfig(): MeetingConfig {
  try {
    return advanceMeetingConfig(
      normalizeMeetingConfig(
        JSON.parse(
          localStorage.getItem(KEY) ?? JSON.stringify(DEFAULT_CONFIG),
        ) as Partial<MeetingConfig>,
      ),
    );
  } catch {
    return advanceMeetingConfig(DEFAULT_CONFIG);
  }
}
export const saveMeetingConfig = (config: MeetingConfig) =>
  localStorage.setItem(KEY, JSON.stringify(config));

export function isoMonday(weekCode: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekCode);
  if (!match) return null;
  const year = Number(match[1]),
    week = Number(match[2]),
    jan4 = new Date(Date.UTC(year, 0, 4)),
    day = jan4.getUTCDay() || 7;
  return new Date(Date.UTC(year, 0, 4 - day + 1 + (week - 1) * 7));
}
export function weeklyMatchingOpensAt(weekCode: string) {
  const monday = isoMonday(weekCode);
  return monday
    ? new Date(monday.toISOString().slice(0, 10) + "T10:00:00-05:00")
    : null;
}
export function alignMeetingConfigWeek(
  config: MeetingConfig,
  weekCode: string,
): MeetingConfig {
  const monday = isoMonday(weekCode);
  if (!monday) return { ...config, weekCode };
  return {
    ...config,
    weekCode,
    days: config.days.map((day) => {
      const source = new Date(day.date + "T12:00:00Z"),
        isoDay = source.getUTCDay() || 7,
        target = new Date(monday);
      target.setUTCDate(target.getUTCDate() + isoDay - 1);
      return { ...day, date: target.toISOString().slice(0, 10) };
    }),
  };
}
function isoWeekCode(date: Date) {
  const value = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((value.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return value.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}
export function advanceMeetingConfig(
  config: MeetingConfig,
  now = new Date(),
): MeetingConfig {
  let next = structuredClone(normalizeMeetingConfig(config)),
    monday = isoMonday(next.weekCode);
  if (!monday) return next;
  while (
    now.getTime() >=
    new Date(monday.toISOString().slice(0, 10) + "T10:00:00-05:00").getTime()
  ) {
    monday = new Date(monday.getTime() + 7 * 86400000);
    next = {
      ...next,
      weekCode: isoWeekCode(monday),
      days: next.days.map((day) => {
        const date = new Date(day.date + "T12:00:00Z");
        date.setUTCDate(date.getUTCDate() + 7);
        return {
          ...day,
          date: date.toISOString().slice(0, 10),
          blocked: false,
          reason: "",
          disabledOther: false,
          otherReason: "",
        };
      }),
    };
  }
  return next;
}
const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
export function weekRangeLabel(weekCode: string, includeYear = false) {
  const monday = isoMonday(weekCode);
  if (!monday) return weekCode;
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const range = `${monday.getUTCDate()} ${MONTHS[monday.getUTCMonth()]} – ${sunday.getUTCDate()} ${MONTHS[sunday.getUTCMonth()]}`;
  return includeYear ? `${range} ${sunday.getUTCFullYear()}` : range;
}
export function dateForWeekday(weekCode: string, weekdayIndex: number) {
  const monday = isoMonday(weekCode);
  if (!monday) return "";
  const target = new Date(monday.getTime() + weekdayIndex * 86400000);
  return target.toISOString().slice(0, 10);
}

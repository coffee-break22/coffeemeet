export type School = string;
export type VerificationStatus = "pending" | "approved" | "rejected";
export type MatchBasis = "email" | "phone" | "none" | "ambiguous";

export interface RegistryEntry {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  school: School;
  graduationYear: number;
  active: boolean;
  registered?: boolean;
  notes: string;
  source: string;
  importedAt?: string;
  updatedAt: string;
}
export const schoolLabels: Record<string, string> = {
  harvard: "Harvard",
  mit: "MIT",
  harvard_mit: "Harvard y MIT",
};
export const schoolLabel = (
  school: string,
  configured?: Array<{ id: string; name: string }>,
) =>
  configured?.find((item) => item.id === school)?.name ??
  schoolLabels[school] ??
  school;
export const normalizeEmail = (value: string) =>
  value.trim().toLocaleLowerCase();
export function normalizePhone(value: string, defaultCountryCode = "57") {
  const raw = value.trim();
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = defaultCountryCode + digits;
  return `+${digits}`;
}
export const isValidWhatsAppPhone = (value: string) =>
  /^\+[1-9][0-9]{7,14}$/.test(
    `+${value.trim().replace(/^\+/, "").replace(/\D/g, "")}`,
  ) && value.trim().startsWith("+");
export interface RegistryMatch {
  basis: MatchBasis;
  entry?: RegistryEntry;
  candidates: RegistryEntry[];
}
export function matchRegistry(
  entries: RegistryEntry[],
  email: string,
  phone: string,
): RegistryMatch {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const emailMatches = normalizedEmail
    ? entries.filter(
        (e) => e.active && normalizeEmail(e.email) === normalizedEmail,
      )
    : [];
  const phoneMatches = normalizedPhone
    ? entries.filter(
        (e) => e.active && normalizePhone(e.phone) === normalizedPhone,
      )
    : [];
  const candidates = Array.from(
    new Map([...emailMatches, ...phoneMatches].map((e) => [e.id, e])).values(),
  );
  if (candidates.length !== 1)
    return { basis: candidates.length ? "ambiguous" : "none", candidates };
  const entry = candidates[0];
  const basis =
    emailMatches.length === 1 && phoneMatches.length === 0
      ? "email"
      : phoneMatches.length === 1 && emailMatches.length === 0
        ? "phone"
        : emailMatches[0]?.id === phoneMatches[0]?.id
          ? "email"
          : "ambiguous";
  return basis === "ambiguous"
    ? { basis, candidates }
    : { basis, entry, candidates };
}
export interface ReputationSummary {
  totalMatched: number;
  noNotice: number;
  notice: number;
  secondChances: number;
}
export const isBlocked = ({ noNotice, secondChances }: ReputationSummary) =>
  noNotice > secondChances;
export const noticeRate = (s: ReputationSummary) =>
  s.totalMatched ? s.notice / s.totalMatched : 0;
export const exceedsNoticeThreshold = (s: ReputationSummary) =>
  noticeRate(s) > 0.5;
export function matchingPenalty(s: ReputationSummary) {
  if (isBlocked(s)) return Number.NEGATIVE_INFINITY;
  return (
    s.noNotice * 50 + (exceedsNoticeThreshold(s) ? 20 : 0) + s.totalMatched * 3
  );
}
export type CancellationResult =
  "exempt_prior_completed" | "on_time" | "late_no_show";
export function classifyCancellation(
  scheduledAt: Date,
  cancelledAt: Date,
  hasPriorCompletedMeeting: boolean,
): CancellationResult {
  if (hasPriorCompletedMeeting) return "exempt_prior_completed";
  return scheduledAt.getTime() - cancelledAt.getTime() >= 30 * 60 * 1000
    ? "on_time"
    : "late_no_show";
}
export interface CsvPreviewRow {
  row: number;
  entry?: Omit<RegistryEntry, "id" | "updatedAt">;
  errors: string[];
  duplicate: boolean;
}
export function parseRegistryCsv(
  text: string,
  current: RegistryEntry[],
): CsvPreviewRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);
  if (!lines.length) return [];
  // Excel en espa\u00F1ol exporta CSV con ";" (la coma queda reservada como
  // separador decimal); se detecta el delimitador real contando cu\u00E1l
  // aparece m\u00E1s en el encabezado, en vez de asumir siempre coma.
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const split = (line: string) => {
    const values: string[] = [];
    let current = "",
      inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };
  const headers = split(lines[0]).map((h) => normalizeEmail(h));
  const at = (values: string[], names: string[]) => {
    const i = headers.findIndex((h) => names.includes(h));
    return i >= 0 ? (values[i] ?? "") : "";
  };
  return lines.slice(1).map((line, index) => {
    const v = split(line);
    const fullName = at(v, ["nombre", "name", "full_name"]);
    const email = at(v, ["email", "correo"]);
    const phone = at(v, ["telefono", "teléfono", "phone", "whatsapp"]);
    const schoolRaw = normalizeEmail(at(v, ["escuela", "school"]));
    const year = Number(
      at(v, ["anio", "año", "graduation_year", "promocion", "promoción"]),
    );
    const school: School =
      schoolRaw.includes("harvard") && schoolRaw.includes("mit")
        ? "harvard_mit"
        : schoolRaw.includes("mit")
          ? "mit"
          : schoolRaw.includes("harvard")
            ? "harvard"
            : schoolRaw
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "");
    const errors: string[] = [];
    if (!fullName) errors.push("Falta nombre");
    if (!email && !phone) errors.push("Falta email o teléfono");
    if (!school) errors.push("Falta escuela");
    if (!Number.isInteger(year) || year < 1900 || year > 2100)
      errors.push("Año inválido");
    const duplicate = current.some(
      (e) =>
        (email && normalizeEmail(e.email) === normalizeEmail(email)) ||
        (phone && normalizePhone(e.phone) === normalizePhone(phone)),
    );
    return {
      row: index + 2,
      errors,
      duplicate,
      entry: errors.length
        ? undefined
        : {
            fullName,
            email,
            phone,
            school,
            graduationYear: year,
            active: true,
            notes: "",
            source: "csv",
            importedAt: new Date().toISOString(),
          },
    };
  });
}

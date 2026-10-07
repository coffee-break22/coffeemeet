import {
  normalizeEmail,
  normalizePhone,
  type RegistryEntry,
  type School,
} from "../domain/coffeemeet.ts";
import { supabase } from "../infrastructure/supabase/client.ts";

const rowToEntry = (row: Record<string, unknown>): RegistryEntry => ({
  id: String(row.id),
  fullName: String(row.full_name),
  email: String(row.email ?? ""),
  phone: String(row.phone ?? ""),
  school: row.school as RegistryEntry["school"],
  graduationYear: Number(row.graduation_year),
  active: Boolean(row.active),
  registered: Boolean(row.registered),
  notes: String(row.notes ?? ""),
  source: String(row.source) as RegistryEntry["source"],
  updatedAt: String(row.updated_at),
});
const entryToRow = (entry: RegistryEntry) => ({
  id: entry.id,
  full_name: entry.fullName,
  email: entry.email || null,
  normalized_email: entry.email ? normalizeEmail(entry.email) : null,
  phone: entry.phone || null,
  normalized_phone: entry.phone ? normalizePhone(entry.phone) : null,
  school: entry.school,
  graduation_year: entry.graduationYear,
  active: entry.active,
  notes: entry.notes,
  source: entry.source,
  updated_at: new Date().toISOString(),
  deactivated_at: entry.active ? null : new Date().toISOString(),
});

export interface RegistryPageFilters {
  query: string;
  school?: School;
  active?: boolean;
  registered?: boolean;
  year?: number;
  page: number;
  pageSize: number;
}
export interface RegistryPage {
  items: RegistryEntry[];
  total: number;
  counts: { all: number; active: number; inactive: number; imported: number };
}
export async function loadAdminRegistryPage(
  filters: RegistryPageFilters,
): Promise<RegistryPage> {
  if (!supabase)
    return {
      items: [],
      total: 0,
      counts: { all: 0, active: 0, inactive: 0, imported: 0 },
    };
  const { data, error } = await supabase.rpc("get_admin_registry_page", {
    p_query: filters.query,
    p_school: filters.school ?? null,
    p_active: filters.active ?? null,
    p_year: filters.year ?? null,
    p_page: filters.page,
    p_page_size: filters.pageSize,
    p_registered: filters.registered ?? null,
  });
  if (error) throw error;
  const value = data as unknown as {
    items?: Record<string, unknown>[];
    total?: number;
    counts?: RegistryPage["counts"];
  };
  return {
    items: (value.items ?? []).map(rowToEntry),
    total: Number(value.total ?? 0),
    counts: value.counts ?? { all: 0, active: 0, inactive: 0, imported: 0 },
  };
}
export async function searchAdminRegistry(
  query: string,
  limit = 20,
): Promise<RegistryEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("search_admin_registry", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => rowToEntry(row));
}
export async function saveAdminRegistryEntry(
  entry: RegistryEntry,
): Promise<RegistryEntry> {
  if (!supabase) return entry;
  const { data, error } = await supabase
    .from("alumni_registry")
    .upsert(entryToRow(entry))
    .select()
    .single();
  if (error) throw error;
  return rowToEntry(data);
}
export async function importAdminRegistry(
  entries: RegistryEntry[],
): Promise<RegistryEntry[]> {
  if (!supabase || entries.length === 0) return entries;
  const saved: RegistryEntry[] = [];
  for (let offset = 0; offset < entries.length; offset += 200) {
    const { data, error } = await supabase
      .from("alumni_registry")
      .insert(entries.slice(offset, offset + 200).map(entryToRow))
      .select();
    if (error) throw error;
    saved.push(...(data ?? []).map((row) => rowToEntry(row)));
  }
  return saved;
}

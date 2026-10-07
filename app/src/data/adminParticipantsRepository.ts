import { supabase } from "../infrastructure/supabase/client.ts";

export interface AdminParticipant {
  id: string;
  fullName: string;
  email: string;
  alumniEmail: string;
  phone: string;
  linkedinUrl: string;
  school: string;
  graduationYear: number;
  createdAt: string;
}
export interface ParticipantsPageFilters {
  query: string;
  page: number;
  pageSize: number;
}
export interface ParticipantsPage {
  participants: AdminParticipant[];
  total: number;
}

export async function loadAdminParticipantsPage(
  filters: ParticipantsPageFilters,
): Promise<ParticipantsPage> {
  if (!supabase) return { participants: [], total: 0 };
  const { data, error } = await supabase.rpc("get_admin_participants_page", {
    p_query: filters.query,
    p_page: filters.page,
    p_page_size: filters.pageSize,
  });
  if (error) throw error;
  const value = data as unknown as {
    items?: Record<string, unknown>[];
    total?: number;
  };
  const participants = (value.items ?? []).map(
    (row) =>
      ({
        id: String(row.id),
        fullName: String(row.fullName ?? ""),
        email: String(row.email ?? ""),
        alumniEmail: String(row.alumniEmail ?? ""),
        phone: String(row.phone ?? ""),
        linkedinUrl: String(row.linkedinUrl ?? ""),
        school: String(row.school ?? ""),
        graduationYear: Number(row.graduationYear ?? 0),
        createdAt: String(row.createdAt ?? ""),
      }) satisfies AdminParticipant,
  );
  return { participants, total: Number(value.total ?? 0) };
}

export type WeeklyStatus = "confirmed" | "not_confirmed" | "withdrawn";
export interface WeeklyParticipant {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  school: string;
  linkedin: string;
  status: WeeklyStatus;
  confirmedAt: string | null;
}
export interface ConfirmedPreviousWeekPage {
  items: WeeklyParticipant[];
  total: number;
  previousWeekCode: string;
  previousWeekMonday: string;
  counts: { confirmed: number; notConfirmed: number; withdrawn: number };
}
export async function loadConfirmedPreviousWeekPage(filters: {
  weekCode: string;
  query: string;
  filter?: WeeklyStatus;
  page: number;
  pageSize: number;
}): Promise<ConfirmedPreviousWeekPage> {
  const empty: ConfirmedPreviousWeekPage = {
    items: [],
    total: 0,
    previousWeekCode: "",
    previousWeekMonday: "",
    counts: { confirmed: 0, notConfirmed: 0, withdrawn: 0 },
  };
  if (!supabase) return empty;
  const { data, error } = await supabase.rpc(
    "get_admin_confirmed_previous_week_page",
    {
      p_week_code: filters.weekCode,
      p_query: filters.query,
      p_filter: filters.filter ?? null,
      p_page: filters.page,
      p_page_size: filters.pageSize,
    },
  );
  if (error) throw error;
  const value = data as unknown as {
    items?: Record<string, unknown>[];
    total?: number;
    previousWeekCode?: string;
    previousWeekMonday?: string;
    counts?: ConfirmedPreviousWeekPage["counts"];
  };
  return {
    items: (value.items ?? []).map((row) => ({
      id: String(row.id),
      fullName: String(row.fullName ?? ""),
      email: String(row.email ?? ""),
      phone: String(row.phone ?? ""),
      school: String(row.school ?? ""),
      linkedin: String(row.linkedin ?? ""),
      status: row.status as WeeklyStatus,
      confirmedAt: row.confirmedAt ? String(row.confirmedAt) : null,
    })),
    total: Number(value.total ?? 0),
    previousWeekCode: value.previousWeekCode ?? "",
    previousWeekMonday: value.previousWeekMonday ?? "",
    counts: value.counts ?? { confirmed: 0, notConfirmed: 0, withdrawn: 0 },
  };
}

export interface LiveParticipant {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  school: string;
  status: "confirmed" | "pending" | "withdrawn";
  confirmedAt: string | null;
}
export interface LiveConfirmationsPage {
  windowOpen: boolean;
  items: LiveParticipant[];
  total: number;
  counts: { confirmed: number; pending: number; withdrawn: number };
  opensAt: string;
  closesAt: string;
}
export async function loadLiveConfirmationsPage(filters: {
  weekCode: string;
  query: string;
  page: number;
  pageSize: number;
}): Promise<LiveConfirmationsPage> {
  const empty: LiveConfirmationsPage = {
    windowOpen: false,
    items: [],
    total: 0,
    counts: { confirmed: 0, pending: 0, withdrawn: 0 },
    opensAt: "",
    closesAt: "",
  };
  if (!supabase) return empty;
  const { data, error } = await supabase.rpc(
    "get_admin_live_confirmations_page",
    {
      p_week_code: filters.weekCode,
      p_query: filters.query,
      p_page: filters.page,
      p_page_size: filters.pageSize,
    },
  );
  if (error) throw error;
  const value = data as unknown as {
    windowOpen?: boolean;
    items?: Record<string, unknown>[];
    total?: number;
    counts?: LiveConfirmationsPage["counts"];
    opensAt?: string;
    closesAt?: string;
  };
  return {
    windowOpen: Boolean(value.windowOpen),
    items: (value.items ?? []).map((row) => ({
      id: String(row.id),
      fullName: String(row.fullName ?? ""),
      email: String(row.email ?? ""),
      phone: String(row.phone ?? ""),
      school: String(row.school ?? ""),
      status: row.status as LiveParticipant["status"],
      confirmedAt: row.confirmedAt ? String(row.confirmedAt) : null,
    })),
    total: Number(value.total ?? 0),
    counts: value.counts ?? { confirmed: 0, pending: 0, withdrawn: 0 },
    opensAt: value.opensAt ?? "",
    closesAt: value.closesAt ?? "",
  };
}
export async function adminWithdrawWeeklyParticipation(
  userId: string,
  weekCode: string,
) {
  if (!supabase) return;
  const { error } = await supabase.rpc("admin_withdraw_weekly_participation", {
    p_user_id: userId,
    p_week_code: weekCode,
  });
  if (error)
    throw new Error(
      [error.code, error.message, error.details, error.hint]
        .filter(Boolean)
        .join(" · "),
    );
}

export async function adminDeleteAccount(userId: string) {
  if (!supabase) return;
  const { error } = await supabase.rpc("admin_delete_account", {
    p_user_id: userId,
  });
  if (error)
    throw new Error(
      [error.code, error.message, error.details, error.hint]
        .filter(Boolean)
        .join(" · "),
    );
}

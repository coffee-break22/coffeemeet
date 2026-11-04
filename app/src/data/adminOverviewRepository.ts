import { supabase } from "../infrastructure/supabase/client.ts";

export interface ConfirmedLastWeek {
  confirmed: number;
  notConfirmed: number;
  withdrawn: number;
  registeredAtCutoff: number;
}
export interface MeetingsLastWeek {
  pairs: number;
  people: number;
  confirmedParticipants: number;
}
export interface SustainabilityMetrics {
  confirmedParticipants: number;
  possiblePairs: number;
  completedPairs: number;
  newPairsRemaining: number;
  weeksLow: number;
  weeksHigh: number;
  totalMeetingsEver: number;
  repeatMeetingsEver: number;
  repeatRatePct: number;
  lastWeekPairs: number;
  lastWeekRepeats: number;
}
export interface AdminOverview {
  approved: number;
  pending: number;
  rejected: number;
  communityMembers: number;
  approvedInDirectory: number;
  approvedBeyondDirectory: number;
  previousWeekCode: string;
  previousWeekMonday: string;
  configuredWeekStart: string;
  configuredWeekEnd: string;
  registeredAtCutoff: number;
  confirmedLastWeek: ConfirmedLastWeek;
  meetingsLastWeek: MeetingsLastWeek;
  sustainability: SustainabilityMetrics | null;
}
const empty: AdminOverview = {
  approved: 0,
  pending: 0,
  rejected: 0,
  communityMembers: 0,
  approvedInDirectory: 0,
  approvedBeyondDirectory: 0,
  previousWeekCode: "",
  previousWeekMonday: "",
  configuredWeekStart: "",
  configuredWeekEnd: "",
  registeredAtCutoff: 0,
  confirmedLastWeek: { confirmed: 0, notConfirmed: 0, withdrawn: 0, registeredAtCutoff: 0 },
  meetingsLastWeek: { pairs: 0, people: 0, confirmedParticipants: 0 },
  sustainability: null,
};

export async function loadAdminOverview(weekCode: string): Promise<AdminOverview> {
  if (!supabase) return empty;
  const { data, error } = await supabase.rpc("get_admin_overview", { p_week_code: weekCode });
  if (error) throw error;
  if (!data || typeof data !== "object") return empty;
  return data as unknown as AdminOverview;
}

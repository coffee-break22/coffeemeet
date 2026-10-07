import type { MatchBatch } from "../application/matchBatches.ts";
import type {
  AvailabilitySlot,
  CompletedPair,
  MatchParticipant,
  MatchingResult,
} from "../domain/matching.ts";
import { supabase } from "../infrastructure/supabase/client.ts";
function parseSlot(id: string, city: string): AvailabilitySlot | null {
  const parts = id.split("|");
  if (parts[0] === "virtual" && parts.length >= 3)
    return {
      id,
      date: parts[1],
      time: parts.slice(2).join("|"),
      mode: "virtual",
      city,
    };
  if (parts.length >= 4)
    return {
      id,
      city: parts[0],
      place: parts[1],
      date: parts[2],
      time: parts.slice(3).join("|"),
      mode: "in_person",
    };
  return null;
}
export async function loadAdminMatchingData(weekCode: string): Promise<{
  participants: MatchParticipant[];
  history: CompletedPair[];
  batches: MatchBatch[];
  counts: {
    registered: number;
    approved: number;
    confirmed: number;
    eligible: number;
  };
}> {
  if (!supabase)
    return {
      participants: [],
      history: [],
      batches: [],
      counts: { registered: 0, approved: 0, confirmed: 0, eligible: 0 },
    };
  const [{ data, error }, { data: countData, error: countError }] =
    await Promise.all([
      supabase.rpc("get_admin_matching_data", { p_week_code: weekCode }),
      supabase.rpc("get_admin_participant_counts", { p_week_code: weekCode }),
    ]);
  if (error)
    throw new Error(
      [error.code, error.message, error.details, error.hint]
        .filter(Boolean)
        .join(" · "),
    );
  if (countError) throw countError;
  const payload = (data ?? {}) as {
    participants?: Array<{
      id: string;
      fullName: string;
      phone: string;
      email: string;
      city: string;
      verificationStatus: MatchParticipant["verificationStatus"];
      blocked: boolean;
      slotIds: string[];
      knownPhones: string[];
      knownEmails: string[];
      onlyNewPeople: boolean;
      completedMeetingCount: number;
      noticeCancellationRate: number;
      hadPartnerIssueLastWeek: boolean;
      weeksSinceTiebreakLoss: number | null;
    }>;
    history?: CompletedPair[];
    batches?: Array<{
      id: string;
      weekCode: string;
      revision: number;
      fingerprint: string;
      status: MatchBatch["status"];
      result: MatchingResult;
      generatedAt: string;
      confirmedAt: string | null;
      isTest?: boolean;
    }>;
  };
  const participants = (payload.participants ?? []).map(
    (row) =>
      ({
        id: row.id,
        fullName: row.fullName,
        phone: row.phone,
        email: row.email,
        city: row.city,
        verificationStatus: row.verificationStatus,
        blocked: row.blocked,
        slots: row.slotIds
          .map((id) => parseSlot(id, row.city))
          .filter((item): item is AvailabilitySlot => Boolean(item)),
        knownPhones: row.knownPhones,
        knownEmails: row.knownEmails,
        onlyNewPeople: row.onlyNewPeople,
        completedMeetingCount: Number(row.completedMeetingCount),
        noticeCancellationRate: Number(row.noticeCancellationRate),
        hadPartnerIssueLastWeek: Boolean(row.hadPartnerIssueLastWeek),
        weeksSinceTiebreakLoss:
          row.weeksSinceTiebreakLoss == null ? null : Number(row.weeksSinceTiebreakLoss),
      }) satisfies MatchParticipant,
  );
  const history = payload.history ?? [];
  const batches = (payload.batches ?? []).map(
    (row) =>
      ({
        id: row.id,
        weekCode: row.weekCode,
        revision: row.revision,
        fingerprint: row.fingerprint,
        status: row.status,
        result: row.result,
        createdAt: row.generatedAt,
        confirmedAt: row.confirmedAt ?? undefined,
        sideEffectKeys:
          row.status === "confirmed"
            ? Array.from(
                { length: (row.result.pairs?.length ?? 0) * 3 },
                (_, i) => String(i),
              )
            : [],
        isTest: Boolean(row.isTest),
      }) satisfies MatchBatch,
  );
  const rawCounts = (countData ?? {}) as Record<string, number>;
  return {
    participants,
    history,
    batches,
    counts: {
      registered: Number(rawCounts.registered ?? 0),
      approved: Number(rawCounts.approved ?? 0),
      confirmed: Number(rawCounts.confirmed ?? 0),
      eligible: Number(rawCounts.eligible ?? 0),
    },
  };
}
export async function saveRemoteMatchDraft(
  batch: MatchBatch,
  regenerate: boolean,
): Promise<Pick<MatchBatch, "id" | "revision" | "status" | "createdAt">> {
  if (!supabase) return batch;
  const { data, error } = await supabase.rpc("save_match_draft", {
    p_week_code: batch.weekCode,
    p_fingerprint: batch.fingerprint,
    p_result: batch.result,
    p_regenerate: regenerate,
    p_test_mode: Boolean(batch.isTest),
  });
  if (error)
    throw new Error(
      [error.code, error.message, error.details, error.hint]
        .filter(Boolean)
        .join(" · "),
    );
  const row = Array.isArray(data) ? data[0] : data;
  return {
    id: row.batch_id,
    revision: row.revision,
    status: row.status,
    createdAt: row.generated_at,
  };
}
export async function confirmRemoteMatchBatch(batchId: string) {
  if (!supabase) return;
  const { error } = await supabase.rpc("confirm_match_batch", {
    p_batch_id: batchId,
  });
  if (error) throw error;
}
export async function cleanupRemoteTestData():Promise<{status:'waiting_calendar'|'completed';pendingCalendar:number;deletedBatches:number}>{
  if(!supabase) return{status:'completed',pendingCalendar:0,deletedBatches:0};
  const{data,error}=await supabase.rpc('cleanup_test_data');
  if(error)throw error;
  return data as {status:'waiting_calendar'|'completed';pendingCalendar:number;deletedBatches:number};
}

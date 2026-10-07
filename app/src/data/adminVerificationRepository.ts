import type { VerificationRequest } from "../application/verification.ts";
import { supabase } from "../infrastructure/supabase/client.ts";

export interface VerificationPageFilters {
  query: string;
  status?: "pending" | "approved" | "rejected";
  page: number;
  pageSize: number;
}
export interface VerificationPage {
  requests: VerificationRequest[];
  total: number;
  pendingTotal: number;
}

export async function loadAdminVerificationPage(
  filters: VerificationPageFilters,
): Promise<VerificationPage> {
  if (!supabase) return { requests: [], total: 0, pendingTotal: 0 };
  const { data, error } = await supabase.rpc("get_admin_verification_page", {
    p_query: filters.query,
    p_status: filters.status ?? null,
    p_page: filters.page,
    p_page_size: filters.pageSize,
  });
  if (error) throw error;
  const value = data as unknown as {
    items?: Record<string, unknown>[];
    total?: number;
    pendingTotal?: number;
  };
  const requests = (value.items ?? []).map((row) => {
    const registryId = row.registryId ? String(row.registryId) : undefined;
    return {
      id: String(row.id),
      userId: String(row.userId),
      fingerprint: "",
      snapshot: {
        fullName: String(row.fullName ?? ""),
        email: String(row.email ?? ""),
        alumniEmail: String(row.alumniEmail ?? ""),
        phone: String(row.phone ?? ""),
        linkedin: String(row.linkedin ?? ""),
        school: String(row.school ?? ""),
        graduationYear: Number(row.graduationYear ?? 0),
      },
      status: row.status as VerificationRequest["status"],
      candidateRegistryIds: registryId ? [registryId] : [],
      suggestedRegistryId: registryId,
      matchBasis: (row.matchBasis ??
        "none") as VerificationRequest["matchBasis"],
      decision: row.decidedAt
        ? {
            status: row.status as "approved" | "rejected",
            registryId,
            notes: String(row.notes ?? ""),
            actorId: String(row.decidedBy ?? ""),
            decidedAt: String(row.decidedAt),
            automatic: false,
          }
        : undefined,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    } satisfies VerificationRequest;
  });
  return {
    requests,
    total: Number(value.total ?? 0),
    pendingTotal: Number(value.pendingTotal ?? 0),
  };
}

export async function saveAdminVerificationDecision(input: {
  requestId: string;
  status: "approved" | "rejected";
  registryId?: string;
  notes: string;
}) {
  if (!supabase) return;
  const { error } = await supabase.rpc("decide_verification_request", {
    p_request_id: input.requestId,
    p_status: input.status,
    p_registry_id: input.registryId ?? null,
    p_notes: input.notes,
  });
  if (error)
    throw new Error(
      [error.code, error.message, error.details, error.hint]
        .filter(Boolean)
        .join(" · "),
    );
}

import { supabase } from "../infrastructure/supabase/client.ts";
export type NotificationStatus =
  "pending" | "processing" | "succeeded" | "failed" | "cancelled";
export interface NotificationJob {
  id: string;
  kind: string;
  status: NotificationStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
  payload: Record<string, unknown>;
  sentText: string | null;
  destinationName: string | null;
  destinationPhone: string | null;
}
export interface NotificationPage {
  items: NotificationJob[];
  total: number;
  counts: Record<NotificationStatus, number>;
}
export type WhatsAppConnectionStatus =
  | "offline"
  | "connecting"
  | "awaiting_qr"
  | "connected"
  | "reconnecting"
  | "logged_out"
  | "error";
export interface WhatsAppConnectionState {
  status: WhatsAppConnectionStatus;
  qrDataUrl: string | null;
  phone: string | null;
  connectedAt: string | null;
  heartbeatAt: string | null;
  updatedAt: string;
  lastError: string | null;
  requestedCommand: "reconnect" | "logout" | null;
}
export async function loadNotificationPage(
  status: NotificationStatus | undefined,
  page: number,
  pageSize: number,
  query?: string,
): Promise<NotificationPage> {
  if (!supabase)
    return {
      items: [],
      total: 0,
      counts: {
        pending: 0,
        processing: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      },
    };
  const [pageResult, summaryResult] = await Promise.all([
    supabase.rpc("get_admin_notification_page", {
      p_status: status ?? null,
      p_query: query?.trim() ? query.trim() : null,
      p_page: page,
      p_page_size: pageSize,
    }),
    supabase.rpc("get_admin_notification_summary"),
  ]);
  if (pageResult.error) throw pageResult.error;
  if (summaryResult.error) throw summaryResult.error;
  const rows = pageResult.data ?? [];
  const counts = {
    pending: Number(summaryResult.data?.pending ?? 0),
    processing: Number(summaryResult.data?.processing ?? 0),
    succeeded: Number(summaryResult.data?.succeeded ?? 0),
    failed: Number(summaryResult.data?.failed ?? 0),
    cancelled: Number(summaryResult.data?.cancelled ?? 0),
  };
  return {
    items: rows.map((row: any): NotificationJob => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      attemptCount: row.attempt_count,
      nextAttemptAt: row.next_attempt_at,
      lastError: row.last_error,
      createdAt: row.created_at,
      processedAt: row.processed_at,
      payload: row.payload ?? {},
      sentText: row.sent_text,
      destinationName: row.destination_name,
      destinationPhone: row.destination_phone,
    })),
    // El total viene directo del conteo de la propia consulta filtrada
    // (RPC, ventana count(*) over()) — refleja estado + búsqueda a la
    // vez. Si no hay filas (página vacía tras filtrar), el total es 0.
    total: rows.length ? Number(rows[0].total_count) : 0,
    counts,
  };
}
export async function retryNotification(id: string) {
  if (!supabase) throw new Error("SUPABASE_REQUIRED");
  const { error } = await supabase.rpc("retry_notification", { p_id: id });
  if (error) throw error;
}
export async function loadWhatsAppConnection(): Promise<WhatsAppConnectionState> {
  if (!supabase) throw new Error("SUPABASE_REQUIRED");
  const { data, error } = await supabase.rpc("get_admin_whatsapp_state");
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("WHATSAPP_STATE_NOT_FOUND");
  return {
    status: row.status,
    qrDataUrl: row.qr_data_url,
    phone: row.phone,
    connectedAt: row.connected_at,
    heartbeatAt: row.heartbeat_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
    requestedCommand: row.requested_command,
  };
}
export async function requestWhatsAppCommand(command: "reconnect" | "logout") {
  if (!supabase) throw new Error("SUPABASE_REQUIRED");
  const { error } = await supabase.rpc("request_admin_whatsapp_command", {
    p_command: command,
  });
  if (error) throw error;
}

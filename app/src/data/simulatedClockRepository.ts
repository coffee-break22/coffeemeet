import { supabase } from "../infrastructure/supabase/client.ts";

export interface SimulatedClockState {
  enabled: boolean;
  simulatedAt: string | null;
  updatedAt: string | null;
}

const empty: SimulatedClockState = {
  enabled: false,
  simulatedAt: null,
  updatedAt: null,
};

export async function loadSimulatedClock(): Promise<SimulatedClockState> {
  if (!supabase) return empty;
  const { data, error } = await supabase.rpc("admin_get_simulated_clock");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    enabled: Boolean(row?.enabled),
    simulatedAt: row?.simulated_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function setSimulatedClock(enabled: boolean, at: string | null) {
  if (!supabase) return;
  const { error } = await supabase.rpc("admin_set_simulated_clock", {
    p_enabled: enabled,
    p_at: enabled ? at : null,
  });
  if (error) throw error;
}

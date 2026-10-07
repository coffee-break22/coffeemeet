import { useEffect, useState } from "react";
import { AlertTriangle, Coffee } from "lucide-react";
import { supabase } from "../../infrastructure/supabase/client.ts";

interface CalendarLink {
  title: string;
  location: string;
  description: string;
  startsAt: string;
  endsAt: string;
}

function toGoogleCalendarDate(iso: string) {
  // Normaliza vía Date para no depender del formato exacto que devuelva
  // PostgREST (a veces "+00:00", a veces "Z") y llegar siempre a
  // YYYYMMDDTHHMMSSZ, que es lo que Google Calendar espera en `dates`.
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function buildGoogleCalendarUrl(link: CalendarLink) {
  const dates = `${toGoogleCalendarDate(link.startsAt)}/${toGoogleCalendarDate(link.endsAt)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: link.title,
    dates,
    details: link.description,
    location: link.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function CalendarRedirect({ code }: { code: string }) {
  const [error, setError] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "get_meeting_calendar_link",
          { p_code: code },
        );
        if (!active) return;
        if (rpcError || !data) {
          setError(true);
          return;
        }
        window.location.replace(buildGoogleCalendarUrl(data as CalendarLink));
      } catch {
        if (active) setError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [code]);

  if (error)
    return (
      <div className="route-loading" role="status">
        <AlertTriangle />
        <span>Este enlace ya no es válido.</span>
      </div>
    );
  return (
    <div className="route-loading" role="status">
      <Coffee />
      <span>Preparando tu calendario…</span>
    </div>
  );
}

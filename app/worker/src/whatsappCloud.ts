// Transporte alternativo por la API oficial de Meta (WhatsApp Business
// Platform / Cloud API), para cuando se reemplace Baileys. Mientras
// WHATSAPP_PROVIDER no sea "cloud", este archivo no se usa — index.ts sigue
// funcionando con Baileys exactamente igual que hasta ahora.
//
// Documentación de referencia: https://developers.facebook.com/docs/whatsapp/cloud-api
import { log } from "./whatsappCommands.js";

const GRAPH_VERSION = "v21.0";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function graphPost(body: Record<string, unknown>) {
  const phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = required("WHATSAPP_ACCESS_TOKEN");
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { message?: string; code?: number };
  };
  if (!res.ok) {
    throw new Error(
      `WHATSAPP_CLOUD_ERROR:${res.status}:${data?.error?.message ?? JSON.stringify(data)}`,
    );
  }
  return data;
}

// E.164 sin "+" ni espacios — es el formato que pide la Cloud API, distinto
// al jid "numero@s.whatsapp.net" que usa Baileys.
export const cloudPhone = (phone: string) => phone.replace(/\D/g, "");

// Respuesta libre (dentro de la ventana de 24h desde el último mensaje del
// usuario, o como respuesta directa a un comando entrante) — mismo uso que
// sock.sendMessage con Baileys.
export async function sendCloudText(to: string, body: string) {
  const data = await graphPost({
    to: cloudPhone(to),
    type: "text",
    text: { body },
  });
  return data.messages?.[0]?.id ?? "";
}

// Mensaje que nosotros iniciamos sin que el usuario haya escrito primero
// (fuera de la ventana de 24h) — Meta exige que sea una plantilla ya
// aprobada. `bodyParams` son los valores en orden para las variables
// {{1}}, {{2}}... del cuerpo de la plantilla.
export async function sendCloudTemplate(
  to: string,
  templateName: string,
  bodyParams: string[],
  languageCode = "es",
) {
  const data = await graphPost({
    to: cloudPhone(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: bodyParams.length
        ? [
            {
              type: "body",
              parameters: bodyParams.map((text) => ({ type: "text", text })),
            },
          ]
        : [],
    },
  });
  return data.messages?.[0]?.id ?? "";
}

// Handshake de verificación que Meta hace una sola vez (GET) al configurar
// la URL del webhook en el panel de desarrolladores — hay que responder
// exactamente el valor de hub.challenge si el token coincide con el que se
// configuró en WHATSAPP_WEBHOOK_VERIFY_TOKEN.
export function verifyWebhookChallenge(
  mode: string | null,
  token: string | null,
  challenge: string | null,
): string | null {
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expected && token === expected)
    return challenge ?? "";
  return null;
}

export interface CloudIncomingMessage {
  from: string;
  text: string;
  id: string;
}
// El mismo webhook también entrega notificaciones de "estado de entrega"
// (enviado/leído) con una forma distinta a los mensajes reales — se ignoran
// acá, solo interesan los mensajes de texto o taps de botón entrantes.
export function parseCloudWebhookMessages(
  body: unknown,
): CloudIncomingMessage[] {
  const out: CloudIncomingMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes ?? [];
    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown[] } })?.value
        ?.messages;
      if (!Array.isArray(messages)) continue;
      for (const raw of messages) {
        const msg = raw as {
          type?: string;
          from?: string;
          id?: string;
          text?: { body?: string };
          interactive?: {
            button_reply?: { id?: string };
            list_reply?: { id?: string };
          };
        };
        if (!msg.from || !msg.id) continue;
        if (msg.type === "text" && msg.text?.body) {
          out.push({ from: msg.from, text: msg.text.body, id: msg.id });
        } else if (msg.type === "interactive") {
          const reply =
            msg.interactive?.button_reply?.id ??
            msg.interactive?.list_reply?.id ??
            "";
          if (reply) out.push({ from: msg.from, text: reply, id: msg.id });
        } else {
          log.info({ type: msg.type }, "unhandled WhatsApp Cloud message type");
        }
      }
    }
  }
  return out;
}

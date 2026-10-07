import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Coffee, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";
type Toast = { id: string; message: string; tone: ToastTone };
type ToastApi = { success: (message: string) => void; error: (message: string) => void; info: (message: string) => void };
const ToastContext = createContext<ToastApi | null>(null);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const show = useCallback((message: string, tone: ToastTone) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4500);
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({ success: (message) => show(message, "success"), error: (message) => show(message, "error"), info: (message) => show(message, "info") }), [show]);
  return <ToastContext.Provider value={api}>{children}<div className="toast-region" aria-live="polite" aria-label="Notificaciones">{toasts.map((toast) => {
    const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? AlertTriangle : Coffee;
    return <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"} key={toast.id}><Icon size={20} aria-hidden="true" /><span>{toast.message}</span><button type="button" onClick={() => dismiss(toast.id)} aria-label="Cerrar notificación"><X size={17} /></button></div>;
  })}</div></ToastContext.Provider>;
}
// oxlint-disable-next-line react/only-export-components -- el hook comparte el contexto privado del proveedor.
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast debe usarse dentro de ToastProvider");
  return context;
}

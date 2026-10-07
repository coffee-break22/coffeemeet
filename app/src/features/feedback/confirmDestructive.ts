import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";

export async function confirmDestructive(opts: {
  title: string;
  text?: string;
  html?: string;
  confirmText: string;
}) {
  const result = await Swal.fire({
    title: opts.title,
    text: opts.text,
    html: opts.html,
    icon: "warning",
    iconHtml:
      '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    showCancelButton: true,
    confirmButtonText: opts.confirmText,
    cancelButtonText: "Cancelar",
    reverseButtons: true,
    focusCancel: true,
    customClass: {
      popup: "cm-swal-popup",
      title: "cm-swal-title",
      htmlContainer: "cm-swal-text",
      confirmButton: "cm-swal-confirm",
      cancelButton: "cm-swal-cancel",
      actions: "cm-swal-actions",
      icon: "cm-swal-icon",
    },
    buttonsStyling: false,
  });
  return result.isConfirmed;
}

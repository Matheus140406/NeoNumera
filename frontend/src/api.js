// Em produção (ex: frontend no Vercel), aponte para o backend real via VITE_API_URL
// (ex: https://neonumera-backend.up.railway.app/api). Em dev local, usa o proxy do Vite.
const BASE = import.meta.env.VITE_API_URL || "/api";

async function handle(res) {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* resposta sem corpo JSON */
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  uploadPlanilha: (file) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${BASE}/upload`, { method: "POST", body: form }).then(handle);
  },
  iniciarDisparo: (mensagem, cadencia, dryRun) =>
    fetch(`${BASE}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensagem, cadencia, dry_run: dryRun }),
    }).then(handle),
  obterFila: () => fetch(`${BASE}/queue`).then(handle),
  reenviar: (id) => fetch(`${BASE}/queue/${id}/resend`, { method: "POST" }).then(handle),
  remover: (id) => fetch(`${BASE}/queue/${id}`, { method: "DELETE" }).then(handle),
  analytics: () => fetch(`${BASE}/analytics`).then(handle),
  status: () => fetch(`${BASE}/status`).then(handle),
  iniciarLogin: () => fetch(`${BASE}/login/start`, { method: "POST" }).then(handle),
  obterQr: () => fetch(`${BASE}/login/qr`).then(handle),
  cancelarLogin: () => fetch(`${BASE}/login/cancel`, { method: "POST" }).then(handle),
};

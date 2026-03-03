// Plugin analytics — routed through local proxy to avoid CORS
// GA4 Measurement Protocol via proxy /analytics endpoint
const PROXY = "http://127.0.0.1:3001";

function send(name: string, params?: Record<string, string | number | boolean>) {
  fetch(`${PROXY}/analytics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, params }),
  }).catch(() => {});
}

export const analytics = {
  chatSend: (mode: string, model: string) =>
    send("chat_send", { mode, model }),
  modeChange: (from: string, to: string) =>
    send("mode_change", { from, to }),
  agentCreate: () => send("agent_create"),
  codeExecute: (success: boolean) => send("code_execute", { success }),
  updateClick: (can_self_update: boolean) =>
    send("update_click", { can_self_update }),
  updateComplete: () => send("update_complete"),
  updateError: (reason: string) => send("update_error", { reason }),
  panelOpen: () => send("panel_open"),
};

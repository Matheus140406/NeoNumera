import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle, Send, BarChart3, ListFilter, Search, Command,
  UploadCloud, RefreshCw, Download, Eye, EyeOff, Menu, X,
  Reply, AlertTriangle, Clock, CheckCircle2,
} from "lucide-react";
import { api } from "./api.js";

/* Classe utilitária de foco acessível, reaproveitada nos controles interativos */
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";
const PRESS = "active:scale-[0.97]";

/* ---------------------------------------------------------------
   Design tokens — dark only (zinc-950 = #09090B). Sem sombra
   pesada, sem gradiente neon; a "vida" vem de cor de status + motion.
--------------------------------------------------------------- */
const t = {
  bg: "bg-zinc-950",
  surface: "bg-zinc-900",
  surfaceAlt: "bg-zinc-900/60",
  border: "border-zinc-800",
  textPrimary: "text-zinc-100",
  textSecondary: "text-zinc-400",
  textFaint: "text-zinc-600",
  accentBg: "bg-zinc-100",
  accentText: "text-zinc-900",
  hover: "hover:bg-zinc-800/60",
};

const NAV = [
  { id: "dispatch", label: "Disparo", icon: Send, key: "1" },
  { id: "analytics", label: "Métricas", icon: BarChart3, key: "2" },
  { id: "queue", label: "Fila", icon: ListFilter, key: "3" },
];

const STATUS_META = {
  delivered: { label: "Entregue", color: "text-emerald-400", dot: "bg-emerald-500", tint: "bg-emerald-500/[0.04]", edge: "border-l-emerald-500/50" },
  pending: { label: "Pendente", color: "text-amber-400", dot: "bg-amber-500", tint: "bg-amber-500/[0.04]", edge: "border-l-amber-500/50" },
  error: { label: "Erro", color: "text-red-400", dot: "bg-red-500", tint: "bg-red-500/[0.05]", edge: "border-l-red-500/60" },
  queued: { label: "Na fila", color: "text-zinc-400", dot: "bg-zinc-500", tint: "", edge: "border-l-transparent" },
};

const FILTERS = [
  { id: "todos", label: "Todos" },
  { id: "delivered", label: "Entregues" },
  { id: "replied", label: "Responderam" },
  { id: "error", label: "Erros" },
];

function maskPhone(phone, masked) {
  const str = String(phone);
  if (!masked) return str;
  return str.slice(0, 4) + "*****" + str.slice(-2);
}

/* ---------------------------------------------------------------
   Componentes atômicos
--------------------------------------------------------------- */
function StatusDot({ status }) {
  const meta = STATUS_META[status] || STATUS_META.queued;
  const alive = status === "pending" || status === "queued";
  return (
    <span className="relative inline-flex w-1.5 h-1.5">
      {alive && <span className={`absolute inline-flex h-full w-full rounded-full ${meta.dot} opacity-60 animate-ping`} />}
      <span className={`relative inline-block w-1.5 h-1.5 rounded-full ${meta.dot}`} />
    </span>
  );
}

function KPICard({ label, value, sub, accent }) {
  return (
    <div className={`${t.surface} border ${t.border} rounded-md p-4 flex flex-col gap-1 transition-colors hover:border-zinc-700`}>
      <span className={`text-xs ${t.textSecondary}`}>{label}</span>
      <span className={`text-2xl font-semibold tracking-tight ${accent || t.textPrimary}`}>{value}</span>
      {sub && <span className={`text-xs ${t.textFaint}`}>{sub}</span>}
    </div>
  );
}

function Skeleton({ className }) {
  return <div className={`animate-pulse rounded ${t.surfaceAlt} ${className}`} />;
}

function BarChart({ data }) {
  const max = Math.max(1, ...data);
  return (
    <svg viewBox="0 0 480 120" className="w-full h-32">
      {data.map((v, i) => {
        const h = (v / max) * 96;
        return (
          <rect
            key={i}
            x={i * 20 + 4}
            y={112 - h}
            width={12}
            height={h}
            rx={2}
            className="fill-emerald-400"
            opacity={0.2 + (v / max) * 0.8}
            style={{
              transformOrigin: `${i * 20 + 10}px 112px`,
              animation: `nn-grow 0.5s ease both`,
              animationDelay: `${i * 18}ms`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes nn-grow {
          from { transform: scaleY(0); }
          to { transform: scaleY(1); }
        }
      `}</style>
    </svg>
  );
}

function TopProgressBar({ active }) {
  if (!active) return null;
  return (
    <div className="h-[2px] w-full bg-zinc-900 overflow-hidden">
      <div className="h-full bg-emerald-400" style={{ animation: "nn-progress 0.6s ease-in-out infinite" }} />
      <style>{`
        @keyframes nn-progress {
          0% { transform: translateX(-100%) scaleX(0.4); }
          50% { transform: translateX(20%) scaleX(0.6); }
          100% { transform: translateX(100%) scaleX(0.4); }
        }
      `}</style>
    </div>
  );
}

function ToastStack({ toasts }) {
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((tst) => (
        <div
          key={tst.id}
          className={`${t.surface} border ${t.border} rounded-md pl-2.5 pr-3.5 py-2 flex items-center gap-2 text-xs ${t.textPrimary} shadow-[0_1px_0_0_rgba(255,255,255,0.03)]`}
          style={{ animation: "nn-toastIn 0.25s ease both" }}
        >
          {tst.error ? (
            <AlertTriangle size={14} className="text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
          )}
          {tst.text}
        </div>
      ))}
      <style>{`
        @keyframes nn-toastIn {
          from { opacity: 0; transform: translateY(6px) scale(0.98); }
          to { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}

/* ---------------------------------------------------------------
   Command Palette
--------------------------------------------------------------- */
function CommandPalette({ open, onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  if (!open) return null;
  const filtered = NAV.filter((n) => n.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/50" onClick={onClose}>
      <div className={`${t.surface} border ${t.border} rounded-lg w-full max-w-md overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${t.border}`}>
          <Search size={15} className={t.textFaint} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar telas..."
            className={`flex-1 bg-transparent outline-none text-sm ${t.textPrimary}`}
            aria-label="Buscar telas ou comandos"
          />
          <kbd className={`text-[10px] ${t.textFaint} border ${t.border} rounded px-1 py-0.5`}>ESC</kbd>
        </div>
        <div className="py-1">
          {filtered.map((n) => (
            <button
              key={n.id}
              onClick={() => { onNavigate(n.id); onClose(); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm ${t.textSecondary} ${t.hover} transition-colors ${FOCUS_RING}`}
            >
              <n.icon size={15} />
              <span className="flex-1 text-left">{n.label}</span>
              <kbd className={`text-[10px] ${t.textFaint}`}>{n.key}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Sidebar
--------------------------------------------------------------- */
function Sidebar({ view, onNavigate, collapsed, onToggle }) {
  return (
    <aside className={`${t.surface} border-r ${t.border} flex flex-col shrink-0 transition-all duration-200 ${collapsed ? "w-14" : "w-56"}`}>
      <div className={`flex items-center gap-2 px-3 h-12 border-b ${t.border}`}>
        <div className="w-5 h-5 rounded-sm bg-emerald-400 shrink-0" />
        {!collapsed && <span className={`text-sm font-semibold tracking-tight ${t.textPrimary}`}>NeoNumera</span>}
      </div>

      <nav className="flex-1 py-2 px-2 space-y-0.5">
        {NAV.map((n) => {
          const active = view === n.id;
          return (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              title={n.label}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-all relative ${PRESS} ${FOCUS_RING} ${
                active ? `${t.textPrimary} ${t.surfaceAlt}` : `${t.textSecondary} ${t.hover}`
              }`}
            >
              {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-emerald-400" />}
              <n.icon size={16} className="shrink-0" />
              {!collapsed && <span className="flex-1 text-left truncate">{n.label}</span>}
              {!collapsed && <kbd className={`text-[10px] ${t.textFaint}`}>{n.key}</kbd>}
            </button>
          );
        })}
      </nav>

      <div className={`p-2 border-t ${t.border}`}>
        <button onClick={onToggle} className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm ${t.textSecondary} ${t.hover} transition-colors`}>
          <Menu size={16} />
          {!collapsed && <span>Recolher</span>}
        </button>
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------
   Topbar
--------------------------------------------------------------- */
function Topbar({ title, onOpenPalette }) {
  return (
    <header className={`h-12 border-b ${t.border} flex items-center justify-between px-4 shrink-0`}>
      <h1 className={`text-sm font-medium ${t.textPrimary}`}>{title}</h1>
      <button
        onClick={onOpenPalette}
        className={`flex items-center gap-2 text-xs ${t.textFaint} border ${t.border} rounded-md px-2.5 py-1.5 ${t.hover} transition-all ${PRESS} ${FOCUS_RING}`}
      >
        <Search size={13} />
        <span>Buscar</span>
        <kbd className="flex items-center gap-0.5 ml-1"><Command size={10} />K</kbd>
      </button>
    </header>
  );
}

/* ---------------------------------------------------------------
   View: Disparo
--------------------------------------------------------------- */
function DispatchConsole({ message, setMessage, cadence, setCadence, dryRun, setDryRun, pushToast, whatsappConectado }) {
  const [dragOver, setDragOver] = useState(false);
  const [mapeamento, setMapeamento] = useState(null);
  const [resumoContatos, setResumoContatos] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const fileInputRef = useRef(null);
  const pulseCount = 5;
  const speed = 1.4 - (cadence / 100) * 1.1;
  const insertVar = (v) => setMessage((m) => `${m} {${v}}`);

  const processarArquivo = async (file) => {
    if (!file) return;
    try {
      const resultado = await api.uploadPlanilha(file);
      setMapeamento(resultado.mapeamento);
      setResumoContatos({ total: resultado.total, validos: resultado.validos, invalidos: resultado.invalidos });
      pushToast(`Planilha carregada: ${resultado.total} contatos (${resultado.validos} válidos)`);
    } catch (err) {
      pushToast(err.message || "Falha ao ler a planilha", true);
    }
  };

  const iniciar = async () => {
    setEnviando(true);
    try {
      const resposta = await api.iniciarDisparo(message, cadence, dryRun);
      pushToast(
        dryRun
          ? `Simulação iniciada — ${resposta.total} contatos`
          : `Disparo iniciado — ${resposta.total} contatos`
      );
    } catch (err) {
      pushToast(err.message || "Falha ao iniciar disparo", true);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-5">
      <div className="lg:col-span-2 space-y-4">
        <div className={`${t.surface} border ${t.border} rounded-md px-3 py-2 inline-flex items-center gap-2`}>
          <MessageCircle size={14} className="text-emerald-400" />
          <span className={`text-xs ${t.textSecondary}`}>
            {whatsappConectado ? "WhatsApp conectado" : "WhatsApp sem sessão (rode --login)"}
          </span>
          <StatusDot status={whatsappConectado ? "delivered" : "error"} />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => processarArquivo(e.target.files?.[0])}
        />
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); processarArquivo(e.dataTransfer.files?.[0]); }}
          className={`${t.surface} border border-dashed ${dragOver ? "border-emerald-500/60" : t.border} rounded-md p-8 flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer`}
        >
          <UploadCloud size={20} className={t.textFaint} />
          <p className={`text-sm ${t.textSecondary}`}>Arraste uma planilha .xlsx ou .csv</p>
          <p className={`text-xs ${t.textFaint}`}>Colunas mapeadas automaticamente após o upload</p>
        </div>

        {mapeamento && (
          <div className={`${t.surface} border ${t.border} rounded-md overflow-hidden`}>
            <div className={`px-3 py-2 border-b ${t.border} text-xs ${t.textSecondary}`}>Preview do mapeamento de colunas</div>
            <table className="w-full text-xs">
              <thead>
                <tr className={`text-left ${t.textFaint} border-b ${t.border}`}>
                  <th className="px-3 py-1.5 font-normal">Coluna original</th>
                  <th className="px-3 py-1.5 font-normal">Campo detectado</th>
                </tr>
              </thead>
              <tbody className={t.textSecondary}>
                {mapeamento.map((m) => (
                  <tr key={m.original} className={`border-b ${t.border} last:border-0`}>
                    <td className="px-3 py-1.5">{m.original}</td>
                    <td className="px-3 py-1.5">{m.campo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className={`${t.surface} border ${t.border} rounded-md`}>
          <div className={`flex items-center justify-between px-3 py-2 border-b ${t.border}`}>
            <span className={`text-xs ${t.textSecondary}`}>Editor de mensagem</span>
            <div className="flex gap-1">
              {["nome", "codigo", "vencimento"].map((v) => (
                <button key={v} onClick={() => insertVar(v)} className={`text-[11px] px-1.5 py-0.5 rounded border ${t.border} ${t.textFaint} ${t.hover} transition-colors`}>
                  {`{${v}}`}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className={`w-full px-3 py-2.5 text-sm bg-transparent outline-none resize-none ${t.textPrimary} ${FOCUS_RING}`}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className={`${t.surface} border ${t.border} rounded-md p-4 space-y-3`}>
          <span className={`text-xs ${t.textSecondary}`}>Cadência de disparo</span>
          <input type="range" min={0} max={100} value={cadence} onChange={(e) => setCadence(Number(e.target.value))} className="w-full accent-emerald-500" />
          <div className={`flex justify-between text-[11px] ${t.textFaint}`}>
            <span>Conservador</span>
            <span>Expresso</span>
          </div>
          <div className={`flex items-center gap-2 pt-2 border-t ${t.border}`}>
            {Array.from({ length: pulseCount }).map((_, i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                style={{ animation: `nn-pulse ${speed}s ease-in-out ${(i * speed) / pulseCount}s infinite`, opacity: 0.25 }}
              />
            ))}
            <span className={`text-[11px] ${t.textFaint} ml-1`}>{speed.toFixed(1)}s / msg</span>
          </div>
        </div>

        <div className={`${t.surface} border ${t.border} rounded-md p-4 space-y-3`}>
          <label className="flex items-center justify-between text-xs">
            <span className={t.textSecondary}>Modo dry-run (simulação)</span>
            <button
              onClick={() => setDryRun(!dryRun)}
              className={`w-8 rounded-full transition-all relative border ${t.border} ${dryRun ? "bg-emerald-500" : t.surfaceAlt} ${PRESS} ${FOCUS_RING}`}
              style={{ height: 18 }}
            >
              <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-all bg-white ${dryRun ? "right-0.5" : "left-0.5"}`} />
            </button>
          </label>
          <button
            onClick={iniciar}
            disabled={enviando || !resumoContatos}
            className={`w-full text-sm font-medium rounded-md py-2 bg-emerald-500 text-zinc-950 transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${PRESS} ${FOCUS_RING}`}
          >
            {enviando ? "Iniciando..." : dryRun ? "Simular envio" : "Iniciar disparo"}
          </button>
          <p className={`text-[11px] ${t.textFaint}`}>
            {resumoContatos
              ? `${resumoContatos.validos} contatos válidos · ${resumoContatos.invalidos} inválidos`
              : "Faça upload de uma planilha para começar"}
          </p>
        </div>
      </div>

      <style>{`
        @keyframes nn-pulse {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}

/* ---------------------------------------------------------------
   View: Métricas
--------------------------------------------------------------- */
function AnalyticsView({ whatsappConectado }) {
  const [dados, setDados] = useState(null);

  const carregar = useCallback(() => {
    api.analytics().then(setDados).catch(() => {});
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, 4000);
    return () => clearInterval(id);
  }, [carregar]);

  if (!dados) {
    return (
      <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        <Skeleton className="h-40 col-span-full" />
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Total processados" value={dados.total_enviados} sub="nesta sessão" />
        <KPICard label="Taxa de entrega" value={`${dados.taxa_entrega}%`} accent="text-emerald-400" />
        <KPICard label="Taxa de erro" value={`${dados.taxa_erro}%`} accent="text-red-400" />
        <KPICard label="Disparo em andamento" value={dados.job.running ? "Sim" : "Não"} sub={`${dados.job.enviados}/${dados.job.total}`} />
      </div>

      <div className={`${t.surface} border ${t.border} rounded-md p-4`}>
        <div className="flex items-center justify-between mb-3">
          <span className={`text-xs ${t.textSecondary}`}>Volume por hora</span>
          <span className={`text-xs ${t.textFaint}`}>sessão atual</span>
        </div>
        <BarChart data={dados.volume_por_hora} />
      </div>

      <div className={`${t.surface} border ${t.border} rounded-md`}>
        <div className={`px-4 py-2.5 border-b ${t.border} text-xs ${t.textSecondary}`}>Conexão do WhatsApp</div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <StatusDot status={whatsappConectado ? "delivered" : "error"} />
            <span className={`text-sm ${t.textPrimary}`}>{whatsappConectado ? "Sessão ativa" : "Sem sessão logada"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   View: Fila — respostas, motivo de erro, mais viva
--------------------------------------------------------------- */
function QueueTable({ pushToast }) {
  const [maskPII, setMaskPII] = useState(true);
  const [filter, setFilter] = useState("todos");
  const [rowsData, setRowsData] = useState([]);

  const carregar = useCallback(() => {
    api.obterFila().then((r) => setRowsData(r.items)).catch(() => {});
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, 3000);
    return () => clearInterval(id);
  }, [carregar]);

  const counts = {
    todos: rowsData.length,
    delivered: rowsData.filter((r) => r.status === "delivered").length,
    replied: rowsData.filter((r) => !!r.reply).length,
    error: rowsData.filter((r) => r.status === "error").length,
  };

  const rows = rowsData.filter((r) => {
    if (filter === "todos") return true;
    if (filter === "replied") return !!r.reply;
    return r.status === filter;
  });

  const reenviar = async (item) => {
    try {
      await api.reenviar(item.id);
      pushToast(`Reenviado para ${item.name.split(" ")[0]}`);
      carregar();
    } catch (err) {
      pushToast(err.message || "Falha ao reenviar", true);
    }
  };

  const remover = async (item) => {
    try {
      await api.remover(item.id);
      pushToast(`${item.name.split(" ")[0]} removido da fila`);
      carregar();
    } catch (err) {
      pushToast(err.message || "Falha ao remover", true);
    }
  };

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className={`${t.surface} border ${t.border} rounded-md p-1 inline-flex gap-1`}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-all ${PRESS} ${FOCUS_RING} ${
                filter === f.id ? "bg-emerald-500 text-zinc-950" : `${t.textSecondary} ${t.hover}`
              }`}
            >
              {f.label}
              <span className={`text-[10px] ${filter === f.id ? "text-zinc-900/70" : t.textFaint}`}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setMaskPII(!maskPII)}
          className={`flex items-center gap-1.5 text-xs ${t.textFaint} border ${t.border} rounded-md px-2.5 py-1.5 ${t.hover} transition-all ${PRESS} ${FOCUS_RING}`}
        >
          {maskPII ? <Eye size={13} /> : <EyeOff size={13} />}
          {maskPII ? "Revelar números" : "Mascarar números"}
        </button>
      </div>

      <div className={`${t.surface} border ${t.border} rounded-md overflow-hidden`}>
        <table className="w-full text-xs">
          <thead>
            <tr className={`text-left ${t.textFaint} border-b ${t.border}`}>
              <th className="px-4 py-2 font-normal">Contato</th>
              <th className="px-4 py-2 font-normal">Status</th>
              <th className="px-4 py-2 font-normal">Resposta</th>
              <th className="px-4 py-2 font-normal">Horário</th>
              <th className="px-4 py-2 font-normal text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const meta = STATUS_META[r.status] || STATUS_META.queued;
              return (
                <tr
                  key={r.id}
                  className={`border-b ${t.border} last:border-0 ${t.hover} transition-colors border-l-2 ${meta.edge} ${meta.tint}`}
                  style={{ animation: "nn-rowIn 0.35s ease both", animationDelay: `${i * 35}ms` }}
                >
                  <td className="px-4 py-2.5">
                    <p className={t.textPrimary}>{r.name}</p>
                    <p className={`font-mono ${t.textFaint}`}>{maskPhone(r.phone, maskPII)}</p>
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <span className={`flex items-center gap-1.5 ${meta.color}`}>
                      <StatusDot status={r.status} /> {meta.label}
                    </span>
                    {r.status === "error" && (
                      <span className="flex items-start gap-1 text-[11px] text-red-400/80 mt-1 max-w-[180px]">
                        <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                        {r.errorReason}
                      </span>
                    )}
                    {r.status === "pending" && (
                      <span className={`flex items-center gap-1 text-[11px] ${t.textFaint} mt-1`}>
                        <Clock size={11} /> aguardando confirmação
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 max-w-[220px]">
                    {r.reply ? (
                      <span className={`flex items-start gap-1.5 ${t.textSecondary} italic`}>
                        <Reply size={12} className="shrink-0 mt-0.5 text-emerald-400" />
                        <span className="truncate">"{r.reply}"</span>
                      </span>
                    ) : (
                      <span className={t.textFaint}>{r.status === "delivered" ? "sem resposta ainda" : "—"}</span>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 ${t.textFaint}`}>{r.time}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => reenviar(r)}
                        className={`p-1.5 rounded ${t.hover} transition-all ${PRESS} ${FOCUS_RING}`}
                        title="Reenviar"
                      >
                        <RefreshCw size={13} className={t.textFaint} />
                      </button>
                      <button
                        onClick={() => pushToast("Erro exportado para CSV")}
                        className={`p-1.5 rounded ${t.hover} transition-all ${PRESS} ${FOCUS_RING}`}
                        title="Exportar erro"
                      >
                        <Download size={13} className={t.textFaint} />
                      </button>
                      <button
                        onClick={() => remover(r)}
                        className={`p-1.5 rounded ${t.hover} transition-all ${PRESS} ${FOCUS_RING}`}
                        title="Remover da fila"
                      >
                        <X size={13} className={t.textFaint} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={`px-4 py-8 text-center ${t.textFaint}`}>Nenhum contato nesse filtro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <style>{`
        @keyframes nn-rowIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}

/* ---------------------------------------------------------------
   App raiz
--------------------------------------------------------------- */
export default function NeoNumeraApp() {
  const [view, setView] = useState("dispatch");
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [whatsappConectado, setWhatsappConectado] = useState(false);

  const [message, setMessage] = useState("Olá {nome}, seu código de acesso é {codigo}.");
  const [cadence, setCadence] = useState(50);
  const [dryRun, setDryRun] = useState(true);
  const [toasts, setToasts] = useState([]);

  const pushToast = (text, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, error }]);
    setTimeout(() => setToasts((prev) => prev.filter((tst) => tst.id !== id)), 2600);
  };

  useEffect(() => {
    const carregarStatus = () => api.status().then((r) => setWhatsappConectado(r.conectado)).catch(() => {});
    carregarStatus();
    const id = setInterval(carregarStatus, 8000);
    return () => clearInterval(id);
  }, []);

  const navigate = (id) => {
    if (id === view) return;
    setLoading(true);
    setView(id);
    setTimeout(() => setLoading(false), 300);
  };

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((p) => !p);
        return;
      }
      if (e.key === "Escape") setPaletteOpen(false);
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const found = NAV.find((n) => n.key === e.key);
      if (found) navigate(found.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const title = NAV.find((n) => n.id === view)?.label ?? "";

  return (
    <div className={`flex h-screen w-full ${t.bg} font-sans text-sm`}>
      <Sidebar view={view} onNavigate={navigate} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title={title} onOpenPalette={() => setPaletteOpen(true)} />
        <TopProgressBar active={loading} />

        <main className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
              <Skeleton className="h-40 col-span-full" />
            </div>
          ) : (
            <>
              {view === "dispatch" && (
                <DispatchConsole
                  message={message}
                  setMessage={setMessage}
                  cadence={cadence}
                  setCadence={setCadence}
                  dryRun={dryRun}
                  setDryRun={setDryRun}
                  pushToast={pushToast}
                  whatsappConectado={whatsappConectado}
                />
              )}
              {view === "analytics" && <AnalyticsView whatsappConectado={whatsappConectado} />}
              {view === "queue" && <QueueTable pushToast={pushToast} />}
            </>
          )}
        </main>

        <footer className={`h-8 border-t ${t.border} flex items-center px-4 text-[11px] ${t.textFaint} shrink-0`}>
          Pressione 1–3 para navegar · ⌘K para comandos
        </footer>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={navigate} />
      <ToastStack toasts={toasts} />
    </div>
  );
}

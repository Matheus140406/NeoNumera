"""API HTTP para o painel web do NeoNumera.

Expõe como serviço a mesma lógica usada pelo `main.py` (CLI): upload de
planilha, disparo em background, fila de status e métricas agregadas.
Estado mantido em memória — processo único, sem persistência entre reinícios.
"""

import threading
import time
import uuid
from collections import Counter
from datetime import datetime

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from main import carregar_contatos
from whatsapp_client import WhatsAppClient, sanitize_phone

app = FastAPI(title="NeoNumera API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSION_DIR = "wa_session"

COLUNA_NOME_CANDIDATOS = ["nome", "name", "cliente", "contato"]
COLUNA_TELEFONE_CANDIDATOS = ["telefone", "celular", "whatsapp", "phone", "fone", "numero", "número"]

lock = threading.Lock()
state = {
    "contatos": [],
    "queue": [],
    "job": {"running": False, "dry_run": True, "total": 0, "enviados": 0},
}


def detectar_coluna(colunas, candidatos):
    for coluna in colunas:
        chave = coluna.strip().lower()
        if any(candidato in chave for candidato in candidatos):
            return coluna
    return None


class DispatchRequest(BaseModel):
    mensagem: str
    cadencia: int = 50
    dry_run: bool = True


@app.post("/api/upload")
async def upload_planilha(file: UploadFile = File(...)):
    extensao = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if extensao not in (".xlsx", ".xls", ".csv"):
        raise HTTPException(400, "Formato não suportado. Envie .xlsx, .xls ou .csv")

    conteudo = await file.read()
    caminho_temp = f"/tmp/{uuid.uuid4().hex}{extensao}"
    with open(caminho_temp, "wb") as f:
        f.write(conteudo)

    if extensao == ".csv":
        df_preview = pd.read_csv(caminho_temp)
    else:
        df_preview = pd.read_excel(caminho_temp)

    col_nome = detectar_coluna(df_preview.columns, COLUNA_NOME_CANDIDATOS)
    col_telefone = detectar_coluna(df_preview.columns, COLUNA_TELEFONE_CANDIDATOS)
    if not col_nome or not col_telefone:
        raise HTTPException(
            422,
            f"Não foi possível detectar as colunas de nome/telefone. "
            f"Colunas encontradas: {', '.join(df_preview.columns)}",
        )

    contatos = carregar_contatos(caminho_temp, col_nome, col_telefone)
    validos, invalidos = 0, 0
    for contato in contatos:
        if sanitize_phone(contato["telefone"]):
            validos += 1
        else:
            invalidos += 1

    with lock:
        state["contatos"] = contatos

    return {
        "mapeamento": [{"original": col_nome, "campo": "nome"}, {"original": col_telefone, "campo": "telefone"}],
        "total": len(contatos),
        "validos": validos,
        "invalidos": invalidos,
    }


def _cadencia_para_delay(cadencia, dry_run):
    cadencia = max(0, min(100, cadencia))
    delay = 300 - (cadencia / 100) * 240  # 60s (expresso) .. 300s (conservador)
    if dry_run:
        return min(delay, 1.5)
    return delay


def _executar_disparo(fila_ids, mensagem, cadencia, dry_run):
    cliente = None
    try:
        if not dry_run:
            cliente = WhatsAppClient(session_dir=SESSION_DIR, headless=True)
            cliente.start()

        for item_id, nome, telefone_original in fila_ids:
            telefone = sanitize_phone(telefone_original)
            agora = datetime.now().strftime("%H:%M")

            if telefone is None:
                resultado = {"status": "error", "errorReason": "Número inválido"}
            elif dry_run:
                resultado = {"status": "delivered", "reply": None}
            else:
                texto = mensagem.replace("{nome}", nome)
                status, detalhe = cliente.send_message(telefone, texto)
                if status == "ENVIADO":
                    resultado = {"status": "delivered"}
                elif status == "SEM_WHATSAPP":
                    resultado = {"status": "error", "errorReason": "Número não está no WhatsApp"}
                else:
                    resultado = {"status": "error", "errorReason": detalhe or "Falha no envio"}

            with lock:
                for item in state["queue"]:
                    if item["id"] == item_id:
                        item.update(resultado)
                        item["time"] = agora
                        break
                state["job"]["enviados"] += 1

            time.sleep(_cadencia_para_delay(cadencia, dry_run))
    finally:
        if cliente:
            cliente.close()
        with lock:
            state["job"]["running"] = False


@app.post("/api/dispatch")
def iniciar_disparo(req: DispatchRequest):
    with lock:
        if state["job"]["running"]:
            raise HTTPException(409, "Já existe um disparo em andamento")
        if not state["contatos"]:
            raise HTTPException(400, "Nenhuma planilha carregada. Faça upload primeiro em /api/upload")

        fila = [
            {
                "id": i + 1,
                "name": c["nome"],
                "phone_original": c["telefone"],
                "phone": sanitize_phone(c["telefone"]) or str(c["telefone"]),
                "status": "queued",
                "time": "",
                "reply": None,
                "errorReason": None,
            }
            for i, c in enumerate(state["contatos"])
        ]
        state["queue"] = fila
        state["job"] = {
            "running": True,
            "dry_run": req.dry_run,
            "total": len(fila),
            "enviados": 0,
        }
        fila_ids = [(item["id"], item["name"], item["phone_original"]) for item in fila]

    thread = threading.Thread(
        target=_executar_disparo, args=(fila_ids, req.mensagem, req.cadencia, req.dry_run), daemon=True
    )
    thread.start()
    return {"started": True, "total": len(fila_ids), "dry_run": req.dry_run}


@app.get("/api/queue")
def obter_fila():
    with lock:
        return {"items": state["queue"], "job": state["job"]}


@app.post("/api/queue/{item_id}/resend")
def reenviar(item_id: int):
    with lock:
        for item in state["queue"]:
            if item["id"] == item_id:
                item["status"] = "queued"
                item["errorReason"] = None
                return {"ok": True}
    raise HTTPException(404, "Contato não encontrado na fila")


@app.delete("/api/queue/{item_id}")
def remover(item_id: int):
    with lock:
        antes = len(state["queue"])
        state["queue"] = [item for item in state["queue"] if item["id"] != item_id]
        if len(state["queue"]) == antes:
            raise HTTPException(404, "Contato não encontrado na fila")
    return {"ok": True}


@app.get("/api/analytics")
def analytics():
    with lock:
        queue = list(state["queue"])
        job = dict(state["job"])

    total = len(queue) or job.get("total", 0)
    entregues = sum(1 for i in queue if i["status"] == "delivered")
    erros = sum(1 for i in queue if i["status"] == "error")
    processados = entregues + erros

    taxa_entrega = (entregues / processados * 100) if processados else 0.0
    taxa_erro = (erros / processados * 100) if processados else 0.0

    horas = Counter()
    for item in queue:
        if item.get("time"):
            horas[item["time"][:2]] += 1
    volume_por_hora = [horas.get(f"{h:02d}", 0) for h in range(24)]

    return {
        "total_enviados": processados,
        "taxa_entrega": round(taxa_entrega, 1),
        "taxa_erro": round(taxa_erro, 1),
        "volume_por_hora": volume_por_hora,
        "job": job,
    }


@app.get("/api/status")
def status_whatsapp():
    import os

    conectado = os.path.isdir(SESSION_DIR)
    return {"conectado": conectado, "sessao": SESSION_DIR}

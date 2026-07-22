"""API HTTP para o painel web do NeoNumera.

Expõe como serviço a mesma lógica usada pelo `main.py` (CLI): upload de
planilha, disparo em background, fila de status e métricas agregadas.
Estado mantido em memória — processo único, sem persistência entre reinícios.
"""

import base64
import os
import threading
import time
import uuid
from collections import Counter
from datetime import datetime

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from whatsapp_client import WhatsAppClient, sanitize_phone

app = FastAPI(title="NeoNumera API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSION_DIR = os.environ.get("WA_SESSION_DIR", "wa_session")

COLUNA_NOME_CANDIDATOS = ["nome", "name", "cliente", "contato"]
COLUNA_TELEFONE_CANDIDATOS = ["telefone", "celular", "whatsapp", "phone", "fone", "numero", "número"]

lock = threading.Lock()
state = {
    "contatos": [],
    "queue": [],
    "job": {"running": False, "dry_run": True, "total": 0, "enviados": 0},
}

login_lock = threading.Lock()
login_state = {"client": None, "logado": False}


def detectar_coluna(colunas, candidatos):
    for coluna in colunas:
        chave = str(coluna).strip().lower()
        if any(candidato in chave for candidato in candidatos):
            return coluna
    return None


def ler_planilha(caminho, extensao, header=0):
    if extensao == ".csv":
        return pd.read_csv(caminho, header=header)
    return pd.read_excel(caminho, header=header)


def montar_contatos(df, col_nome, col_telefone):
    contatos = []
    for _, linha in df.iterrows():
        telefone = linha[col_telefone]
        if col_nome is not None and not pd.isna(linha[col_nome]):
            nome = str(linha[col_nome]).strip()
        else:
            nome = str(telefone).strip()
        contatos.append({"nome": nome, "telefone": telefone})
    return contatos


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

    df = ler_planilha(caminho_temp, extensao)
    col_nome = detectar_coluna(df.columns, COLUNA_NOME_CANDIDATOS)
    col_telefone = detectar_coluna(df.columns, COLUNA_TELEFONE_CANDIDATOS)

    if not col_telefone:
        # Planilha sem cabeçalho: o primeiro número virou nome de coluna por engano.
        if sanitize_phone(df.columns[0]) or len(df.columns) == 1:
            df = ler_planilha(caminho_temp, extensao, header=None)
            col_telefone = df.columns[0]
            col_nome = None
        else:
            raise HTTPException(
                422,
                f"Não foi possível detectar a coluna de telefone. "
                f"Colunas encontradas: {', '.join(str(c) for c in df.columns)}",
            )

    contatos = montar_contatos(df, col_nome, col_telefone)
    validos, invalidos = 0, 0
    for contato in contatos:
        if sanitize_phone(contato["telefone"]):
            validos += 1
        else:
            invalidos += 1

    with lock:
        state["contatos"] = contatos

    mapeamento = [{"original": str(col_telefone), "campo": "telefone"}]
    if col_nome is not None:
        mapeamento.insert(0, {"original": str(col_nome), "campo": "nome"})

    return {
        "mapeamento": mapeamento,
        "total": len(contatos),
        "validos": validos,
        "invalidos": invalidos,
        "aviso": None if col_nome else "Planilha sem coluna de nome — o telefone será usado como identificação.",
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
        if not req.dry_run and login_state["client"] is not None:
            raise HTTPException(409, "Existe um login de WhatsApp em andamento. Finalize-o antes de disparar.")

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
    with login_lock:
        if login_state["logado"]:
            return {"conectado": True, "sessao": SESSION_DIR}

    conectado = os.path.isdir(SESSION_DIR) and login_state["client"] is None
    return {"conectado": conectado, "sessao": SESSION_DIR}


@app.post("/api/login/start")
def iniciar_login():
    with login_lock:
        if login_state["client"] is not None:
            return {"ja_iniciado": True}
        if state["job"]["running"]:
            raise HTTPException(409, "Não é possível logar com um disparo em andamento")

        cliente = WhatsAppClient(session_dir=SESSION_DIR, headless=True)
        cliente.start()
        cliente.abrir_pagina_login()
        login_state["client"] = cliente
        login_state["logado"] = False
    return {"started": True}


@app.get("/api/login/qr")
def obter_qr():
    with login_lock:
        cliente = login_state["client"]
        if cliente is None:
            raise HTTPException(400, "Login não iniciado. Chame /api/login/start primeiro.")

        if cliente.esta_logado():
            login_state["logado"] = True
            cliente.close()
            login_state["client"] = None
            return {"logado": True, "qr_base64": None}

        png = cliente.screenshot_png()
        return {"logado": False, "qr_base64": base64.b64encode(png).decode()}


@app.post("/api/login/cancel")
def cancelar_login():
    with login_lock:
        if login_state["client"] is not None:
            login_state["client"].close()
            login_state["client"] = None
        login_state["logado"] = False
    return {"ok": True}

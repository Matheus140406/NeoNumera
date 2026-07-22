#!/usr/bin/env python3
"""Disparador de mensagens em massa via WhatsApp Web (Playwright)."""

import argparse
import csv
import os
import random
import sys
import time
from datetime import datetime

import pandas as pd

from whatsapp_client import (
    WhatsAppClient,
    dentro_do_horario_comercial,
    parse_hora,
    sanitize_phone,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Disparador de mensagens em massa via WhatsApp Web (Playwright)."
    )
    parser.add_argument("planilha", help="Caminho para o arquivo .xlsx ou .csv com os contatos")
    parser.add_argument(
        "--mensagem",
        required=True,
        help="Texto da mensagem / Template A (use {nome} para personalizar) ou caminho para um arquivo .txt",
    )
    parser.add_argument(
        "--mensagem-b",
        default=None,
        help="Template B opcional para teste A/B (texto ou caminho .txt). "
        "Se informado, cada contato recebe A ou B aleatoriamente (50/50).",
    )
    parser.add_argument(
        "--business-hours-start",
        default="08:00",
        help="Início do horário comercial (HH:MM)",
    )
    parser.add_argument(
        "--business-hours-end",
        default="20:00",
        help="Fim do horário comercial (HH:MM)",
    )
    parser.add_argument(
        "--ignore-business-hours",
        action="store_true",
        help="Ignora a checagem de horário comercial",
    )
    parser.add_argument("--col-nome", default="Nome", help="Nome da coluna com o nome do contato")
    parser.add_argument(
        "--col-telefone", default="Telefone", help="Nome da coluna com o telefone do contato"
    )
    parser.add_argument("--login", action="store_true", help="Abre o navegador para escanear o QR Code")
    parser.add_argument("--min-delay", type=float, default=120, help="Segundos mínimos entre envios")
    parser.add_argument("--max-delay", type=float, default=300, help="Segundos máximos entre envios")
    parser.add_argument("--pause-every", type=int, default=5, help="A cada N envios, faz uma pausa longa")
    parser.add_argument(
        "--pause-min-delay", type=float, default=600, help="Segundos mínimos da pausa longa"
    )
    parser.add_argument(
        "--pause-max-delay", type=float, default=900, help="Segundos máximos da pausa longa"
    )
    parser.add_argument(
        "--relatorio", default="relatorio_envios.csv", help="Caminho do CSV de saída"
    )
    parser.add_argument("--session-dir", default="wa_session", help="Pasta da sessão logada")
    return parser.parse_args()


def carregar_contatos(caminho, col_nome, col_telefone):
    extensao = os.path.splitext(caminho)[1].lower()
    if extensao in (".xlsx", ".xlsm", ".xls"):
        df = pd.read_excel(caminho)
    elif extensao == ".csv":
        df = pd.read_csv(caminho)
    else:
        raise ValueError(f"Formato de planilha não suportado: {extensao}")

    faltando = [c for c in (col_nome, col_telefone) if c not in df.columns]
    if faltando:
        raise ValueError(
            f"Coluna(s) não encontrada(s) na planilha: {', '.join(faltando)}. "
            f"Colunas disponíveis: {', '.join(df.columns)}"
        )

    contatos = []
    for _, linha in df.iterrows():
        nome = str(linha[col_nome]).strip() if not pd.isna(linha[col_nome]) else ""
        telefone = linha[col_telefone]
        contatos.append({"nome": nome, "telefone": telefone})
    return contatos


def carregar_mensagem(mensagem_arg):
    if mensagem_arg.lower().endswith(".txt") and os.path.isfile(mensagem_arg):
        with open(mensagem_arg, "r", encoding="utf-8") as f:
            return f.read()
    return mensagem_arg


class Relatorio:
    def __init__(self, caminho):
        self.caminho = caminho
        self.linhas = []

    def registrar(self, nome, telefone, status, detalhe="", variante=""):
        self.linhas.append(
            {
                "nome": nome,
                "telefone": telefone,
                "status": status if not detalhe else f"{status}: {detalhe}",
                "variante": variante,
                "timestamp": datetime.now().isoformat(timespec="seconds"),
            }
        )

    def salvar(self):
        with open(self.caminho, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f, fieldnames=["nome", "telefone", "status", "variante", "timestamp"]
            )
            writer.writeheader()
            writer.writerows(self.linhas)
        print(f"Relatório salvo em {self.caminho} ({len(self.linhas)} registros)")


def main():
    args = parse_args()

    if args.login:
        cliente = WhatsAppClient(session_dir=args.session_dir, headless=False)
        cliente.start()
        try:
            cliente.login()
        finally:
            cliente.close()
        return

    contatos = carregar_contatos(args.planilha, args.col_nome, args.col_telefone)
    template_a = carregar_mensagem(args.mensagem)
    template_b = carregar_mensagem(args.mensagem_b) if args.mensagem_b else None
    hora_inicio = parse_hora(args.business_hours_start)
    hora_fim = parse_hora(args.business_hours_end)
    relatorio = Relatorio(args.relatorio)

    cliente = WhatsAppClient(session_dir=args.session_dir, headless=True)
    cliente.start()

    try:
        total = len(contatos)
        for i, contato in enumerate(contatos, start=1):
            nome = contato["nome"]
            telefone_original = contato["telefone"]
            telefone = sanitize_phone(telefone_original)

            if not args.ignore_business_hours:
                while not dentro_do_horario_comercial(hora_inicio, hora_fim):
                    print(
                        f"Fora do horário comercial ({args.business_hours_start}-"
                        f"{args.business_hours_end}). Aguardando 5 min..."
                    )
                    time.sleep(300)

            print(f"[{i}/{total}] {nome} ({telefone_original}) -> ", end="", flush=True)

            if telefone is None:
                print("NUMERO_INVALIDO")
                relatorio.registrar(nome, telefone_original, "NUMERO_INVALIDO")
                continue

            variante = "A"
            template_mensagem = template_a
            if template_b and random.random() < 0.5:
                variante = "B"
                template_mensagem = template_b

            mensagem = template_mensagem.replace("{nome}", nome)

            try:
                status, detalhe = cliente.send_message(telefone, mensagem)
            except Exception as exc:
                status, detalhe = "ERRO", str(exc)

            print(status)
            relatorio.registrar(nome, telefone, status, detalhe, variante=variante if template_b else "")

            if i == total:
                break

            if args.pause_every and i % args.pause_every == 0:
                pausa = random.uniform(args.pause_min_delay, args.pause_max_delay)
                print(f"Pausa longa de {pausa/60:.1f} min...")
                time.sleep(pausa)
            else:
                atraso = random.uniform(args.min_delay, args.max_delay)
                print(f"Aguardando {atraso:.0f}s antes do próximo envio...")
                time.sleep(atraso)
    except KeyboardInterrupt:
        print("\nInterrompido pelo usuário. Salvando relatório parcial...")
    finally:
        cliente.close()
        relatorio.salvar()


if __name__ == "__main__":
    sys.exit(main())

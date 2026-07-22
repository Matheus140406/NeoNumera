# WhatsApp Broadcaster (Playwright)

Disparador de mensagens em massa via **WhatsApp Web**, sem `pyautogui`. Roda em background (headless),
não trava o mouse/teclado da sua máquina, e usa uma sessão persistente — o QR Code só é escaneado uma vez.

## 1. Instalação

```bash
pip install -r requirements.txt
playwright install chromium
```

## 2. Primeiro login (uma única vez)

Abre o navegador visível pra você escanear o QR Code com o celular. Depois disso a sessão fica salva
na pasta `wa_session/` e você não precisa mais escanear (a menos que desconecte o WhatsApp Web manualmente).

```bash
python main.py contatos.xlsx --mensagem "Olá {nome}, tudo bem?" --login
```

## 3. Disparo automático (headless / background)

```bash
python main.py contatos.xlsx --mensagem "Olá {nome}, tudo bem?"
```

Ou com a mensagem vinda de um arquivo `.txt`:

```bash
python main.py contatos.csv --mensagem mensagem.txt --col-nome Cliente --col-telefone Celular
```

`{nome}` na mensagem é substituído automaticamente pelo nome de cada contato da planilha.

## 4. Parâmetros de anti-ban (opcionais)

| Flag | Padrão | Descrição |
|---|---|---|
| `--min-delay` | 120 | segundos mínimos entre envios |
| `--max-delay` | 300 | segundos máximos entre envios |
| `--pause-every` | 5 | a cada N envios, faz uma pausa longa (10-15 min) |
| `--relatorio` | relatorio_envios.csv | caminho do CSV de saída |
| `--session-dir` | wa_session | pasta da sessão logada |

## 5. Relatório

Ao final (ou se você interromper com `Ctrl+C`), é gerado `relatorio_envios.csv` com:

```
nome, telefone, status, timestamp
```

Status possíveis: `ENVIADO`, `SEM_WHATSAPP`, `NUMERO_INVALIDO`, `ERRO_ENVIO`, `ERRO: <detalhe>`.

## Observações importantes

- **Isso não é a API oficial do WhatsApp.** É automação de DOM sobre o WhatsApp Web — funciona bem para
  volumes moderados (dezenas/poucas centenas por dia) com os intervalos de anti-ban configurados, mas
  os seletores em `whatsapp_client.py` podem quebrar quando o WhatsApp atualizar a interface.
- Para volume alto ou uso comercial crítico (ex: dentro do Neonumera), o caminho mais seguro no médio
  prazo é migrar para a **Cloud API oficial do WhatsApp Business Platform** (Evolution API já cobre
  bem esse gap, já que você já usa ela no Neonumera).
- Números são higienizados para o formato `55DDNNNNNNNNN` (DDI 55 + DDD + 9 dígitos), inserindo o 9º
  dígito quando a planilha vem no formato antigo.

# NeoNumera — WhatsApp Broadcaster

Disparador de mensagens em massa via **WhatsApp Web**, sem `pyautogui`. Roda em background (headless),
não trava o mouse/teclado da sua máquina, usa uma sessão persistente (o QR Code só é escaneado uma vez),
e agora tem um painel web (`frontend/`) que fala com a mesma lógica de disparo por trás de uma API
(`backend/api.py`).

## Estrutura do repositório

```
backend/    CLI (main.py) + automação Playwright (whatsapp_client.py) + API HTTP (api.py)
frontend/   Painel web (Vite + React + Tailwind) que consome a API do backend
```

## 1. CLI (linha de comando)

```bash
cd backend
pip install -r requirements.txt
playwright install chromium
```

### Primeiro login (uma única vez)

Abre o navegador visível pra você escanear o QR Code com o celular. Depois disso a sessão fica salva
na pasta `wa_session/` e você não precisa mais escanear (a menos que desconecte o WhatsApp Web manualmente).

```bash
python main.py contatos.xlsx --mensagem "Olá {nome}, tudo bem?" --login
```

### Disparo automático (headless / background)

```bash
python main.py contatos.xlsx --mensagem "Olá {nome}, tudo bem?"
```

Ou com a mensagem vinda de um arquivo `.txt`, template B para teste A/B, e fora do horário comercial padrão:

```bash
python main.py contatos.csv --mensagem mensagem.txt --mensagem-b variante_b.txt \
  --col-nome Cliente --col-telefone Celular \
  --business-hours-start 09:00 --business-hours-end 19:00
```

`{nome}` na mensagem é substituído automaticamente pelo nome de cada contato da planilha. A digitação é
humanizada (caractere a caractere, com atrasos aleatórios) para reduzir o risco de detecção como bot.

### Parâmetros de anti-ban (opcionais)

| Flag | Padrão | Descrição |
|---|---|---|
| `--min-delay` | 120 | segundos mínimos entre envios |
| `--max-delay` | 300 | segundos máximos entre envios |
| `--pause-every` | 5 | a cada N envios, faz uma pausa longa (10-15 min) |
| `--mensagem-b` | — | template B opcional, sorteado 50/50 por contato (teste A/B) |
| `--business-hours-start` / `--business-hours-end` | 08:00 / 20:00 | janela de envio permitida |
| `--ignore-business-hours` | — | desliga a checagem de horário comercial |
| `--relatorio` | relatorio_envios.csv | caminho do CSV de saída |
| `--session-dir` | wa_session | pasta da sessão logada |

### Relatório

Ao final (ou se você interromper com `Ctrl+C`), é gerado `relatorio_envios.csv` com:

```
nome, telefone, status, variante, timestamp
```

Status possíveis: `ENVIADO`, `SEM_WHATSAPP`, `NUMERO_INVALIDO`, `ERRO_ENVIO`, `ERRO: <detalhe>`.

## 2. API HTTP (usada pelo painel web)

```bash
cd backend
uvicorn api:app --reload --port 8000
```

Endpoints principais: `POST /api/upload` (planilha), `POST /api/dispatch` (inicia disparo em background,
com `dry_run` opcional), `GET /api/queue` (status por contato), `GET /api/analytics` (KPIs agregados),
`GET /api/status` (sessão do WhatsApp), `POST /api/login/start` + `GET /api/login/qr` (login por QR Code
direto do painel, sem precisar do terminal). Estado fica em memória — reinicia zerado a cada restart do
processo.

## 3. Painel web (frontend)

```bash
cd frontend
npm install
npm run dev
```

Abre em `http://localhost:5173`, com proxy configurado para a API em `http://127.0.0.1:8000`. Fluxo:
clique em "WhatsApp sem sessão" pra conectar via QR Code direto no navegador → arraste uma planilha →
confira o mapeamento de colunas detectado → escreva a mensagem → ajuste a cadência → dispare em modo
simulação (`dry-run`) ou real, acompanhando a fila e as métricas em tempo real.

## 4. Deploy em produção (Vercel + Railway/Render)

**Importante:** o Vercel só serve o `frontend/` (arquivos estáticos). Ele **não roda** o backend —
FastAPI e Playwright precisam de um processo contínuo com disco persistente, o que o Vercel (serverless)
não oferece. O backend precisa ser hospedado separadamente.

### Backend no Railway ou Render

1. Aponte o serviço (Railway: "New Service" → "Deploy from repo"; Render: "New Web Service") para a pasta
   `backend/` deste repositório — ambos detectam o `backend/Dockerfile` automaticamente.
2. Configure um **volume/disco persistente** montado em `/data` (Render já vem pronto via `render.yaml`;
   no Railway, adicione um Volume apontando pra `/data`). Sem isso, a sessão do WhatsApp (`wa_session/`)
   some a cada deploy e o QR Code precisa ser escaneado de novo.
3. A variável `WA_SESSION_DIR=/data/wa_session` já vem definida no `Dockerfile`.
4. Depois do deploy, anote a URL pública do backend (ex: `https://neonumera-backend.up.railway.app`).

### Frontend no Vercel

1. Configure o projeto Vercel apontando pra pasta `frontend/` (Root Directory = `frontend`).
2. Defina a variável de ambiente `VITE_API_URL` nas configurações do projeto Vercel, apontando pra API
   do backend publicado, incluindo o `/api` no final:
   `VITE_API_URL=https://neonumera-backend.up.railway.app/api`
3. Redeploy. Veja `frontend/.env.example` para referência.

Sem o `VITE_API_URL` configurado, o frontend tenta chamar `/api/...` relativo ao próprio domínio do
Vercel — que não tem backend nenhum atrás, por isso o upload de planilha falha e a opção de conectar o
WhatsApp nunca aparece funcional.

## Observações importantes

- **Isso não é a API oficial do WhatsApp.** É automação de DOM sobre o WhatsApp Web — funciona bem para
  volumes moderados (dezenas/poucas centenas por dia) com os intervalos de anti-ban configurados, mas
  os seletores em `whatsapp_client.py` podem quebrar quando o WhatsApp atualizar a interface.
- Para volume alto ou uso comercial crítico, o caminho mais seguro no médio prazo é migrar para a
  **Cloud API oficial do WhatsApp Business Platform** (Evolution API já cobre bem esse gap).
- Números são higienizados para o formato `55DDNNNNNNNNN` (DDI 55 + DDD + 9 dígitos), inserindo o 9º
  dígito quando a planilha vem no formato antigo.

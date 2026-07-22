FROM mcr.microsoft.com/playwright/python:v1.45.0-jammy

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# wa_session/ deve ser um volume persistente no Railway/Render, senão a
# sessão do WhatsApp se perde a cada deploy/restart e o QR precisa ser
# escaneado de novo.
ENV WA_SESSION_DIR=/data/wa_session
RUN mkdir -p /data/wa_session

EXPOSE 8000
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]

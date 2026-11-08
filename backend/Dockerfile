# Backend image for Railway (FastAPI + Motor/MongoDB).
# Railway service "Root Directory" should be set to `backend`, so the build
# context is this folder.
FROM python:3.12-slim

WORKDIR /app

# Install only the runtime deps (see requirements-railway.txt for why).
COPY requirements-railway.txt .
RUN pip install --no-cache-dir -r requirements-railway.txt

# App code.
COPY server.py .

# Railway injects $PORT at runtime; default to 8001 for local `docker run`.
ENV PORT=8001
EXPOSE 8001

# server.py reads MONGO_URL and DB_NAME from the environment at import time,
# so both MUST be set on the Railway service or the app will fail to start.
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8001}"]

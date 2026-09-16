# OMERTA AGENT — container image (OCI). Runs the web UI + API from source.
#
#   docker build -t omerta-agent -f docker/Dockerfile .
#   docker run --rm -p 8787:8787 -v omerta-data:/data \
#     -e ANTHROPIC_API_KEY=sk-ant-... omerta-agent
#
# Then open http://localhost:8787 (loopback is token-exempt; from another host
# use the token the server prints and ?token=...).
FROM python:3.11-slim

LABEL org.opencontainers.image.title="OMERTA AGENT" \
      org.opencontainers.image.description="Offline-capable coding & firmware agent that asks before it acts" \
      org.opencontainers.image.source="https://github.com/omertanocomment-rgb/Paranoid96"

# git is genuinely useful to the agent inside the container; keep the image lean.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/requirements.txt
# The Anthropic SDK is optional (the provider falls back to plain requests);
# skip it here to keep the image small — set ANTHROPIC_API_KEY and it still works.
RUN pip install --no-cache-dir \
        requests pyyaml rich fastapi "uvicorn[standard]" websockets python-multipart

COPY . /app

ENV OMERTA_DATA_DIR=/data \
    OMERTA_HOST=0.0.0.0 \
    OMERTA_PORT=8787
VOLUME ["/data"]
EXPOSE 8787

ENTRYPOINT ["python", "/app/omerta_entry.py"]
CMD ["serve"]

# §18 — container packaging for the OMERTA AI engine.
FROM python:3.12-slim
WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir -e .
# Non-root by default (policies.toml: least privilege).
RUN useradd -m omerta || true
USER omerta
EXPOSE 8787
ENTRYPOINT ["omerta"]
CMD ["web", "--host", "0.0.0.0"]

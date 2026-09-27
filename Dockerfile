# Imagen única para Cloud Run: la API sirve también la app web compilada.
#   docker build -t alcien .
#   docker run -p 8080:8080 --env-file .env alcien

# ---------- Compilación ----------
FROM node:22-slim AS compilar
WORKDIR /src
COPY package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install --workspaces --include-workspace-root=false --no-audit --no-fund
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build -w @alcien/api && npm run build -w @alcien/web

# ---------- Ejecución ----------
FROM node:22-slim
ENV NODE_ENV=production \
    ALCIEN_ENTORNO=produccion \
    ALCIEN_WEB_DIR=/app/web \
    ALCIEN_DB_DIR=/app/db \
    PORT=8080
WORKDIR /app
# La API no tiene dependencias de ejecución: solo su código compilado
COPY --from=compilar /src/apps/api/dist ./api
COPY --from=compilar /src/apps/web/dist ./web
# Migraciones y catálogo: se aplican al arrancar cuando hay ALCIEN_DB_ADMIN_URL (Render + Neon)
COPY db/migrations ./db/migrations
COPY db/seed ./db/seed
RUN echo '{"type":"module"}' > ./api/package.json
USER node
EXPOSE 8080
CMD ["node", "api/main.js"]

# Imagen unica: compila el frontend y el servidor, y sirve los dos.
#
# Un solo contenedor y un solo dominio evitan configurar CORS con credenciales y
# el WebSocket cruzado, que son dos cosas mas que pueden fallar. Cloud Run
# soporta WebSocket sobre el mismo servicio sin nada extra.

# ---------------------------------------------------------------- frontend
FROM node:22-slim AS frontend
WORKDIR /app/uml-board
COPY uml-board/package*.json ./
RUN npm ci
COPY uml-board/ ./
# La API queda en el mismo origen, asi que la URL base es relativa.
# "/" es el centinela de mismo-origen (env.ts lo normaliza a cadena vacia);
# se usa un valor no vacio para que Vite no lo descarte al construir.
ENV VITE_API_URL="/"
RUN npm run build

# ------------------------------------------------------------------ backend
FROM node:22-slim AS backend
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# -------------------------------------------------------------- imagen final
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json ./
# Solo las dependencias de produccion: la imagen baja de tamano y hay menos
# superficie que mantener.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=backend /app/server/dist ./dist
COPY --from=backend /app/server/sql ./sql
COPY --from=frontend /app/uml-board/dist ./public
# Certificado de la autoridad de RDS, para validar TLS contra la base sin
# desactivar la verificacion (ver DATABASE_CA_FILE en server/src/config.ts).
COPY deploy/rds-global-bundle.pem ./rds-ca.pem
ENV STATIC_DIR=./public
# Cloud Run inyecta PORT; el servidor ya lo lee de ahi.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]

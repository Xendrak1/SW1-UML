# Puesta en marcha — paso a paso

Guía corta para dejar el proyecto andando en una máquina nueva.

## 1. Requisitos

- **Node.js 18 o superior** — <https://nodejs.org>
- **Docker Desktop** — <https://www.docker.com/products/docker-desktop> (solo para Postgres)
- **Ollama** (opcional, para la IA local) — <https://ollama.com>

## 2. Base de datos

```bash
docker compose up -d
docker compose ps        # debe decir "healthy"
```

Postgres queda en `localhost:5433` (usuario `case_user`, contraseña `case_pass`,
base `case_db`). Se usa el 5433 y no el 5432 para no chocar con un Postgres que
ya tengas instalado.

Si preferís no usar Docker: instalá Postgres, creá la base y el usuario a mano, y
ajustá `DATABASE_URL` en `server/.env`.

## 3. Backend

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Al arrancar aplica el esquema solo (`sql/schema.sql`, idempotente) y crea una
pizarra inicial si la base está vacía. Comprobación: <http://localhost:4000/health>
debe devolver `{"ok":true,"db":"up"}`.

## 4. Frontend

```bash
cd uml-board
cp .env.example .env
npm install
npm run dev
```

Abrí <http://localhost:5173>.

## 5. IA

Sin configurar nada, la app funciona pero el asistente de voz/texto y la
importación por foto no. Elegí una de las dos opciones (o las dos):

### IA local (Ollama)

```bash
ollama pull qwen2.5:7b-instruct      # ~4.7 GB, para texto
ollama pull llama3.2-vision:11b      # ~7.9 GB, para leer diagramas de fotos
ollama serve                         # normalmente ya corre como servicio
```

En una laptop con 24 GB de RAM y GPU dedicada el modelo de 7B anda cómodo.

### IA en la nube (OpenAI)

En `server/.env`:

```
OPENAI_API_KEY=tu_clave_aqui
```

La clave queda **solo** en el servidor; el navegador nunca la ve.

### Estrategia

`AI_STRATEGY=hybrid` en `server/.env` intenta primero la local y cae a la nube si
falla. Es lo recomendado para la defensa presencial.

## 6. Probar la colaboración

1. Abrí la app en dos ventanas distintas (o en una normal y otra de incógnito, para
   que tengan identidades separadas).
2. Creá una clase en una: aparece en la otra.
3. En la barra superior se ven los participantes conectados.
4. Para probar el modo sin conexión: en las herramientas de desarrollador, pestaña
   Red, marcá "Sin conexión". Seguí editando —los cambios se guardan en el
   dispositivo y el indicador muestra la cola— y volvé a conectar: se sincroniza solo.

## 7. Probar en el celular

1. `ipconfig` en Windows para ver la IP de la PC (algo como `192.168.0.12`).
2. En `uml-board/.env`: `VITE_API_URL=http://192.168.0.12:4000`
3. Arrancá el frontend con `npm run dev -- --host`.
4. Desde el celular, en la misma red WiFi, entrá a `http://192.168.0.12:5173/voz`.
5. Instalala: menú del navegador → "Agregar a la pantalla de inicio".

El micrófono necesita HTTPS o localhost en la mayoría de los navegadores. Si el
celular no deja usar el micrófono por HTTP, en Chrome se puede habilitar el origen
en `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.

## Problemas frecuentes

| Síntoma | Causa y solución |
| --- | --- |
| `/health` no responde | El backend no está corriendo, o Postgres no arrancó. Revisá `docker compose ps`. |
| La app dice "Sin conexión" | El backend está caído o `VITE_API_URL` apunta mal. Mirá `/debug`. |
| El asistente responde con un error de IA | No hay Ollama corriendo ni `OPENAI_API_KEY` configurada. Mirá `/debug`. |
| Error de puerto 5433 ocupado | Cambiá el puerto en `docker-compose.yml` y en `DATABASE_URL`. |
| El celular no conecta | Firewall de Windows bloqueando el puerto 4000/5173 en la red privada. |

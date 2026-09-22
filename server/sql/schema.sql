-- Esquema de la aplicacion CASE.
-- Reemplaza el esquema que antes vivia en Supabase.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Un diagrama es el documento colaborativo: estado materializado + version (seq).
CREATE TABLE IF NOT EXISTS diagrams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL DEFAULT 'Diagrama',
  doc         JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[],"deleted":[]}'::jsonb,
  seq         BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una pizarra es la vista de trabajo sobre un diagrama.
CREATE TABLE IF NOT EXISTS boards (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  diagram_id  UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bitacora de operaciones granulares. Es el corazon de la colaboracion:
--  * seq da un orden total por diagrama (resuelve el conflicto de escrituras concurrentes)
--  * op_id es generado por el cliente y es UNICO: hace la reconexion offline idempotente
CREATE TABLE IF NOT EXISTS diagram_ops (
  op_id       UUID PRIMARY KEY,
  diagram_id  UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  seq         BIGINT NOT NULL,
  client_id   TEXT NOT NULL,
  actor_name  TEXT,
  kind        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (diagram_id, seq)
);

CREATE INDEX IF NOT EXISTS diagram_ops_by_diagram_seq ON diagram_ops (diagram_id, seq);
CREATE INDEX IF NOT EXISTS boards_by_diagram ON boards (diagram_id);

-- Imagenes subidas (reemplaza Supabase Storage). Solo metadatos; el binario va al disco.
CREATE TABLE IF NOT EXISTS uploads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Seguridad
-- La herramienta se despliega en la nube, con la base accesible desde internet:
-- sin autenticacion cualquiera con el enlace abriria cualquier pizarra.

CREATE TABLE IF NOT EXISTS usuarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correo        TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  -- scrypt, en el formato "scrypt$N$r$p$sal$hash". Nunca la contrasena en claro.
  password_hash TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#667eea',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El dueno de la pizarra es el anfitrion: es un dato persistente, no depende de
-- quien se conecto primero.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES usuarios(id) ON DELETE SET NULL;

-- Quien puede entrar a que pizarra, y con que rol.
CREATE TABLE IF NOT EXISTS board_members (
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  -- "propietario" administra la pizarra; "editor" modela; "lector" solo mira.
  rol        TEXT NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS board_members_por_usuario ON board_members (usuario_id);

-- Invitaciones por pizarra: el anfitrion genera un enlace y quien lo abre crea
-- su cuenta y queda como miembro de ESA pizarra.
--
-- Reemplaza al codigo de registro global, que era un parche: uno solo para todo
-- el sistema, que no caduca, que hay que repartir a mano y que si se filtra hay
-- que cambiar en la configuracion del servidor. Una invitacion nace de una
-- pizarra concreta, tiene dueno, vence y se puede revocar.
CREATE TABLE IF NOT EXISTS board_invites (
  token      TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  -- Con que rol entra quien use el enlace.
  rol        TEXT NOT NULL DEFAULT 'editor',
  creada_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  expira_en  TIMESTAMPTZ NOT NULL,
  -- 0 = sin limite. Un enlace de un solo uso sirve para invitar a una persona.
  usos_max   INTEGER NOT NULL DEFAULT 0,
  usos       INTEGER NOT NULL DEFAULT 0,
  revocada   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS board_invites_por_pizarra ON board_invites (board_id);

# Despliegue en AWS

El `Dockerfile` de la raíz es agnóstico del proveedor: compila el frontend,
compila el servidor y deja un solo contenedor que sirve los dos. **Eso está
probado**: lo construí y verifiqué que sirve `/`, `/datos`, `/voz`, los assets y
la API. Lo que sigue son los comandos de AWS, que **no pude probar** porque el
entorno donde trabajo bloquea todos los endpoints de AWS.

## Qué hace falta

Dos piezas:

1. **RDS PostgreSQL** para los datos.
2. **Elastic Beanstalk con plataforma Docker** para la aplicación.

Elegí Beanstalk y no ECS porque crea solo el balanceador, la VPC y los grupos de
seguridad. Con ECS habría que armar todo eso a mano, y a esta altura cada pieza
extra es una cosa más que puede fallar.

## Antes de empezar: necesitás otra credencial

Lo que me pasaste es un usuario y contraseña de la **consola web**. Eso sirve
para que entres vos por el navegador, no para desplegar desde una terminal. Para
la terminal hace falta una **clave de acceso programático**:

Consola de AWS → IAM → Usuarios → `asistente-ia-examen` → *Credenciales de
seguridad* → *Crear clave de acceso* → tipo *Interfaz de línea de comandos*.

Te da un `Access key ID` y un `Secret access key`. Con eso:

```bash
aws configure
```

## Los comandos

```bash
REGION=us-east-1
APP=sw1-uml
PASS_BD="$(openssl rand -base64 24 | tr -d '\n/+=' | head -c 24)"
SECRETO="$(openssl rand -base64 48 | tr -d '\n')"
CODIGO="$(openssl rand -hex 4)"

# --- 1) Base de datos ---
aws rds create-db-instance \
  --db-instance-identifier "$APP-db" \
  --db-instance-class db.t4g.micro \
  --engine postgres --engine-version 16 \
  --master-username case_user --master-user-password "$PASS_BD" \
  --allocated-storage 20 --publicly-accessible \
  --db-name case_db --region "$REGION"

# Tarda varios minutos. Esperar y pedir el host:
aws rds wait db-instance-available --db-instance-identifier "$APP-db" --region "$REGION"
HOST=$(aws rds describe-db-instances --db-instance-identifier "$APP-db" \
  --region "$REGION" --query 'DBInstances[0].Endpoint.Address' --output text)

# --- 2) Aplicación ---
eb init "$APP" --platform docker --region "$REGION"
eb create "$APP-env" --single

# sslmode=require porque RDS exige TLS. El servidor ya lo detecta solo.
eb setenv \
  DATABASE_URL="postgresql://case_user:$PASS_BD@$HOST:5432/case_db?sslmode=require" \
  AUTH_SECRET="$SECRETO" \
  AUTH_REQUIRED=true \
  REGISTRO_CODIGO="$CODIGO" \
  AI_STRATEGY=cloud \
  OPENAI_API_KEY="tu-clave"

echo "Código de registro: $CODIGO"
eb open
```

## Tres cosas que te van a morder si no las sabés

**El grupo de seguridad de RDS.** `--publicly-accessible` no alcanza: hay que
abrir el puerto 5432 al grupo de seguridad de Beanstalk. Si la aplicación no
conecta, esto es lo primero a mirar. Lo correcto para producción es RDS privado
dentro de la misma VPC, no público.

**TLS contra la base.** RDS rechaza conexiones sin cifrar. Agregué el manejo de
TLS al pool de Postgres: se activa con `DATABASE_SSL=true` o cuando la URL trae
`sslmode=require`. Sin certificado de la autoridad la conexión va cifrada pero
no se verifica la identidad del servidor, y el servidor lo avisa por consola.
Para cerrarlo del todo:

```bash
curl -o rds-ca.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
eb setenv DATABASE_CA_FILE=./rds-ca.pem
```

**No hay Ollama en la nube.** `AI_STRATEGY=cloud` y una clave de OpenAI, o el
asistente no responde. La IA local sigue siendo la del escritorio y la del
teléfono, que es donde el enunciado la pide.

## Costo

`db.t4g.micro` entra en la capa gratuita el primer año; si no, son unos 12 a 15
dólares al mes. Beanstalk con `--single` (sin balanceador) usa una `t3.micro`,
también de capa gratuita. Para apagar todo:

```bash
eb terminate "$APP-env"
aws rds delete-db-instance --db-instance-identifier "$APP-db" \
  --skip-final-snapshot --region "$REGION"
```

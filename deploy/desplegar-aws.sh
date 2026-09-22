#!/usr/bin/env bash
# Despliegue en AWS: RDS PostgreSQL + Elastic Beanstalk (Docker, una instancia).
#
# ATENCION: este script NO se pudo probar. El entorno donde se escribio tiene
# bloqueado el acceso a AWS, asi que los comandos salen de la documentacion y no
# de una corrida real. Va con "set -e" y va imprimiendo cada paso: si algo
# falla, se detiene ahi y se ve en cual.
#
# Requisitos:
#   pip install awsebcli awscli
#   export AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...
#
# Uso, desde la raiz del repositorio:
#   bash deploy/desplegar-aws.sh
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
APP="${APP:-sw1-uml}"
ENTORNO="${ENTORNO:-$APP-env}"
BD_ID="${BD_ID:-$APP-db}"

paso() { echo; echo "==> $*"; }

command -v aws >/dev/null || { echo "Falta el AWS CLI: pip install awscli"; exit 1; }
command -v eb  >/dev/null || { echo "Falta el EB CLI:  pip install awsebcli"; exit 1; }

paso "Comprobando la credencial"
aws sts get-caller-identity --output table

# --------------------------------------------------------------- secretos
# Se generan aca y se imprimen una sola vez al final. No quedan en el
# repositorio ni en ningun archivo.
PASS_BD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)"
SECRETO_AUTH="$(openssl rand -base64 48 | tr -d '\n')"
CODIGO_REGISTRO="$(openssl rand -hex 4)"

# --------------------------------------------------------------- RDS
paso "Base de datos PostgreSQL 16 en RDS"
if aws rds describe-db-instances --db-instance-identifier "$BD_ID" --region "$REGION" >/dev/null 2>&1; then
  echo "    la instancia ya existe; se reutiliza y se le cambia la contrasena"
  aws rds modify-db-instance --db-instance-identifier "$BD_ID" \
    --master-user-password "$PASS_BD" --apply-immediately --region "$REGION" >/dev/null
else
  aws rds create-db-instance \
    --db-instance-identifier "$BD_ID" \
    --db-instance-class db.t4g.micro \
    --engine postgres \
    --master-username case_user \
    --master-user-password "$PASS_BD" \
    --allocated-storage 20 \
    --db-name case_db \
    --publicly-accessible \
    --backup-retention-period 1 \
    --region "$REGION" >/dev/null
fi

paso "Esperando a que la base este disponible (tarda varios minutos)"
aws rds wait db-instance-available --db-instance-identifier "$BD_ID" --region "$REGION"

HOST_BD="$(aws rds describe-db-instances --db-instance-identifier "$BD_ID" --region "$REGION" \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
SG_BD="$(aws rds describe-db-instances --db-instance-identifier "$BD_ID" --region "$REGION" \
  --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' --output text)"
echo "    host: $HOST_BD"
echo "    grupo de seguridad: $SG_BD"

# --------------------------------------------------------------- Beanstalk
paso "Aplicacion en Elastic Beanstalk (Docker)"
if [ ! -d .elasticbeanstalk ]; then
  eb init "$APP" --platform docker --region "$REGION"
fi

if eb status "$ENTORNO" >/dev/null 2>&1; then
  echo "    el entorno ya existe"
else
  # --single: una sola instancia, sin balanceador. Mas barato, y el WebSocket
  # va directo a la instancia sin el tiempo de espera del balanceador.
  eb create "$ENTORNO" --single --instance-type t3.micro
fi

# ------------------------------------------- permiso de la base a la aplicacion
# Esto es lo que mas se olvida: --publicly-accessible no alcanza, hay que abrir
# el 5432 al grupo de seguridad de la instancia. Se hace DESPUES de crear el
# entorno, porque hasta entonces ese grupo no existe.
paso "Abriendo el puerto 5432 de la base al grupo de seguridad de la aplicacion"
INSTANCIA="$(aws elasticbeanstalk describe-environment-resources \
  --environment-name "$ENTORNO" --region "$REGION" \
  --query 'EnvironmentResources.Instances[0].Id' --output text)"
SG_APP="$(aws ec2 describe-instances --instance-ids "$INSTANCIA" --region "$REGION" \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)"
echo "    instancia: $INSTANCIA | grupo: $SG_APP"

aws ec2 authorize-security-group-ingress \
  --group-id "$SG_BD" \
  --protocol tcp --port 5432 \
  --source-group "$SG_APP" \
  --region "$REGION" >/dev/null 2>&1 \
  && echo "    permiso agregado" \
  || echo "    el permiso ya existia"

# --------------------------------------------------------------- variables
paso "Configurando las variables de entorno"
# sslmode=require porque RDS exige TLS; el servidor lo detecta en la URL.
eb setenv --environment "$ENTORNO" \
  DATABASE_URL="postgresql://case_user:${PASS_BD}@${HOST_BD}:5432/case_db?sslmode=require" \
  AUTH_SECRET="$SECRETO_AUTH" \
  AUTH_REQUIRED=true \
  REGISTRO_CODIGO="$CODIGO_REGISTRO" \
  AI_STRATEGY=cloud \
  CORS_ORIGIN='*'

URL="$(eb status "$ENTORNO" | grep -i 'CNAME' | awk '{print $2}')"

echo
echo "=================================================================="
echo " Listo: http://$URL"
echo
echo " Codigo de registro: $CODIGO_REGISTRO"
echo "   Se pide al crear una cuenta. Compartilo solo con tu equipo."
echo
echo " Contrasena de la base: $PASS_BD"
echo "   Guardala ahora: no se vuelve a mostrar."
echo
echo " Falta la clave de OpenAI para que responda la IA (en la nube no hay Ollama):"
echo "   eb setenv --environment $ENTORNO OPENAI_API_KEY=tu-clave"
echo
echo " Para apagar todo y no gastar:"
echo "   eb terminate $ENTORNO"
echo "   aws rds delete-db-instance --db-instance-identifier $BD_ID \\"
echo "     --skip-final-snapshot --region $REGION"
echo "=================================================================="

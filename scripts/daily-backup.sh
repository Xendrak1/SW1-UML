#!/bin/bash
# Script de backup diario - Ejecutar cada día

PROJECT_PATH="/home/ubuntu/proyectos/proyecto-software-1"
BACKUP_DIR="/home/ubuntu/backups"
DATE=$(date +%Y%m%d-%H%M%S)

echo "🔄 Iniciando backup diario..."

# Crear directorio de backups si no existe
mkdir -p "$BACKUP_DIR"

# Backup completo del proyecto
echo "📁 Creando backup completo..."
tar -czf "$BACKUP_DIR/proyecto-software-1-$DATE.tar.gz" -C "/home/ubuntu/proyectos" "proyecto-software-1"

# Backup solo del código fuente
echo "💾 Creando backup de código fuente..."
cd "$PROJECT_PATH"
git bundle create "$BACKUP_DIR/proyecto-git-$DATE.bundle" --all

# Backup de la base de datos (si usas una local)
if [ -f "$PROJECT_PATH/database.sqlite" ]; then
    cp "$PROJECT_PATH/database.sqlite" "$BACKUP_DIR/database-$DATE.sqlite"
fi

# Mantener solo los últimos 7 backups
echo "🧹 Limpiando backups antiguos..."
find "$BACKUP_DIR" -name "proyecto-software-1-*.tar.gz" -mtime +7 -delete
find "$BACKUP_DIR" -name "proyecto-git-*.bundle" -mtime +7 -delete

echo "✅ Backup completado: $BACKUP_DIR/proyecto-software-1-$DATE.tar.gz"
echo "✅ Git bundle creado: $BACKUP_DIR/proyecto-git-$DATE.bundle"

# Verificar integridad
if [ -f "$BACKUP_DIR/proyecto-software-1-$DATE.tar.gz" ]; then
    echo "🔍 Verificando integridad del backup..."
    tar -tzf "$BACKUP_DIR/proyecto-software-1-$DATE.tar.gz" > /dev/null && echo "✅ Backup verificado correctamente" || echo "❌ Error en la verificación del backup"
fi
#!/bin/bash
# Añadir a crontab: 0 9 * * * /path/to/this/script

echo "🌅 Buenos días! Recordatorio de seguridad diario:"
echo "1. ¿Hiciste backup de tu trabajo ayer?"
echo "2. ¿Hay cambios sin commit en tu proyecto?"

cd /home/ubuntu/proyectos/proyecto-software-1
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  TIENES CAMBIOS SIN COMMIT - ¡Haz backup ahora!"
    git status
else
    echo "✅ No hay cambios pendientes"
fi

echo "3. Ejecutar backup diario? (y/n)"
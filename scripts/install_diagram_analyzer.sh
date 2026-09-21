#!/bin/bash
# Script de instalación para el analizador de diagramas de clases

echo "🚀 Instalando Analizador de Diagramas de Clases OpenAI"
echo "================================================="

# Verificar Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 no encontrado. Instalando..."
    sudo apt update
    sudo apt install -y python3 python3-pip python3-venv
fi

echo "✅ Python3 está disponible"

# Crear entorno virtual si no existe
if [ ! -d "venv_analyzer" ]; then
    echo "📦 Creando entorno virtual..."
    python3 -m venv venv_analyzer
fi

# Activar entorno virtual e instalar dependencias
echo "📦 Instalando dependencias en entorno virtual..."
source venv_analyzer/bin/activate
pip install -r requirements_diagram_analyzer.txt

echo "✅ Dependencias instaladas en entorno virtual"

# Hacer ejecutables los scripts
chmod +x analyze_class_diagram.py
chmod +x example_diagram_analysis.py

echo "✅ Scripts configurados como ejecutables"

echo ""
echo "🎉 ¡Instalación completada!"
echo ""
echo "📋 Uso:"
echo "  source venv_analyzer/bin/activate"
echo "  python3 analyze_class_diagram.py <url_imagen> <openai_token>"
echo ""
echo "📖 Ver ejemplos:"
echo "  source venv_analyzer/bin/activate"
echo "  python3 example_diagram_analysis.py"
echo ""
echo "📚 Documentación completa:"
echo "  cat DOCUMENTACION_COMPLETA.md"
echo ""
echo "💡 Tip: Usa gpt-4o-mini para análisis económicos (~$0.0003 por imagen)"
echo ""
echo "🔧 Nota: Recuerda activar el entorno virtual antes de usar los scripts:"
echo "  source venv_analyzer/bin/activate"
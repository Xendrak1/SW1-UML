#!/bin/bash
# Script wrapper para usar el analizador fácilmente

# Verificar que estemos en el directorio correcto
if [ ! -f "analyze_class_diagram.py" ]; then
    echo "❌ Error: Ejecuta este script desde el directorio scripts/"
    exit 1
fi

# Verificar que el entorno virtual existe
if [ ! -d "venv_analyzer" ]; then
    echo "❌ Error: Entorno virtual no encontrado. Ejecuta primero:"
    echo "   ./install_diagram_analyzer.sh"
    exit 1
fi

# Activar entorno virtual
source venv_analyzer/bin/activate

# Opción especial para mostrar ejemplo
if [ "$1" = "--example" ]; then
    echo "🧪 Ejecutando script de ejemplo..."
    python3 example_diagram_analysis.py
    exit 0
fi

# Verificar argumentos
if [ $# -lt 2 ]; then
    echo "🤖 Analizador de Diagramas de Clases - OpenAI Vision"
    echo "================================================="
    echo ""
    echo "📋 Uso:"
    echo "  ./run_analyzer.sh <url_imagen> <openai_token> [opciones]"
    echo ""
    echo "📖 Ejemplos:"
    echo "  ./run_analyzer.sh \"https://example.com/diagram.png\" \"sk-proj-...\""
    echo "  ./run_analyzer.sh \"https://example.com/diagram.png\" \"sk-proj-...\" --model gpt-4o-mini"
    echo "  ./run_analyzer.sh \"https://example.com/diagram.png\" \"sk-proj-...\" --max-tokens 800 --verbose"
    echo ""
    echo "💡 Modelos disponibles:"
    echo "  - gpt-4o-mini (recomendado, más económico)"
    echo "  - gpt-4o (mayor calidad)"
    echo "  - gpt-4-vision-preview (legacy)"
    echo ""
    echo "📚 Ver documentación completa:"
    echo "  cat DOCUMENTACION_COMPLETA.md"
    exit 1
fi

# Opción especial para mostrar ejemplo
if [ "$1" = "--example" ]; then
    echo "🧪 Ejecutando script de ejemplo..."
    python3 example_diagram_analysis.py
    exit 0
fi

# Ejecutar analizador con todos los argumentos
echo "🚀 Ejecutando análisis de diagrama..."
echo "🔧 Entorno virtual activado"
echo ""

python3 analyze_class_diagram.py "$@"

echo ""
echo "✅ Análisis completado"
echo "💡 Tip: El archivo JSON resultado contiene la estructura del diagrama"
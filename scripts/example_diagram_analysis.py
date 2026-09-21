#!/usr/bin/env python3
"""
🧪 Script de ejemplo y demostración del analizador de diagramas UML
Muestra precios, comandos de ejemplo y formato de salida esperado
"""

import json

# Configuración de precios actualizada (USD por 1K tokens)
MODEL_CONFIGS = {
    "gpt-4o-mini": {
        "input_price": 0.00015,   # $0.15 por 1M tokens
        "output_price": 0.0006,   # $0.60 por 1M tokens  
        "recommended": True
    },
    "gpt-4o": {
        "input_price": 0.005,     # $5 por 1M tokens
        "output_price": 0.015,    # $15 por 1M tokens
        "recommended": False
    },
    "gpt-4-vision-preview": {
        "input_price": 0.01,      # $10 por 1M tokens
        "output_price": 0.03,     # $30 por 1M tokens
        "recommended": False
    }
}

def show_demo():
    """Muestra información de demostración y ejemplos de uso"""
    
    print("🧪 DEMO - ANALIZADOR DE DIAGRAMAS UML")
    print("=" * 50)
    print()
    
    print("💰 COMPARACIÓN DE MODELOS:")
    for model, config in MODEL_CONFIGS.items():
        total_cost = config['input_price'] + config['output_price']
        status = "✅ RECOMENDADO" if config['recommended'] else "  "
        print(f"   {model}: ${total_cost:.6f}/1K tokens {status}")
    print()
    
    print("📋 COMANDOS DE EJEMPLO:")
    print("   # Básico (recomendado)")
    print('   ./run_analyzer.sh "URL_IMAGEN" "sk-proj-TOKEN"')
    print()
    print("   # Con opciones")
    print('   ./run_analyzer.sh "URL_IMAGEN" "sk-proj-TOKEN" \\')
    print("     --model gpt-4o-mini --max-tokens 1000 --verbose")
    print()
    
    print("� ESTIMACIÓN PARA IMAGEN TÍPICA (800x600px):")
    print("   Tokens imagen: ~725")
    print("   Tokens prompt: ~200") 
    print("   Tokens respuesta: ~400")
    print("   Total: ~1325 tokens")
    print()
    print("   Con gpt-4o-mini: ~$0.0003 USD")
    print("   Con gpt-4o: ~$0.008 USD")
    print()
    
    print("🔗 FLUJO RECOMENDADO:")
    print("   1. Sube imagen → Demo Supabase Storage")
    print("   2. Copia URL → Botón '📋 URL'")  
    print("   3. Ejecuta → ./run_analyzer.sh 'URL' 'TOKEN'")
    print("   4. Usa JSON → Compatible con generadores")
    print()
    
    print("� EJEMPLO DE JSON RESULTADO:")
    example_result = {
        "success": True,
        "diagram": {
            "classes": [
                {
                    "name": "Usuario",
                    "attributes": [
                        {"name": "id", "type": "int", "visibility": "private"},
                        {"name": "email", "type": "String", "visibility": "private"}
                    ],
                    "methods": [
                        {"name": "getId", "returnType": "int", "parameters": [], "visibility": "public"},
                        {"name": "login", "returnType": "boolean", "parameters": ["String"], "visibility": "public"}
                    ]
                },
                {
                    "name": "Pedido", 
                    "attributes": [
                        {"name": "fecha", "type": "Date", "visibility": "private"},
                        {"name": "total", "type": "double", "visibility": "private"}
                    ],
                    "methods": [
                        {"name": "calcularTotal", "returnType": "double", "parameters": [], "visibility": "public"}
                    ]
                }
            ],
            "relationships": [
                {
                    "type": "association",
                    "source": "Usuario",
                    "target": "Pedido",
                    "multiplicity": "1..*"
                }
            ]
        },
        "usage": {
            "model": "gpt-4o-mini",
            "tokens": {"prompt": 925, "completion": 380, "total": 1305},
            "cost": {"input": 0.0001, "output": 0.0002, "total": 0.0003, "currency": "USD"}
        }
    }
    
    print(json.dumps(example_result, indent=2, ensure_ascii=False))
    print()
    print("🎯 ¡LISTO PARA USAR! Reemplaza URL_IMAGEN y sk-proj-TOKEN con tus datos reales.")

if __name__ == "__main__":
    show_demo()
#!/usr/bin/env python3
"""
Script para analizar diagramas de clases usando OpenAI Vision API
Convierte imágenes de diagramas UML a estructura JSON

Uso:
    python analyze_class_diagram.py <url_imagen> <openai_token> [--max-tokens <num>] [--model <modelo>]

Ejemplo:
    python analyze_class_diagram.py "https://example.com/diagram.png" "sk-..." --max-tokens 1000
"""

import argparse
import json
import requests
import sys
from typing import Dict, Any, Optional
import base64
from io import BytesIO
from PIL import Image

# Configuración de modelos y precios (USD por 1K tokens)
MODEL_CONFIGS = {
    "gpt-4o-mini": {
        "name": "gpt-4o-mini", 
        "input_price": 0.00015,  # $0.15 por 1M tokens
        "output_price": 0.0006,  # $0.60 por 1M tokens
        "max_tokens": 128000,
        "supports_vision": True
    },
    "gpt-4-vision-preview": {
        "name": "gpt-4-vision-preview",
        "input_price": 0.01,     # $10 por 1M tokens
        "output_price": 0.03,    # $30 por 1M tokens
        "max_tokens": 4096,
        "supports_vision": True
    },
    "gpt-4o": {
        "name": "gpt-4o",
        "input_price": 0.005,    # $5 por 1M tokens
        "output_price": 0.015,   # $15 por 1M tokens
        "max_tokens": 128000,
        "supports_vision": True
    }
}

def calculate_image_tokens(image_url: str) -> int:
    """
    Calcula tokens aproximados para una imagen según OpenAI
    Fórmula: (ancho * alto) / 750 tokens base + 85 tokens fijos
    """
    try:
        response = requests.get(image_url, timeout=30)
        response.raise_for_status()
        
        image = Image.open(BytesIO(response.content))
        width, height = image.size
        
        # Fórmula de OpenAI para calcular tokens de imagen
        base_tokens = 85  # Tokens fijos
        pixel_tokens = (width * height) / 750
        total_tokens = base_tokens + pixel_tokens
        
        print(f"📏 Dimensiones imagen: {width}x{height}")
        print(f"🔢 Tokens estimados para imagen: {int(total_tokens)}")
        
        return int(total_tokens)
    except Exception as e:
        print(f"⚠️ Error calculando tokens de imagen: {e}")
        return 1000  # Estimación conservadora

def create_analysis_prompt() -> str:
    """Crea el prompt optimizado para análisis de diagramas de clases"""
    return """Analiza este diagrama de clases UML y extrae ÚNICAMENTE la estructura en formato JSON válido.

RESPONDE SOLO CON EL JSON, sin explicaciones adicionales.

Formato requerido:
{
  "classes": [
    {
      "name": "NombreClase",
      "attributes": [
        {"name": "atributo", "type": "String", "visibility": "private"}
      ],
      "methods": [
        {"name": "metodo", "returnType": "void", "parameters": [], "visibility": "public"}
      ]
    }
  ],
  "relationships": [
    {
      "type": "association|inheritance|composition|aggregation",
      "source": "ClaseOrigen",
      "target": "ClaseDestino",
      "multiplicity": "1..*"
    }
  ]
}

Reglas:
- Visibilidad: "public", "private", "protected"
- Tipos comunes: "String", "int", "boolean", "double", "Date"
- Solo incluir clases y relaciones claramente visibles
- Si no hay métodos/atributos, usar array vacío []"""

def analyze_diagram(image_url: str, openai_token: str, model: str = "gpt-4o-mini", max_tokens: int = 1000) -> Dict[str, Any]:
    """
    Analiza un diagrama de clases usando OpenAI Vision API
    """
    if model not in MODEL_CONFIGS:
        raise ValueError(f"Modelo no soportado: {model}")
    
    config = MODEL_CONFIGS[model]
    if not config["supports_vision"]:
        raise ValueError(f"El modelo {model} no soporta análisis de imágenes")
    
    # Calcular tokens de imagen
    image_tokens = calculate_image_tokens(image_url)
    prompt_tokens = len(create_analysis_prompt().split()) * 1.3  # Estimación
    
    print(f"🤖 Usando modelo: {model}")
    print(f"📊 Tokens estimados - Imagen: {image_tokens}, Prompt: {int(prompt_tokens)}")
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {openai_token}"
    }
    
    payload = {
        "model": config["name"],
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": create_analysis_prompt()
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_url,
                            "detail": "high"
                        }
                    }
                ]
            }
        ],
        "max_tokens": min(max_tokens, config["max_tokens"]),
        "temperature": 0.1  # Más determinístico para JSON.
    }
    
    try:
        print("🚀 Enviando solicitud a OpenAI...")
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=60
        )
        
        response.raise_for_status()
        result = response.json()
        
        # Extraer información de tokens y costos
        usage = result.get("usage", {})
        prompt_tokens_used = usage.get("prompt_tokens", 0)
        completion_tokens_used = usage.get("completion_tokens", 0)
        total_tokens_used = usage.get("total_tokens", 0)
        
        # Calcular costos
        input_cost = (prompt_tokens_used / 1000) * config["input_price"]
        output_cost = (completion_tokens_used / 1000) * config["output_price"]
        total_cost = input_cost + output_cost
        
        print(f"✅ Análisis completado")
        print(f"🔢 Tokens usados - Entrada: {prompt_tokens_used}, Salida: {completion_tokens_used}, Total: {total_tokens_used}")
        print(f"💰 Costo estimado: ${total_cost:.6f} USD (Entrada: ${input_cost:.6f}, Salida: ${output_cost:.6f})")
        
        # Extraer contenido de respuesta
        content = result["choices"][0]["message"]["content"]
        
        # Intentar parsear JSON
        try:
            # Limpiar respuesta (remover markdown si existe)
            if content.startswith("```json"):
                content = content.replace("```json", "").replace("```", "").strip()
            elif content.startswith("```"):
                content = content.replace("```", "").strip()
            
            diagram_structure = json.loads(content)
            
            return {
                "success": True,
                "diagram": diagram_structure,
                "usage": {
                    "model": model,
                    "tokens": {
                        "prompt": prompt_tokens_used,
                        "completion": completion_tokens_used,
                        "total": total_tokens_used
                    },
                    "cost": {
                        "input": input_cost,
                        "output": output_cost,
                        "total": total_cost,
                        "currency": "USD"
                    }
                }
            }
            
        except json.JSONDecodeError as e:
            print(f"❌ Error parseando JSON: {e}")
            print(f"🔍 Respuesta recibida: {content[:500]}...")
            return {
                "success": False,
                "error": "Invalid JSON response",
                "raw_response": content,
                "usage": {
                    "tokens": {"total": total_tokens_used},
                    "cost": {"total": total_cost, "currency": "USD"}
                }
            }
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Error en solicitud HTTP: {e}")
        return {"success": False, "error": str(e)}
    except Exception as e:
        print(f"❌ Error inesperado: {e}")
        return {"success": False, "error": str(e)}

def validate_image_url(url: str) -> bool:
    """Valida que la URL sea accesible y contenga una imagen"""
    try:
        response = requests.head(url, timeout=10)
        content_type = response.headers.get('content-type', '')
        return response.status_code == 200 and content_type.startswith('image/')
    except:
        return False

def main():
    parser = argparse.ArgumentParser(
        description="Analiza diagramas de clases UML usando OpenAI Vision API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python analyze_class_diagram.py "https://example.com/diagram.png" "sk-..."
  python analyze_class_diagram.py "https://example.com/diagram.png" "sk-..." --model gpt-4o-mini --max-tokens 800
  
Modelos disponibles:
  - gpt-4o-mini (recomendado, más económico)
  - gpt-4o (mayor calidad)
  - gpt-4-vision-preview (legacy)
        """
    )
    
    parser.add_argument("image_url", help="URL de la imagen del diagrama de clases")
    parser.add_argument("openai_token", help="Token de API de OpenAI")
    parser.add_argument("--model", default="gpt-4o-mini", choices=list(MODEL_CONFIGS.keys()),
                       help="Modelo a utilizar (default: gpt-4o-mini)")
    parser.add_argument("--max-tokens", type=int, default=1000,
                       help="Máximo de tokens para la respuesta (default: 1000)")
    parser.add_argument("--output", "-o", help="Archivo donde guardar el resultado JSON")
    parser.add_argument("--verbose", "-v", action="store_true", help="Modo verboso")
    
    args = parser.parse_args()
    
    print("🔍 Analizador de Diagramas de Clases - OpenAI Vision")
    print("=" * 50)
    
    # Validar URL de imagen
    if not validate_image_url(args.image_url):
        print("❌ Error: URL de imagen no válida o inaccesible")
        sys.exit(1)
    
    print(f"✅ URL de imagen válida: {args.image_url}")
    
    # Mostrar información de precios
    config = MODEL_CONFIGS[args.model]
    print(f"💰 Precios del modelo {args.model}:")
    print(f"   - Entrada: ${config['input_price']:.6f}/1K tokens")
    print(f"   - Salida: ${config['output_price']:.6f}/1K tokens")
    print()
    
    # Realizar análisis
    result = analyze_diagram(
        image_url=args.image_url,
        openai_token=args.openai_token,
        model=args.model,
        max_tokens=args.max_tokens
    )
    
    # Guardar resultado
    output_file = args.output or f"diagram_analysis_{args.model}.json"
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    
    print(f"💾 Resultado guardado en: {output_file}")
    
    if result["success"]:
        diagram = result["diagram"]
        classes_count = len(diagram.get("classes", []))
        relationships_count = len(diagram.get("relationships", []))
        
        print(f"📊 Resumen del análisis:")
        print(f"   - Clases detectadas: {classes_count}")
        print(f"   - Relaciones detectadas: {relationships_count}")
        print(f"   - Costo total: ${result['usage']['cost']['total']:.6f} USD")
        
        if args.verbose:
            print("\n📋 Estructura detectada:")
            for cls in diagram.get("classes", []):
                print(f"   • {cls['name']}: {len(cls.get('attributes', []))} atributos, {len(cls.get('methods', []))} métodos")
    else:
        print(f"❌ Análisis falló: {result.get('error', 'Error desconocido')}")
        sys.exit(1)

if __name__ == "__main__":
    main()
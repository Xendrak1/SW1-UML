# Subir el proyecto a GitHub

El repositorio destino es <https://github.com/Xendrak1/SW1-UML>, que está vacío.

## Antes que nada: verificá que no suba ningún secreto

Este proyecto ya tuvo una clave de OpenAI publicada por accidente una vez. El
`.gitignore` ya excluye `server/.env` y `uml-board/.env`, pero conviene
comprobarlo con los ojos, no confiar:

```powershell
cd "C:\Users\Eduardo\Documents\UAGRM\2-2026\S21\Proyecto SW1\proyecto-software-1-main\proyecto-software-1-main"
git init
git add -A
git status --short | Select-String "\.env"
```

Ese último comando **no debe devolver nada** salvo los `.env.example`. Si aparece
`server/.env` o `uml-board/.env`, parás ahí y me avisás.

## Subirlo

```powershell
git config user.name "Eduardo Rodriguez"
git config user.email "jrseduardo1@gmail.com"
git commit -m "Herramienta CASE colaborativa con IA local y en la nube"
git branch -M main
git remote add origin https://github.com/Xendrak1/SW1-UML.git
git push -u origin main
```

En PowerShell los comandos van de a uno: `&&` no funciona como separador.

## Qué queda fuera, y por qué

El `.gitignore` excluye:

| Qué | Por qué |
| --- | --- |
| `node_modules/` | Se reconstruye con `npm install`. Son cientos de megas. |
| `server/.env`, `uml-board/.env` | Secretos. Solo se versionan los `.example`. |
| `server/uploads/` | Imágenes subidas en tiempo de ejecución, no código. |
| `dist/`, `build/` | Salidas de compilación. |
| `Claude outputs/` | Capturas de trabajo, no forman parte del proyecto. |

Además conviene borrar `README-1.md` de la raíz: es una copia suelta de
`docs/ea/README.md` que quedó de una descarga.

## Si preferís que lo suba yo

Puedo hacer el push directo si autorizás el repositorio en las fuentes de esta
sesión. Sin esa autorización el proxy no me inyecta credenciales para
`Xendrak1/SW1-UML` y el push da 403.

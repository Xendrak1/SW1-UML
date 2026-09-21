# Despliegue en Google Cloud

Un solo servicio de Cloud Run sirve la API y el frontend, y una instancia de
Cloud SQL guarda los datos.

## Por qué un solo servicio

Con el frontend en otro origen habría que configurar CORS con credenciales y un
WebSocket cruzado: dos cosas más que pueden fallar. Con un solo dominio no hay
nada de eso, y Cloud Run soporta WebSocket sobre el mismo servicio sin
configuración extra. El `Dockerfile` compila el frontend, compila el servidor y
deja al servidor sirviendo los dos.

## Pasos

```bash
gcloud auth login
bash deploy/desplegar-gcp.sh
```

El script es idempotente: si la instancia o la base ya existen, las reutiliza.
Al terminar imprime la URL y el **código de registro**.

Las contraseñas se generan solas y quedan en Secret Manager, no en el
repositorio ni en el historial de la terminal:

| Secreto | Para qué |
| --- | --- |
| `case-db-password` | Contraseña de `case_user` en PostgreSQL |
| `case-auth-secret` | Firma de los tokens de sesión |
| `case-registro-codigo` | Código que hay que escribir para crear una cuenta |

Para leerlos después:

```bash
gcloud secrets versions access latest --secret=case-registro-codigo
```

## Cómo se crean los usuarios

No hay usuarios precargados: **cada persona se registra sola** desde la pantalla
de acceso. La primera que entre a una pizarra queda como su anfitrión.

Con `REGISTRO_CODIGO` definido (el script lo define), el formulario pide además
un código compartido. Eso es lo que evita que cualquiera que encuentre la URL en
internet se cree una cuenta, sin tener que dar de alta a nadie a mano. Se lo
pasás a tu equipo y listo; después de registrarse, cada uno entra con su correo
y su contraseña, sin código.

Para abrir el registro a cualquiera, borrá esa variable:

```bash
gcloud run services update sw1-uml --region us-central1 --remove-env-vars REGISTRO_CODIGO
```

Para cambiar el código:

```bash
printf 'nuevo-codigo' | gcloud secrets versions add case-registro-codigo --data-file=-
gcloud run services update sw1-uml --region us-central1 \
  --set-secrets REGISTRO_CODIGO=case-registro-codigo:latest
```

## Dos consecuencias de estar en la nube

**No hay Ollama.** El servidor desplegado no tiene un modelo local al lado, así
que el script deja `AI_STRATEGY=cloud`. Para que el asistente funcione hay que
poner una clave de OpenAI:

```bash
gcloud run services update sw1-uml --region us-central1 \
  --set-env-vars OPENAI_API_KEY=tu-clave
```

Esto no contradice el requisito de IA local: la IA local es la del escritorio
(Ollama en la máquina del ingeniero) y la del teléfono (el intérprete
on-device, que sigue funcionando sin internet). Lo que no puede ser local es el
servidor compartido, por definición.

**Las imágenes subidas no persisten.** El sistema de archivos de Cloud Run es
efímero y se pierde en cada reinicio o al escalar a más de una instancia. Para
la demostración alcanza; para uso real, las subidas tendrían que ir a un bucket
de Cloud Storage. Está anotado como pendiente.

## Costo

`db-f1-micro` es la instancia más barata de Cloud SQL, y aun así es lo único que
cuesta de verdad: alrededor de 8 a 10 dólares al mes si queda encendida. Cloud
Run, con este uso, entra en la capa gratuita. Para no gastar de más:

```bash
gcloud sql instances patch case-uml-db --activation-policy NEVER   # apagar
gcloud sql instances patch case-uml-db --activation-policy ALWAYS  # encender
```

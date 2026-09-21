// Simulador de la API de Ollama, para probar la capa de IA sin el modelo real.
// Replica el contrato documentado: GET /api/tags y POST /api/chat.
import { createServer } from 'node:http';

let escenario = 'ok';
// Modelos que el simulador dice tener descargados. El test los cambia para
// reproducir el caso real: el de texto esta y el de vision no.
let instalados = ['qwen2.5:7b-instruct', 'llama3.2-vision:11b'];
let ultimaPeticion = null;
let llamadas = 0;


/** Que etapa del modo dominio esta pidiendo el servidor. */
const etapa = (p) => {
  const sys = p?.messages?.[0]?.content ?? '';
  if (/devuelves las relaciones/i.test(sys)) return 'relaciones';
  if (/devuelves LAS CLASES/i.test(sys)) return 'clases';
  return 'atomico';
};

const RESPUESTAS = {
  // Caso ideal
  ok: () => JSON.stringify({ actions: [ { type:'create', target:'class', data:{ label:'Mascota', attributes:[{name:'nombre',datatype:'String',scope:'private'},{name:'edad',datatype:'Integer',scope:'private'}] } } ] }),
  // Envuelto en markdown, muy comun en modelos chicos
  markdown: () => '```json\n' + JSON.stringify({ actions: [ { type:'create', target:'class', data:{ label:'Dueno', attributes:[{name:'telefono',datatype:'String',scope:'private'}] } } ] }, null, 2) + '\n```',
  // Con prosa alrededor
  prosa: () => 'Claro, entiendo. Aqui estan las acciones:\n' + JSON.stringify({ actions: [ { type:'create', target:'class', data:{ label:'Consulta', attributes:[] } } ] }) + '\nEspero que te sirva.',
  // Array pelado en vez del objeto
  array: () => JSON.stringify([ { type:'create', target:'class', data:{ label:'Veterinario', attributes:[] } } ]),
  // Valores fuera del dominio: tipos y multiplicidades inventadas
  sucio: () => JSON.stringify({ actions: [
    { type:'create', target:'class', data:{ label:'Factura', attributes:[
        {name:'id',datatype:'long',scope:'-'},
        {name:'total',datatype:'decimal',scope:'+'},
        {name:'fecha',datatype:'datetime'},
        {name:'total',datatype:'Float',scope:'private'},
        {name:'',datatype:'String'} ] } },
    { type:'create', target:'edge', data:{ sourceLabel:'Factura', targetLabel:'Cliente', tipo:'Association', multiplicidadOrigen:'0..*', multiplicidadDestino:'1..*' } },
  ]}),
  // Relación muchos a muchos directa, que el modelo relacional no admite
  mn_directo: () => JSON.stringify({ actions: [
    { type:'create', target:'edge', data:{ sourceLabel:'Medico', targetLabel:'Paciente', tipo:'asociacion', multiplicidadOrigen:'*', multiplicidadDestino:'*' } } ]}),
  // Clase asociativa bien formada
  mn_bien: () => JSON.stringify({ actions: [
    { type:'create', target:'class', data:{ label:'Atencion', attributes:[{name:'fecha',datatype:'Date',scope:'private'}], asociativa:true, relaciona:['Medico','Paciente'] } },
    { type:'create', target:'edge', data:{ sourceLabel:'Medico', targetLabel:'Atencion', tipo:'asociacion', multiplicidadOrigen:'1', multiplicidadDestino:'*' } },
    { type:'create', target:'edge', data:{ sourceLabel:'Paciente', targetLabel:'Atencion', tipo:'asociacion', multiplicidadOrigen:'1', multiplicidadDestino:'*' } } ]}),
  // Clase asociativa sin sus dos extremos
  asociativa_incompleta: () => JSON.stringify({ actions: [
    { type:'create', target:'class', data:{ label:'Intermedia', attributes:[], asociativa:true, relaciona:['Medico'] } } ]}),
  // Aristas antes que las clases: el orden debe corregirse
  orden_invertido: () => JSON.stringify({ actions: [
    { type:'create', target:'edge', data:{ sourceLabel:'Pedido', targetLabel:'Detalle', tipo:'composicion', multiplicidadOrigen:'1', multiplicidadDestino:'*' } },
    { type:'create', target:'class', data:{ label:'Pedido', attributes:[] } },
    { type:'create', target:'class', data:{ label:'Detalle', attributes:[] } } ]}),
  // Herencia con multiplicidades, que en UML no corresponde
  herencia_con_mult: () => JSON.stringify({ actions: [
    { type:'create', target:'edge', data:{ sourceLabel:'Auto', targetLabel:'Vehiculo', tipo:'herencia', multiplicidadOrigen:'*', multiplicidadDestino:'*' } } ]}),
  // Acciones inventadas que no existen en el contrato
  inventado: () => JSON.stringify({ actions: [
    { type:'refactor', target:'diagram', data:{} },
    { type:'create', target:'method', data:{ name:'calcular' } },
    { type:'create', target:'class', data:{ label:'Valida', attributes:[] } } ]}),
  // Las dos clases que la relacion muchos a muchos va a referenciar
  dos_clases: () => JSON.stringify({ actions: [
    { type:'create', target:'class', data:{ label:'Medico', attributes:[{name:'matricula',datatype:'String',scope:'private'}] } },
    { type:'create', target:'class', data:{ label:'Paciente', attributes:[{name:'nombre',datatype:'String',scope:'private'}] } } ]}),
  // Modelo de dominio completo, en dos etapas. La respuesta depende de que
  // etapa pidio el servidor, igual que haria el modelo real.
  dominio: (p) => etapa(p) === 'relaciones' ? "{\"relations\": [{\"sourceLabel\": \"Tienda\", \"targetLabel\": \"Empleado\", \"tipo\": \"agregacion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"*\"}, {\"sourceLabel\": \"Tienda\", \"targetLabel\": \"Pedido\", \"tipo\": \"asociacion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"*\"}, {\"sourceLabel\": \"Cliente\", \"targetLabel\": \"Pedido\", \"tipo\": \"asociacion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"*\"}, {\"sourceLabel\": \"Cliente\", \"targetLabel\": \"TarjetaFidelidad\", \"tipo\": \"composicion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"1\"}, {\"sourceLabel\": \"Categoria\", \"targetLabel\": \"Producto\", \"tipo\": \"asociacion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"*\"}, {\"sourceLabel\": \"Empleado\", \"targetLabel\": \"Pedido\", \"tipo\": \"asociacion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"*\"}, {\"sourceLabel\": \"Pedido\", \"targetLabel\": \"Pago\", \"tipo\": \"composicion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"1\"}, {\"sourceLabel\": \"Proveedor\", \"targetLabel\": \"Ingrediente\", \"tipo\": \"asociacion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"*\"}, {\"sourceLabel\": \"Pedido\", \"targetLabel\": \"DetallePedido\", \"tipo\": \"asociacion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"*\"}, {\"sourceLabel\": \"Producto\", \"targetLabel\": \"DetallePedido\", \"tipo\": \"asociacion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"*\"}, {\"sourceLabel\": \"Producto\", \"targetLabel\": \"Receta\", \"tipo\": \"asociacion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"*\"}, {\"sourceLabel\": \"Ingrediente\", \"targetLabel\": \"Receta\", \"tipo\": \"asociacion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"*\"}, {\"sourceLabel\": \"Pedido\", \"targetLabel\": \"Sucursal\", \"tipo\": \"asociacion\", \"multiplicidadOrigen\": \"1\", \"multiplicidadDestino\": \"*\"}]}" : "{\"classes\": [{\"label\": \"Tienda\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"direccion\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"telefono\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Empleado\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"cargo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"fechaIngreso\", \"datatype\": \"Date\", \"scope\": \"private\"}]}, {\"label\": \"Cliente\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"correo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"telefono\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"TarjetaFidelidad\", \"asociativa\": false, \"attributes\": [{\"name\": \"codigo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"puntos\", \"datatype\": \"Integer\", \"scope\": \"private\"}]}, {\"label\": \"Categoria\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"descripcion\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Producto\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"precio\", \"datatype\": \"Float\", \"scope\": \"private\"}, {\"name\": \"tamano\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Ingrediente\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"stock\", \"datatype\": \"Float\", \"scope\": \"private\"}, {\"name\": \"unidad\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Proveedor\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"contacto\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Pedido\", \"asociativa\": false, \"attributes\": [{\"name\": \"fecha\", \"datatype\": \"Date\", \"scope\": \"private\"}, {\"name\": \"estado\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"total\", \"datatype\": \"Float\", \"scope\": \"private\"}]}, {\"label\": \"Pago\", \"asociativa\": false, \"attributes\": [{\"name\": \"metodo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"monto\", \"datatype\": \"Float\", \"scope\": \"private\"}]}, {\"label\": \"DetallePedido\", \"asociativa\": true, \"relaciona\": [\"Pedido\", \"Producto\"], \"attributes\": [{\"name\": \"cantidad\", \"datatype\": \"Integer\", \"scope\": \"private\"}, {\"name\": \"precioUnitario\", \"datatype\": \"Float\", \"scope\": \"private\"}]}, {\"label\": \"Receta\", \"asociativa\": true, \"relaciona\": [\"Producto\", \"Ingrediente\"], \"attributes\": [{\"name\": \"cantidad\", \"datatype\": \"Float\", \"scope\": \"private\"}]}]}",
  // La etapa 1 devuelve menos clases que el minimo: debe pedir las que faltan.
  dominio_corto: (p) => etapa(p) === 'relaciones' ? "{\"relations\":[]}"
    : (llamadas === 1 ? "{\"classes\": [{\"label\": \"Tienda\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"direccion\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"telefono\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Empleado\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"cargo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"fechaIngreso\", \"datatype\": \"Date\", \"scope\": \"private\"}]}, {\"label\": \"Cliente\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"correo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"telefono\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"TarjetaFidelidad\", \"asociativa\": false, \"attributes\": [{\"name\": \"codigo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"puntos\", \"datatype\": \"Integer\", \"scope\": \"private\"}]}]}" : "{\"classes\": [{\"label\": \"Categoria\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"descripcion\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Producto\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"precio\", \"datatype\": \"Float\", \"scope\": \"private\"}, {\"name\": \"tamano\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Ingrediente\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"stock\", \"datatype\": \"Float\", \"scope\": \"private\"}, {\"name\": \"unidad\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Proveedor\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"contacto\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Pedido\", \"asociativa\": false, \"attributes\": [{\"name\": \"fecha\", \"datatype\": \"Date\", \"scope\": \"private\"}, {\"name\": \"estado\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"total\", \"datatype\": \"Float\", \"scope\": \"private\"}]}]}"),
  // La etapa 1 se corta a mitad del JSON.
  truncado: (p) => etapa(p) === 'relaciones' ? '{"relations":[]}' : "{\"classes\": [{\"label\": \"Tienda\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"direccion\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"telefono\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Empleado\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"cargo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"fechaIngreso\", \"datatype\": \"Date\", \"scope\": \"private\"}]}, {\"label\": \"Cliente\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"correo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"telefono\", \"datatype\": \"String\", \"scope\": \"private\"}]},{\"label\":\"Prest",
  // La etapa 2 se rompe: el servidor debe devolver igual las clases.
  relaciones_roto: (p) => etapa(p) === 'relaciones' ? 'No puedo generar las relaciones.' : "{\"classes\": [{\"label\": \"Tienda\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"direccion\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"telefono\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Empleado\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"cargo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"fechaIngreso\", \"datatype\": \"Date\", \"scope\": \"private\"}]}, {\"label\": \"Cliente\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"correo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"telefono\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"TarjetaFidelidad\", \"asociativa\": false, \"attributes\": [{\"name\": \"codigo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"puntos\", \"datatype\": \"Integer\", \"scope\": \"private\"}]}, {\"label\": \"Categoria\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"descripcion\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Producto\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"precio\", \"datatype\": \"Float\", \"scope\": \"private\"}, {\"name\": \"tamano\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Ingrediente\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"stock\", \"datatype\": \"Float\", \"scope\": \"private\"}, {\"name\": \"unidad\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Proveedor\", \"asociativa\": false, \"attributes\": [{\"name\": \"nombre\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"contacto\", \"datatype\": \"String\", \"scope\": \"private\"}]}, {\"label\": \"Pedido\", \"asociativa\": false, \"attributes\": [{\"name\": \"fecha\", \"datatype\": \"Date\", \"scope\": \"private\"}, {\"name\": \"estado\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"total\", \"datatype\": \"Float\", \"scope\": \"private\"}]}, {\"label\": \"Pago\", \"asociativa\": false, \"attributes\": [{\"name\": \"metodo\", \"datatype\": \"String\", \"scope\": \"private\"}, {\"name\": \"monto\", \"datatype\": \"Float\", \"scope\": \"private\"}]}, {\"label\": \"DetallePedido\", \"asociativa\": true, \"relaciona\": [\"Pedido\", \"Producto\"], \"attributes\": [{\"name\": \"cantidad\", \"datatype\": \"Integer\", \"scope\": \"private\"}, {\"name\": \"precioUnitario\", \"datatype\": \"Float\", \"scope\": \"private\"}]}, {\"label\": \"Receta\", \"asociativa\": true, \"relaciona\": [\"Producto\", \"Ingrediente\"], \"attributes\": [{\"name\": \"cantidad\", \"datatype\": \"Float\", \"scope\": \"private\"}]}]}",
  // Instrucción sin cambios
  vacio: () => JSON.stringify({ actions: [] }),
  // Basura total: debe activar el reintento de reparación
  roto: () => llamadas === 1
    ? 'No puedo hacer eso porque el diagrama no tiene la clase pedida, lo siento mucho.'
    : JSON.stringify({ actions: [] }),
  // Roto y la reparación también falla
  roto_total: () => 'Lo siento, no entiendo la instruccion solicitada.',
  // Respuesta vacía
  vacia_total: () => '',
  // La guía de usuario
  ask: () => JSON.stringify({ answer: 'Para generar el backend, entra al menu Generar y elegi Backend Spring Boot.' }),
  // Reconocimiento de imagen
  imagen: () => JSON.stringify({
    classes: [
      { label:'Mascota', attributes:[{name:'nombre',datatype:'texto',scope:'-'}], asociativa:false },
      { label:'Dueno', attributes:[{name:'telefono',datatype:'String',scope:'private'}], asociativa:false },
      { label:'Mascota', attributes:[], asociativa:false },
      { label:'', attributes:[] } ],
    relations: [
      { sourceLabel:'Dueno', targetLabel:'Mascota', tipo:'rombo lleno', multiplicidadOrigen:'1', multiplicidadDestino:'n' },
      { sourceLabel:'Dueno', targetLabel:'Fantasma', tipo:'asociacion', multiplicidadOrigen:'1', multiplicidadDestino:'1' },
      { sourceLabel:'Dueno', targetLabel:'Dueno', tipo:'asociacion' } ]}),
};

const server = createServer((req, res) => {
  if (req.url === '/api/tags' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ models: instalados.map(name => ({ name, size: 4700000000 })) }));
    return;
  }
  if (req.url === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      llamadas += 1;
      ultimaPeticion = JSON.parse(body);
      // El modelo "no encontrado" se simula con un 404, como hace Ollama de verdad
      if (escenario === 'modelo_inexistente') {
        res.writeHead(404, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: 'model "qwen2.5:7b-instruct" not found, try pulling it first' }));
        return;
      }
      const fn = RESPUESTAS[escenario] ?? RESPUESTAS.ok;
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ model: ultimaPeticion.model, message: { role:'assistant', content: fn(ultimaPeticion) }, done: true }));
    });
    return;
  }
  // Endpoints de control del simulador
  if (req.url.startsWith('/_set/')) {
    escenario = req.url.slice('/_set/'.length);
    llamadas = 0;
    res.writeHead(200); res.end(escenario); return;
  }
  if (req.url.startsWith('/_tags/')) {
    const csv = decodeURIComponent(req.url.slice('/_tags/'.length));
    instalados = csv === '' ? [] : csv.split(',');
    res.writeHead(200); res.end(instalados.join(',')); return;
  }
  if (req.url === '/_last') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ ultimaPeticion, llamadas })); return;
  }
  res.writeHead(404); res.end();
});
server.listen(11434, '127.0.0.1', () => console.log('mock ollama en 11434'));

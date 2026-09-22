// El relevo: el navegador conduce el flujo de IA para poder usar el Ollama que
// corre en la maquina del usuario, al que el servidor de la nube no llega.
//
// Lo que importa verificar es que el servidor sigue mandando: el decide que
// prompt se usa, cuantas etapas hay y que se acepta de la respuesta. El
// navegador solo lleva texto. Por eso el test hace de navegador tonto y contesta
// lo que un modelo contestaria, incluido JSON roto y JSON cortado a la mitad.
const API = 'http://localhost:4000';

let ok = 0;
let fail = 0;
const check = (n, cond, d = '') => {
  if (cond) {
    ok++;
    console.log(`  OK   ${n}`);
  } else {
    fail++;
    console.log(`  FALLA ${n} ${d}`);
  }
};

const pedir = (metodo, ruta, { body, token } = {}) =>
  fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const unico = () => Math.random().toString(36).slice(2, 10);
const CODIGO = process.env.REGISTRO_CODIGO_TEST ?? 'SECRETO-DE-PRUEBA';

async function usuario() {
  const r = await pedir('POST', '/api/auth/registro', {
    body: {
      correo: `u${unico()}@ejemplo.com`,
      nombre: 'Modelador de Prueba',
      password: 'contrasena-larga-1',
      codigo: CODIGO,
    },
  });
  return r.body.token;
}

const token = await usuario();

console.log('=== 1) Instruccion puntual: una sola ida y vuelta ===');
const uno = await pedir('POST', '/api/ai/relevo/iniciar', {
  token,
  body: { tipo: 'acciones', prompt: 'agrega la clase Cliente con nombre y correo' },
});
check('el servidor entrega la primera peticion', uno.status === 200, uno.status);
check('con el prompt de sistema', typeof uno.body.peticion?.system === 'string' && uno.body.peticion.system.length > 50);
check('y la instruccion adentro del prompt de usuario', /Cliente/.test(uno.body.peticion?.user ?? ''));
check('y una sesion para seguir', typeof uno.body.sesion === 'string');

const fin = await pedir('POST', '/api/ai/relevo/paso', {
  token,
  body: {
    sesion: uno.body.sesion,
    texto: JSON.stringify({
      actions: [
        {
          type: 'create',
          target: 'class',
          data: {
            label: 'Cliente',
            attributes: [
              { name: 'nombre', datatype: 'String' },
              { name: 'correo', datatype: 'String' },
            ],
          },
        },
      ],
    }),
  },
});
check('el flujo termina en un paso', fin.body.listo === true, JSON.stringify(fin.body).slice(0, 120));
check('y devuelve la accion validada', (fin.body.actions ?? []).length === 1, JSON.stringify(fin.body.actions));
check('marcada como modo atomico', fin.body.modo === 'atomico', fin.body.modo);
check(
  'el proveedor dice que respondio el navegador',
  fin.body.provider === 'ollama-navegador',
  fin.body.provider
);

console.log('\n=== 2) Modelo de dominio: varias etapas, conducidas desde afuera ===');
const dom = await pedir('POST', '/api/ai/relevo/iniciar', {
  token,
  body: { tipo: 'acciones', prompt: 'modela el dominio completo de una cafeteria, al menos 4 clases' },
});
check('arranca pidiendo las clases', /clase/i.test(dom.body.peticion?.system ?? ''));
check('con ventana de contexto grande', dom.body.peticion?.numCtx === 12288, dom.body.peticion?.numCtx);

// Hace de navegador: mira que le pidieron y contesta lo que contestaria un
// modelo. Cuantas etapas hay lo decide el servidor, no el test: si manana se
// agrega una, esto sigue funcionando.
const clases = ['Cliente', 'Pedido', 'Producto', 'Empleado'];
const pedidas = [];
let paso = dom.body;
let vueltas = 0;
while (!paso.listo && vueltas < 6) {
  vueltas += 1;
  const esRelaciones = /relaciones entre ellas/i.test(paso.peticion.system);
  pedidas.push(esRelaciones ? 'relaciones' : 'clases');
  const respuesta = esRelaciones
    ? {
        relations: [
          { sourceLabel: 'Cliente', targetLabel: 'Pedido', tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
          // Una relacion que nombra una clase que no existe: el servidor la tira.
          { sourceLabel: 'Cliente', targetLabel: 'Proveedor', tipo: 'asociacion' },
        ],
      }
    : {
        classes: clases.map(label => ({
          label,
          attributes: [{ name: 'nombre', datatype: 'String' }],
        })),
      };
  const r = await pedir('POST', '/api/ai/relevo/paso', {
    token,
    body: { sesion: dom.body.sesion, texto: JSON.stringify(respuesta) },
  });
  paso = r.body;
}

check('el servidor pide primero las clases', pedidas[0] === 'clases', pedidas.join(','));
check('y termina pidiendo las relaciones', pedidas[pedidas.length - 1] === 'relaciones', pedidas.join(','));
check('el flujo termina solo', paso.listo === true, JSON.stringify(paso).slice(0, 120));
check('marcado como modo dominio', paso.modo === 'dominio', paso.modo);
check('con las cuatro clases, sin duplicar las de la etapa de completado',
  (paso.actions ?? []).filter(a => a.target === 'class').length === 4,
  (paso.actions ?? []).filter(a => a.target === 'class').length);
check('y una sola relacion, la valida', (paso.actions ?? []).filter(a => a.target === 'edge').length === 1);
check(
  'la relacion a una clase inexistente queda registrada en las etapas',
  (paso.etapas ?? []).some(e => e.startsWith('relaciones_fuera_de_lista')),
  JSON.stringify(paso.etapas)
);

console.log('\n=== 3) Respuesta rota: el servidor pide reparacion, no se rinde ===');
const roto = await pedir('POST', '/api/ai/relevo/iniciar', {
  token,
  body: { tipo: 'acciones', prompt: 'agrega la clase Factura' },
});
const pideReparar = await pedir('POST', '/api/ai/relevo/paso', {
  token,
  body: { sesion: roto.body.sesion, texto: 'esto no es JSON ni de cerca' },
});
check('pide otra vuelta', Boolean(pideReparar.body.peticion), JSON.stringify(pideReparar.body).slice(0, 100));
check(
  'y le manda la salida rota para que la arregle',
  (pideReparar.body.peticion?.user ?? '').includes('esto no es JSON')
);
const reparado = await pedir('POST', '/api/ai/relevo/paso', {
  token,
  body: {
    sesion: roto.body.sesion,
    texto: JSON.stringify({ actions: [{ type: 'create', target: 'class', data: { label: 'Factura' } }] }),
  },
});
check('y con la reparacion termina bien', reparado.body.listo === true && reparado.body.reparado === true);

console.log('\n=== 4) Respuesta cortada: se rescata sin gastar otra llamada ===');
const cortado = await pedir('POST', '/api/ai/relevo/iniciar', {
  token,
  body: { tipo: 'acciones', prompt: 'agrega las clases Pago y Envio' },
});
const rescate = await pedir('POST', '/api/ai/relevo/paso', {
  token,
  body: {
    sesion: cortado.body.sesion,
    // JSON truncado: la primera accion esta completa, la segunda se corta.
    texto: '{"actions":[{"type":"create","target":"class","data":{"label":"Pago"}},{"type":"create","target":"clas',
  },
});
check('termina sin pedir reparacion', rescate.body.listo === true, JSON.stringify(rescate.body).slice(0, 120));
check('marcado como rescatado', rescate.body.rescatado === true);
check('con la accion que si estaba completa', (rescate.body.actions ?? []).length === 1);

console.log('\n=== 5) Las sesiones son de quien las abrio ===');
const otro = await usuario();
const ajena = await pedir('POST', '/api/ai/relevo/iniciar', {
  token,
  body: { tipo: 'acciones', prompt: 'agrega la clase Secreta' },
});
const intento = await pedir('POST', '/api/ai/relevo/paso', {
  token: otro,
  body: { sesion: ajena.body.sesion, texto: '{"actions":[]}' },
});
check('otro usuario no puede continuar una sesion ajena', intento.status === 403, intento.status);
const inventada = await pedir('POST', '/api/ai/relevo/paso', {
  token,
  body: { sesion: 'no-existe', texto: '{"actions":[]}' },
});
check('una sesion inexistente da 404 con mensaje claro', inventada.status === 404, inventada.status);
check('que le dice al usuario que reintente', /volve a intentar/i.test(inventada.body.error ?? ''));

console.log('\n=== 6) La guia tambien se puede contestar desde el navegador ===');
const guia = await pedir('POST', '/api/ai/relevo/iniciar', {
  token,
  body: { tipo: 'pregunta', question: 'como exporto a XMI?', context: 'Para exportar usa el menu Archivo.' },
});
check('entrega el prompt con la documentacion', /menu Archivo/.test(guia.body.peticion?.user ?? ''));
const respGuia = await pedir('POST', '/api/ai/relevo/paso', {
  token,
  body: { sesion: guia.body.sesion, texto: JSON.stringify({ answer: 'Con el menu Archivo.' }) },
});
check('y devuelve la respuesta', respGuia.body.answer === 'Con el menu Archivo.', respGuia.body.answer);

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok + fail} ===`);
process.exit(fail === 0 ? 0 : 1);

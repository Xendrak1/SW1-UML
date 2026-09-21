/**
 * Reconocimiento y sintesis de voz.
 *
 * El reconocimiento ocurre EN EL DISPOSITIVO a traves de la Web Speech API, que en
 * Android e iOS usa el motor de voz del sistema. Eso es lo que pide el enunciado:
 * la app local hace el reconocimiento y entrega el texto; el contexto y la
 * interpretacion los resuelve la capa de IA.
 */

// La API no esta en los tipos estandar de TypeScript.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRecognition = any;

export const speechDisponible = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export interface DictadoHandlers {
  onParcial: (texto: string) => void;
  onFinal: (texto: string) => void;
  onError: (mensaje: string) => void;
  onFin: () => void;
}

const MENSAJES_ERROR: Record<string, string> = {
  'not-allowed': 'Permiso de micrófono denegado. Habilitalo en los ajustes del navegador.',
  'service-not-allowed': 'El navegador bloqueó el servicio de voz.',
  'no-speech': 'No se escuchó nada. Probá de nuevo.',
  'audio-capture': 'No se encontró micrófono.',
  network: 'El motor de voz necesita conexión en este dispositivo.',
  aborted: '',
};

/** Crea una sesion de dictado. Devuelve una funcion para detenerla. */
export function iniciarDictado(handlers: DictadoHandlers, continuo = false): () => void {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    handlers.onError('Este navegador no soporta reconocimiento de voz.');
    return () => undefined;
  }

  const recognition: AnyRecognition = new Ctor();
  recognition.lang = 'es-BO';
  recognition.continuous = continuo;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event: any) => {
    let parcial = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const resultado = event.results[i];
      if (resultado.isFinal) {
        const texto = String(resultado[0].transcript).trim();
        if (texto) handlers.onFinal(texto);
      } else {
        parcial += resultado[0].transcript;
      }
    }
    if (parcial.trim()) handlers.onParcial(parcial.trim());
  };

  recognition.onerror = (event: any) => {
    const mensaje = MENSAJES_ERROR[event.error] ?? `Error de reconocimiento: ${event.error}`;
    if (mensaje) handlers.onError(mensaje);
  };

  recognition.onend = () => handlers.onFin();

  try {
    recognition.start();
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : 'No se pudo iniciar el micrófono');
  }

  return () => {
    try {
      recognition.stop();
    } catch {
      /* ya estaba detenido */
    }
  };
}

/** Respuesta hablada: es la unica salida de la app movil, que no tiene interfaz grafica. */
export function hablar(texto: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(texto);
  utterance.lang = 'es-ES';
  utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance);
}

export function callar(): void {
  window.speechSynthesis?.cancel();
}

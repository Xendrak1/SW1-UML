import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

/**
 * Reconocimiento y sintesis de voz.
 *
 * El reconocimiento ocurre EN EL DISPOSITIVO.
 * - En Capacitor (app móvil), usa el motor nativo vía plugins.
 * - En la web (PWA), usa la Web Speech API estandar.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRecognition = any;

export const speechDisponible = (): boolean => {
  if (Capacitor.isNativePlatform()) return true;
  return typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
};

export interface DictadoHandlers {
  onParcial: (texto: string) => void;
  onFinal: (texto: string) => void;
  onError: (mensaje: string) => void;
  onFin: () => void;
}

const MENSAJES_ERROR: Record<string, string> = {
  'not-allowed': 'Permiso de micrófono denegado. Habilítalo en los ajustes.',
  'service-not-allowed': 'El sistema bloqueó el servicio de voz.',
  'no-speech': 'No se escuchó nada. Probá de nuevo.',
  'audio-capture': 'No se encontró micrófono.',
  network: 'El motor de voz necesita conexión en este dispositivo.',
  aborted: '',
};

let capListenerRemover: any = null;

export function iniciarDictado(handlers: DictadoHandlers, continuo = false): () => void {
  if (Capacitor.isNativePlatform()) {
    // Implementacion Capacitor (App Movil)
    let isStopped = false;
    
    const startCapacitor = async () => {
      try {
        const hasPermission = await SpeechRecognition.checkPermissions();
        if (hasPermission.speechRecognition !== 'granted') {
          const requested = await SpeechRecognition.requestPermissions();
          if (requested.speechRecognition !== 'granted') {
            handlers.onError('Permiso de micrófono denegado');
            return;
          }
        }
        
        if (capListenerRemover) capListenerRemover.remove();
        capListenerRemover = await SpeechRecognition.addListener('partialResults', (data: any) => {
          if (data.matches && data.matches.length > 0) {
            handlers.onParcial(data.matches[0]);
          }
        });

        await SpeechRecognition.start({
          language: 'es-ES',
          partialResults: true,
          popup: false,
        });

        // Simulamos un onFin despues de un tiempo o cuando se detiene, porque el plugin
        // a veces no lanza el evento cuando el usuario deja de hablar.
        setTimeout(() => {
          if (!isStopped) detener();
        }, 8000);

      } catch (e) {
        handlers.onError('Error en SpeechRecognition: ' + (e as Error).message);
      }
    };

    const detener = async () => {
      if (isStopped) return;
      isStopped = true;
      try {
        await SpeechRecognition.stop();
        if (capListenerRemover) {
          capListenerRemover.remove();
          capListenerRemover = null;
        }
        handlers.onFin();
      } catch (e) {
        // ignorar
      }
    };

    startCapacitor();
    return detener;
  }

  // Implementacion Web (PWA/Browser)
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

export function hablar(texto: string): void {
  if (Capacitor.isNativePlatform()) {
    TextToSpeech.speak({
      text: texto,
      lang: 'es-ES',
      rate: 1.05,
      pitch: 1.0,
      category: 'ambient',
    }).catch(console.error);
    return;
  }
  
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(texto);
  utterance.lang = 'es-ES';
  utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance);
}

export function callar(): void {
  if (Capacitor.isNativePlatform()) {
    TextToSpeech.stop().catch(console.error);
    return;
  }
  window.speechSynthesis?.cancel();
}

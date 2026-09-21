import { Router } from 'express';
import multer from 'multer';
import { leerEapx } from '../case/eapx.js';

/**
 * Interoperabilidad con Enterprise Architect.
 *
 * El navegador sube el .eapx tal cual lo guarda EA y recibe los diagramas de
 * clases que hay dentro. No hay ningun paso manual en EA: es "abrir el archivo"
 * y listo.
 */

// Un .eapx crece rapido; 60 MB cubre proyectos grandes de la materia.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

export const caseRouter = Router();

caseRouter.post('/eapx', upload.single('archivo'), (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Falta el archivo "archivo"' });
      return;
    }
    const { diagramas, total } = leerEapx(req.file.buffer);
    console.log(
      `[case] ${req.file.originalname}: ${total} diagrama(s) de clases, ` +
        `${diagramas[0]?.clases.length ?? 0} clases en el mas grande`
    );
    res.json({ herramienta: 'Enterprise Architect', archivo: req.file.originalname, total, diagramas });
  } catch (err) {
    // Un archivo que no se puede leer es un problema del archivo, no del
    // servidor: 400 con el motivo, para que la web lo pueda mostrar tal cual.
    const msg = err instanceof Error ? err.message : String(err);
    if (/no parece un|no tiene la tabla|no tiene ningun diagrama/.test(msg)) {
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  }
});

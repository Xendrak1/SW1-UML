import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { pool } from '../db.js';

// Reemplaza Supabase Storage: las imagenes se guardan en el disco del servidor.
const uploadDir = resolve(process.cwd(), config.uploadDir);
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${randomUUID()}${extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Solo se aceptan imagenes'));
      return;
    }
    cb(null, true);
  },
});

export const uploadsRouter = Router();

uploadsRouter.post('/uploads', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Falta el archivo "file"' });
      return;
    }
    await pool.query(
      `INSERT INTO uploads (filename, mime_type, size_bytes) VALUES ($1, $2, $3)`,
      [req.file.filename, req.file.mimetype, req.file.size]
    );
    res.status(201).json({
      filename: req.file.filename,
      url: `/files/${req.file.filename}`,
      size: req.file.size,
    });
  } catch (err) {
    next(err);
  }
});

uploadsRouter.get('/uploads', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT filename, mime_type, size_bytes, created_at
         FROM uploads ORDER BY created_at DESC LIMIT 100`
    );
    res.json(rows.map(r => ({ ...r, url: `/files/${r.filename}` })));
  } catch (err) {
    next(err);
  }
});

export { uploadDir };

import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";


const app = express();
const port = process.env.PORT || 3000;
const secret = process.env.UPLOAD_SECRET;
const uploadDir = process.env.UPLOAD_DIR || "uploads";
const rawMaxFileSize = process.env.MAX_FILE_SIZE || "10MB";
const publicHost = process.env.PUBLIC_HOST || `http://localhost:${port}`;

// --- Função utilitária para converter "10MB" → bytes ---
function parseFileSize(sizeStr) {
  const match = /^(\d+(?:\.\d+)?)([KMG]?B?)$/i.exec(sizeStr.trim());
  if (!match) return parseInt(sizeStr, 10) || 10485760; // fallback 10MB

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
  };

  return Math.round(value * (multipliers[unit] || 1));
}

const maxFileSize = parseFileSize(rawMaxFileSize);

// garante que o diretório exista
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// --- extensões de imagem permitidas ---
const allowedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", '.svg'];

// configuração do multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${randomUUID()}${ext}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return cb(new Error("Only image files are allowed!"));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxFileSize },
});

// --- autenticação via header ---
function authMiddleware(req, res, next) {
  const headerSecret = req.headers["x-upload-secret"];
  if (!headerSecret || headerSecret !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// --- rota de upload ---
app.post("/upload", authMiddleware, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: `File too large. Max size is ${maxFileSize} bytes (${rawMaxFileSize}).`,
        });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const fileUrl = `${publicHost}/files/${encodeURIComponent(req.file.filename)}`;

    res.json({
      message: "File uploaded successfully",
      file: req.file.filename,
      url: fileUrl,
    });
  });
});

// --- rota estática para servir os arquivos ---
app.use("/files", express.static(path.resolve(uploadDir)));

// --- rota raiz ---
app.get("/", (req, res) => {
  res.send(
    "✅ FileServer running.<br>POST /upload (with 'x-upload-secret' header and form-data 'file' — only images allowed)"
  );
});

app.listen(port, () => {
  console.log(`🚀 FileServer running on port ${port}`);
  console.log(`📁 Upload dir: ${uploadDir}`);
  console.log(`📏 Max file size: ${rawMaxFileSize} (${maxFileSize} bytes)`);
  console.log(`🌐 Public host: ${publicHost}`);
});

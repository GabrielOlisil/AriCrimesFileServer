import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";


const app = express();
const port = process.env.PORT || 3000;
const secret = process.env.UPLOAD_SECRET;
const uploadDir = process.env.UPLOAD_DIR || "uploads";
const rawMaxFileSize = process.env.MAX_FILE_SIZE || "10MB";
const publicHost = process.env.PUBLIC_HOST || `http://localhost:${port}`;

// Função utilitária para converter "10MB" → bytes
function parseFileSize(sizeStr) {
  const match = /^(\d+(?:\.\d+)?)([KMG]?B?)$/i.exec(sizeStr.trim());
  if (!match) return parseInt(sizeStr, 10) || 10485760;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Math.round(value * (multipliers[unit] || 1));
}

const maxFileSize = parseFileSize(rawMaxFileSize);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const allowedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

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

function authMiddleware(req, res, next) {
  const headerSecret = req.headers["x-upload-secret"];
  if (!headerSecret || headerSecret !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// --- UPLOAD ---
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
    res.json({ message: "File uploaded successfully", file: req.file.filename, url: fileUrl });
  });
});

// --- LISTAR ARQUIVOS ---
app.get("/api/files", (req, res) => {
  const files = fs.readdirSync(uploadDir)
    .filter(f => allowedExtensions.includes(path.extname(f).toLowerCase()))
    .map(name => {
      const stats = fs.statSync(path.join(uploadDir, name));
      return {
        name,
        size: stats.size,
        mtime: stats.mtime,
        url: `${publicHost}/files/${encodeURIComponent(name)}`
      };
    })
    .sort((a, b) => b.mtime - a.mtime); // mais recentes primeiro

  res.json(files);
});

// --- DELETAR ARQUIVO ---
app.delete("/api/files/:filename", authMiddleware, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  fs.unlinkSync(filePath);
  res.json({ message: "File deleted successfully" });
});

// --- SERVE STATIC FILES ---
app.use("/files", express.static(path.resolve(uploadDir)));

// --- INTERFACE WEB ---
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>File Server</title>
  <style>
    body { font-family: sans-serif; max-width: 750px; margin: 40px auto; }
    input, button { padding: 6px; margin: 5px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 8px; border-bottom: 1px solid #ccc; text-align: left; }
    img { max-height: 50px; border-radius: 4px; }
    tr:hover { background: #f5f5f5; }
    .pagination { margin-top: 10px; display: flex; justify-content: center; align-items: center; gap: 10px; }
  </style>
</head>
<body>
  <h2>📁 File Server</h2>
  <input type="text" id="search" placeholder="Buscar arquivo..." />
  <table>
    <thead><tr><th>Preview</th><th>Nome</th><th>Tamanho</th><th>Modificado</th><th>Ações</th></tr></thead>
    <tbody id="file-list"></tbody>
  </table>

  <div class="pagination">
    <button id="prev">⬅️ Anterior</button>
    <span id="page-info"></span>
    <button id="next">Próximo ➡️</button>
  </div>

 <script>
  const PAGE_SIZE = 20;
  let currentPage = 1;
  let files = [];
  let secret = sessionStorage.getItem("upload_secret");

  if (!secret) {
    secret = prompt("Informe o secret (x-upload-secret):");
    if (!secret) {
      alert("Secret obrigatório.");
      throw new Error("Secret não informado");
    }
    sessionStorage.setItem("upload_secret", secret);
  }

  async function fetchFiles() {
    const res = await fetch("/api/files");
    files = await res.json();
    renderFiles();
  }

  function renderFiles() {
    const term = document.getElementById("search").value.toLowerCase();
    const filtered = files.filter(f => f.name.toLowerCase().includes(term));
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    currentPage = Math.max(1, Math.min(currentPage, totalPages || 1));

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageFiles = filtered.slice(start, start + PAGE_SIZE);

    const tbody = document.getElementById("file-list");
    tbody.innerHTML = "";

    pageFiles.forEach(f => {
      const tr = document.createElement("tr");
      tr.innerHTML = \`
        <td><a href="\${f.url}" target="_blank"><img src="\${f.url}" /></a></td>
        <td><a href="\${f.url}" target="_blank">\${f.name}</a></td>
        <td>\${(f.size / 1024).toFixed(1)} KB</td>
        <td>\${new Date(f.mtime).toLocaleString()}</td>
        <td><button onclick="deleteFile('\${f.name}')">🗑️</button></td>
      \`;
      tbody.appendChild(tr);
    });

    document.getElementById("page-info").textContent =
      totalPages ? \`Página \${currentPage} de \${totalPages}\` : "Nenhum arquivo";
    document.getElementById("prev").disabled = currentPage <= 1;
    document.getElementById("next").disabled = currentPage >= totalPages;
  }

  async function deleteFile(name) {
    if (!confirm("Apagar " + name + "?")) return;
    const res = await fetch("/api/files/" + name, {
      method: "DELETE",
      headers: { "x-upload-secret": secret }
    });
    if (res.ok) {
      files = files.filter(f => f.name !== name);
      renderFiles();
    } else alert("Erro ao apagar arquivo");
  }

  document.getElementById("search").addEventListener("input", renderFiles);
  document.getElementById("prev").addEventListener("click", () => { currentPage--; renderFiles(); });
  document.getElementById("next").addEventListener("click", () => { currentPage++; renderFiles(); });

  fetchFiles();
</script>

</body>
</html>
  `);
});

app.listen(port, () => {
  console.log(`🚀 FileServer running on port ${port}`);
  console.log(`🌐 Public host: ${publicHost}`);
  console.log(`📁 Upload dir: ${uploadDir}`);
});

// Gera o site em dist/ a partir dos PDFs da pasta trabalhos/.
// O nome do arquivo (sem .pdf) é o que aparece no site.
// `node build.mjs --serve` gera e abre um servidor local em http://localhost:3000.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const SRC = "trabalhos";
const OUT = "dist";

const slugify = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const escape = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Data do commit em que o PDF entrou no repo (segue renomeações); sem git, usa a data de modificação.
function addedAt(path) {
  try {
    const out = execFileSync("git", ["log", "--follow", "--diff-filter=A", "--format=%cI", "--", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (out) return new Date(out.split("\n").at(-1));
  } catch {}
  return statSync(path).mtime;
}

function readTrabalhos() {
  const files = readdirSync(SRC);
  const ignorados = files.filter((f) => extname(f).toLowerCase() !== ".pdf");
  if (ignorados.length) console.warn(`Ignorados (o site só publica PDF): ${ignorados.join(", ")}`);

  const slugs = new Set();
  return files
    .filter((f) => extname(f).toLowerCase() === ".pdf")
    .map((file) => {
      const nome = file.slice(0, -4).trim();
      const slug = slugify(nome);
      if (slugs.has(slug)) throw new Error(`Dois PDFs geram o mesmo link (${slug}). Renomeie um deles.`);
      slugs.add(slug);
      return { file, nome, url: `/${slug}.pdf`, data: addedAt(join(SRC, file)) };
    })
    .sort((a, b) => b.data - a.data || a.nome.localeCompare(b.nome, "pt-BR"));
}

const fmtData = (d) =>
  d.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" }).replace(/\./g, "").replace(/ de /g, " ");

const svg = (d) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONE_ABRIR = svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>');
const ICONE_BAIXAR = svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>');

const item = (t) => `
    <li>
      <div><span class="nome">${escape(t.nome)}</span><span class="data">${fmtData(t.data)}</span></div>
      <span class="fmt"><a href="${t.url}" target="_blank" rel="noopener">${ICONE_ABRIR}Abrir</a><a href="${t.url}" download="${escape(t.file)}">${ICONE_BAIXAR}Baixar</a></span>
    </li>`;

function render(trabalhos) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trabalhos do Marcos</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; padding: 48px 16px; background: #fff; color: #222; font: 17px/1.45 system-ui, sans-serif; }
    ul { list-style: none; max-width: 720px; margin: 0 auto; padding: 0; border: 1px solid #e5e5e5; border-radius: 8px; }
    li { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; padding: 16px 20px; }
    li + li { border-top: 1px solid #e5e5e5; }
    .nome { font-weight: 600; }
    .data { display: block; color: #777; font-size: 14px; }
    .fmt { display: inline-flex; border: 1px solid #d4d4d4; border-radius: 6px; overflow: hidden; }
    .fmt a { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; color: #222; text-decoration: none; font-size: 15px; }
    .fmt a + a { border-left: 1px solid #d4d4d4; }
    .fmt a:hover { background: #f3f4f6; color: #111; }
    p { text-align: center; color: #777; }
  </style>
</head>
<body>
  ${trabalhos.length ? `<ul>${trabalhos.map(item).join("")}
  </ul>` : "<p>Nenhum trabalho ainda.</p>"}
</body>
</html>
`;
}

function build() {
  const trabalhos = readTrabalhos();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT);
  for (const t of trabalhos) copyFileSync(join(SRC, t.file), join(OUT, t.url));
  writeFileSync(join(OUT, "index.html"), render(trabalhos));
  console.log(`${trabalhos.length} trabalho(s):`);
  for (const t of trabalhos) console.log(`  ${t.url}  ←  ${t.file}`);
}

build();

if (process.argv.includes("--serve")) {
  const port = Number(process.env.PORT) || 3000;
  const types = {
    ".html": "text/html; charset=utf-8",
    ".pdf": "application/pdf",
  };
  createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = join(OUT, path === "/" ? "index.html" : path.replace(/^\/+/, ""));
    if (!file.startsWith(OUT + "/")) return res.writeHead(403).end();
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end("Não encontrado");
    }
  }).listen(port, () => console.log(`\nhttp://localhost:${port}`));
}

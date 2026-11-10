// Gera o site em dist/ a partir dos PDFs das pastas trabalhos/ e excluidos/.
// O nome do arquivo (sem .pdf) é o que aparece no site.
// `node build.mjs --serve` gera e abre um servidor local em http://localhost:3000.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { classificar } from "./lib/repo.js";

const SRC = "trabalhos";
const EXCLUIDOS = "excluidos";
const OUT = "dist";

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const git = (args, opcoes = {}) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opcoes }).trim();

function raso() {
  try {
    return git(["rev-parse", "--is-shallow-repository"]) === "true";
  } catch {
    return false;
  }
}

// A Vercel clona com --depth=10, e as datas vêm do commit em que cada PDF entrou.
function garantirHistorico() {
  if (!raso()) return;
  const { VERCEL_GIT_REPO_OWNER: dono, VERCEL_GIT_REPO_SLUG: repo } = process.env;
  const fontes = ["origin"];
  if (dono && repo) fontes.push(`https://github.com/${dono}/${repo}.git`);
  for (const fonte of fontes) {
    try {
      git(["fetch", "--unshallow", "--quiet", fonte], {
        timeout: 60000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch {}
    if (!raso()) {
      console.log("Histórico do git completo.");
      return;
    }
  }
  console.warn("Aviso: histórico do git incompleto; as datas dos trabalhos podem estar erradas.");
}

// Data do commit em que o PDF entrou no repo (segue renomeações); sem git, usa a data de modificação.
function addedAt(path) {
  try {
    const out = git(["log", "--follow", "--diff-filter=A", "--format=%cI", "--", path]);
    if (out) return new Date(out.split("\n").at(-1));
  } catch {}
  return statSync(path).mtime;
}

const listar = (pasta) => (existsSync(pasta) ? readdirSync(pasta).map((nome) => `${pasta}/${nome}`) : []);

function caminhosDoRepo() {
  const caminhos = listar(SRC);
  for (const caminho of listar(EXCLUIDOS)) {
    caminhos.push(...(statSync(caminho).isDirectory() ? listar(caminho) : [caminho]));
  }
  return caminhos;
}

const dataDoTs = (ts) => {
  const [, dia, h, m, s, ms] = /^(.+)T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(ts);
  return new Date(`${dia}T${h}:${m}:${s}.${ms}Z`);
};

function lerConteudo() {
  const { trabalhos, excluidos, ignorados } = classificar(caminhosDoRepo());

  const ignoradosTrabalhos = ignorados.filter((c) => c.startsWith(`${SRC}/`)).map((c) => c.slice(SRC.length + 1));
  if (ignoradosTrabalhos.length) console.warn(`Ignorados (o site só publica PDF): ${ignoradosTrabalhos.join(", ")}`);
  for (const c of ignorados.filter((c) => c.startsWith(`${EXCLUIDOS}/`))) {
    console.warn(`Ignorado (fora do padrão excluidos/<data>/<arquivo>.pdf): ${c}`);
  }

  return {
    trabalhos: trabalhos
      .map((t) => ({ ...t, url: `/${t.slug}.pdf`, data: addedAt(t.caminho) }))
      .sort((a, b) => b.data - a.data || a.nome.localeCompare(b.nome, "pt-BR")),
    excluidos: excluidos
      .map((e) => ({ ...e, url: `/excluidos/${e.id}.pdf`, data: dataDoTs(e.ts) }))
      .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)),
  };
}

const fmtData = (d) =>
  d.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" }).replace(/\./g, "").replace(/ de /g, " ");

const svg = (d) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONE_ABRIR = svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>');
const ICONE_BAIXAR = svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>');
const ICONE_ENVIAR = svg('<path d="M12 15V3"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>');
const ICONE_RESTAURAR = svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>');
const ICONE_X = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

const links = (t) =>
  `<span class="fmt"><a href="${escape(t.url)}" target="_blank" rel="noopener">${ICONE_ABRIR}Abrir</a><a href="${escape(t.url)}" download="${escape(t.arquivo)}">${ICONE_BAIXAR}Baixar</a></span>`;

const itemTrabalho = (t) => `
    <li data-slug="${escape(t.slug)}" data-nome="${escape(t.nome)}">
      <div><span class="nome">${escape(t.nome)}</span><span class="data">${escape(fmtData(t.data))}</span></div>
      ${links(t)}
      <button type="button" class="x" data-excluir aria-label="Excluir ${escape(t.nome)}">${ICONE_X}</button>
    </li>`;

const itemExcluido = (e) => `
    <li data-id="${escape(e.id)}" data-nome="${escape(e.nome)}">
      <div><span class="nome">${escape(e.nome)}</span><span class="data">excluído em ${escape(fmtData(e.data))}</span></div>
      <span class="acoes">${links(e)}<button type="button" class="botao" data-restaurar>${ICONE_RESTAURAR}Restaurar</button></span>
      <button type="button" class="x" data-excluir-de-vez aria-label="Excluir de vez ${escape(e.nome)}">${ICONE_X}</button>
    </li>`;

const campoSenha = `
      <label class="campo" data-campo-senha>Senha
        <input type="password" name="senha" autocomplete="current-password" autocapitalize="off" spellcheck="false">
      </label>`;

const dialogo = ({ id, titulo, corpo = '<p class="texto" data-texto></p>', confirmar, classe = "primario" }) => `
  <dialog data-dialogo="${escape(id)}" aria-labelledby="titulo-${escape(id)}">
    <form novalidate>
      <h2 id="titulo-${escape(id)}">${escape(titulo)}</h2>${corpo}${campoSenha}
      <p class="msg" data-msg></p>
      <div class="botoes">
        <button type="button" data-cancelar>Cancelar</button>
        <button type="submit" class="${escape(classe)}" data-confirmar>${escape(confirmar)}</button>
      </div>
    </form>
  </dialog>`;

const DIALOGO_ENVIO = dialogo({
  id: "envio",
  titulo: "Enviar trabalho",
  confirmar: "Enviar",
  corpo: `
      <label class="campo" data-campo>Arquivo PDF
        <input type="file" name="arquivo" accept="application/pdf,.pdf">
      </label>
      <label class="campo" data-campo>Nome no site
        <input type="text" name="nome" maxlength="100" autocomplete="off" placeholder="Matéria - Título">
      </label>`,
});
const DIALOGO_EXCLUIR = dialogo({ id: "excluir", titulo: "Excluir trabalho", confirmar: "Excluir" });
const DIALOGO_RESTAURAR = dialogo({ id: "restaurar", titulo: "Restaurar trabalho", confirmar: "Restaurar" });
const DIALOGO_EXCLUIR_DE_VEZ = dialogo({ id: "excluir-de-vez", titulo: "Excluir de vez", confirmar: "Excluir de vez", classe: "perigo" });

const ESTILO = `
    :root { color-scheme: light; }
    [hidden] { display: none !important; }
    body { margin: 0; padding: 48px 16px; background: #fff; color: #222; font: 17px/1.45 system-ui, sans-serif; }
    ul { list-style: none; max-width: 720px; margin: 0 auto; padding: 0; border: 1px solid #e5e5e5; border-radius: 8px; }
    li { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; padding: 16px 56px 16px 20px; }
    li + li { border-top: 1px solid #e5e5e5; }
    .nome { font-weight: 600; overflow-wrap: anywhere; }
    .data { display: block; color: #777; font-size: 14px; }
    .fmt { display: inline-flex; border: 1px solid #d4d4d4; border-radius: 6px; overflow: hidden; }
    .fmt a { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; color: #222; text-decoration: none; font-size: 15px; }
    .fmt a + a { border-left: 1px solid #d4d4d4; }
    .fmt a:hover { background: #f3f4f6; color: #111; }
    p { text-align: center; color: #777; }
    button { font: inherit; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: default; }
    .barra { max-width: 720px; margin: 0 auto 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    .abas { display: inline-flex; border: 1px solid #d4d4d4; border-radius: 6px; overflow: hidden; }
    .abas a { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; color: #222; text-decoration: none; font-size: 15px; }
    .abas a + a { border-left: 1px solid #d4d4d4; }
    .abas a:hover, .abas a[aria-current="page"] { background: #f3f4f6; }
    .abas a[aria-current="page"] { font-weight: 600; }
    .selo { background: #e5e5e5; border-radius: 999px; padding: 0 7px; font-size: 12px; font-weight: 600; line-height: 18px; }
    .enviar { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border: 0; border-radius: 6px; background: #222; color: #fff; font-size: 15px; }
    .enviar:hover { background: #000; }
    .acoes { display: inline-flex; flex-wrap: wrap; gap: 8px; }
    .botao { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: 1px solid #d4d4d4; border-radius: 6px; background: #fff; color: #222; font-size: 15px; }
    .botao:hover { background: #f3f4f6; color: #111; }
    .x { position: absolute; top: 8px; right: 8px; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 6px; background: none; color: #777; }
    .x:hover { background: #f3f4f6; color: #222; }
    .aviso { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; max-width: 720px; box-sizing: border-box; margin: 0 auto 16px; padding: 10px 14px; border-radius: 8px; background: #f3f4f6; color: #222; text-align: left; font-size: 15px; }
    .aviso:empty { display: none; }
    dialog { width: min(420px, calc(100vw - 32px)); box-sizing: border-box; padding: 20px; border: 1px solid #e5e5e5; border-radius: 10px; color: #222; }
    dialog::backdrop { background: rgb(0 0 0 / 0.35); }
    dialog h2 { margin: 0 0 12px; font-size: 18px; }
    dialog .texto { margin: 0 0 14px; color: #222; text-align: left; overflow-wrap: anywhere; }
    .campo { display: block; margin-bottom: 14px; font-size: 15px; font-weight: 600; }
    .campo input { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; font: inherit; font-weight: 400; }
    .campo input[type="text"], .campo input[type="password"] { padding: 8px 10px; border: 1px solid #d4d4d4; border-radius: 6px; }
    .msg { margin: 0 0 14px; color: #b91c1c; text-align: left; font-size: 15px; }
    .msg.ok { color: #166534; }
    .msg.pergunta { color: #222; }
    .msg:empty { display: none; }
    .botoes { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
    .botoes button { padding: 8px 14px; border: 1px solid #d4d4d4; border-radius: 6px; background: #fff; color: #222; font-size: 15px; }
    .botoes .primario { border-color: #222; background: #222; color: #fff; }
    .botoes .perigo { border-color: #b91c1c; background: #b91c1c; color: #fff; }`;

function pagina({ titulo, ativa, contagem, lista, vazio, dialogos, comEnvio = false, noindex = false }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">${noindex ? '\n  <meta name="robots" content="noindex">' : ""}
  <title>${escape(titulo)}</title>
  <style>${ESTILO}
  </style>
</head>
<body data-pagina="${escape(ativa)}">
  <header class="barra">
    <nav class="abas" aria-label="Seções">
      <a href="/"${ativa === "trabalhos" ? ' aria-current="page"' : ""}>Trabalhos</a>
      <a href="/excluidos"${ativa === "excluidos" ? ' aria-current="page"' : ""}>Excluídos <span class="selo" data-selo${contagem ? "" : " hidden"}>${escape(contagem)}</span></a>
    </nav>${comEnvio ? `\n    <button type="button" class="enviar" data-abrir-envio>${ICONE_ENVIAR}Enviar trabalho</button>` : ""}
  </header>
  <p class="aviso" role="status" data-aviso></p>
  <ul data-lista${lista ? "" : " hidden"}>${lista}
  </ul>
  <p data-vazio${lista ? " hidden" : ""}>${escape(vazio)}</p>${dialogos}
  <script src="/app.js" defer></script>
</body>
</html>
`;
}

function build() {
  garantirHistorico();
  const { trabalhos, excluidos } = lerConteudo();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, EXCLUIDOS), { recursive: true });
  for (const t of trabalhos) copyFileSync(t.caminho, join(OUT, t.url));
  for (const e of excluidos) copyFileSync(e.caminho, join(OUT, e.url));
  copyFileSync(join("site", "app.js"), join(OUT, "app.js"));

  writeFileSync(
    join(OUT, "index.html"),
    pagina({
      titulo: "Trabalhos do Marcos",
      ativa: "trabalhos",
      contagem: excluidos.length,
      lista: trabalhos.map(itemTrabalho).join(""),
      vazio: "Nenhum trabalho ainda.",
      dialogos: DIALOGO_ENVIO + DIALOGO_EXCLUIR + DIALOGO_RESTAURAR,
      comEnvio: true,
    }),
  );
  writeFileSync(
    join(OUT, EXCLUIDOS, "index.html"),
    pagina({
      titulo: "Excluídos · Trabalhos do Marcos",
      ativa: "excluidos",
      contagem: excluidos.length,
      lista: excluidos.map(itemExcluido).join(""),
      vazio: "Nada excluído.",
      dialogos: DIALOGO_RESTAURAR + DIALOGO_EXCLUIR_DE_VEZ,
      noindex: true,
    }),
  );

  console.log(`${trabalhos.length} trabalho(s):`);
  for (const t of trabalhos) console.log(`  ${t.url}  ←  ${t.arquivo}`);
  console.log(`${excluidos.length} excluído(s):`);
  for (const e of excluidos) console.log(`  ${e.url}  ←  ${e.caminho}`);
}

build();

if (process.argv.includes("--serve")) {
  const port = Number(process.env.PORT) || 3000;
  const types = {
    ".html": "text/html; charset=utf-8",
    ".pdf": "application/pdf",
    ".js": "text/javascript; charset=utf-8",
  };
  createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = join(OUT, path === "/" ? "index.html" : path.replace(/^\/+/, ""));
    if (!file.startsWith(OUT + "/")) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end("Não encontrado");
    }
  }).listen(port, () => console.log(`\nhttp://localhost:${port}`));
}

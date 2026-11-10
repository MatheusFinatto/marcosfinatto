import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENV_LIMPO = Object.fromEntries(Object.entries(process.env).filter(([chave]) => !chave.startsWith("VERCEL_GIT_")));

function projeto(arquivos = {}) {
  const dir = mkdtempSync(join(tmpdir(), "marcos-build-"));
  for (const item of ["build.mjs", "package.json", "lib", "site"]) cpSync(join(RAIZ, item), join(dir, item), { recursive: true });
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(dir, caminho)), { recursive: true });
    writeFileSync(join(dir, caminho), conteudo);
  }
  return dir;
}

const construir = (dir) => spawnSync(process.execPath, ["build.mjs"], { cwd: dir, encoding: "utf8", env: ENV_LIMPO });
const ler = (dir, caminho) => readFileSync(join(dir, "dist", caminho), "utf8");

test("sem trabalhos/ nem excluidos/, as duas páginas mostram o estado vazio", () => {
  const dir = projeto();
  const r = construir(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(ler(dir, "index.html"), /<ul data-lista hidden>/);
  assert.match(ler(dir, "index.html"), /<p data-vazio>Nenhum trabalho ainda\.<\/p>/);
  assert.match(ler(dir, "excluidos/index.html"), /<p data-vazio>Nada excluído\.<\/p>/);
  assert.match(ler(dir, "index.html"), /data-selo hidden>0</);
  assert.ok(existsSync(join(dir, "dist", "app.js")));
});

test("gera os links atuais dos trabalhos e a página de excluídos em ordem", () => {
  const dir = projeto({
    "trabalhos/História - Independência do Brasil.pdf": "%PDF-1",
    "excluidos/2026-11-01T10-00-00-000Z/Antigo.pdf": "%PDF-1 a",
    "excluidos/2026-11-05T10-00-00-000Z/Recente.pdf": "%PDF-1 b",
  });
  const r = construir(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, "dist", "historia-independencia-do-brasil.pdf")));
  assert.equal(ler(dir, "excluidos/2026-11-05t10-00-00-000z-recente.pdf"), "%PDF-1 b");
  const excluidos = ler(dir, "excluidos/index.html");
  assert.ok(excluidos.indexOf("Recente") < excluidos.indexOf("Antigo"));
  assert.match(excluidos, /excluído em 5 nov 2026/);
  assert.match(excluidos, /<meta name="robots" content="noindex">/);
  for (const pagina of ["index.html", "excluidos/index.html"]) assert.match(ler(dir, pagina), /data-selo>2</);
});

test("nome malicioso sai escapado nas duas páginas", () => {
  const nome = 'a"><img src=x onerror=alert(1)>';
  const dir = projeto({ [`trabalhos/${nome}.pdf`]: "%PDF-1", [`excluidos/2026-11-01T10-00-00-000Z/${nome}.pdf`]: "%PDF-1" });
  const r = construir(dir);
  assert.equal(r.status, 0, r.stderr);
  for (const pagina of ["index.html", "excluidos/index.html"]) {
    const html = ler(dir, pagina);
    assert.ok(!html.includes("<img"), `${pagina} tem <img`);
    assert.ok(html.includes("a&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"));
  }
});

test("dois excluídos com o mesmo id fazem o build falhar", () => {
  const dir = projeto({
    "excluidos/2026-11-01T10-00-00-000Z/História.pdf": "%PDF-1",
    "excluidos/2026-11-01T10-00-00-000Z/Historia.pdf": "%PDF-1",
  });
  const r = construir(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /mesmo link/);
});

test("caminho fora do padrão em excluidos/ gera aviso", () => {
  const dir = projeto({ "excluidos/solto.pdf": "%PDF-1", "excluidos/2026-11-01/X.pdf": "%PDF-1" });
  const r = construir(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Ignorado .*excluidos\/solto\.pdf/);
  assert.match(r.stderr, /Ignorado .*excluidos\/2026-11-01\/X\.pdf/);
});

test("num clone raso, busca o histórico completo; sem origin, avisa e não falha", () => {
  const origem = projeto();
  const git = (cwd, args, env = {}) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, env: { ...ENV_LIMPO, ...env }, stdio: "pipe" });
  git(origem, ["init", "-q"]);
  const datas = ["2024-01-15T12:00:00Z", "2024-06-15T12:00:00Z", "2025-01-15T12:00:00Z"];
  datas.forEach((data, i) => {
    mkdirSync(join(origem, "trabalhos"), { recursive: true });
    // Conteúdos diferentes: com arquivos idênticos, o `git log --follow` os trata como cópia do primeiro.
    writeFileSync(join(origem, "trabalhos", `T${i}.pdf`), `%PDF-1 trabalho ${i} ${"x".repeat(200 * i)}`);
    git(origem, ["add", "-A"]);
    git(origem, ["commit", "-q", "-m", `c${i}`], { GIT_COMMITTER_DATE: data, GIT_AUTHOR_DATE: data });
  });

  const clonar = () => {
    const destino = mkdtempSync(join(tmpdir(), "marcos-clone-"));
    git(destino, ["clone", "-q", "--depth=1", `file://${origem}`, "c"]);
    return join(destino, "c");
  };

  const clone = clonar();
  let r = construir(clone);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Histórico do git completo\./);
  const html = ler(clone, "index.html");
  for (const d of ["15 jan 2024", "15 jun 2024", "15 jan 2025"]) assert.ok(html.includes(d), `faltou a data ${d}`);

  const semOrigin = clonar();
  git(semOrigin, ["remote", "remove", "origin"]);
  r = construir(semOrigin);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Aviso: histórico do git incompleto/);
  assert.ok(existsSync(join(semOrigin, "dist", "index.html")));
});

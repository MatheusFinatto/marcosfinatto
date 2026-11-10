import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import handler from "../api/index.js";
import {
  processarEnvio,
  processarExclusao,
  processarExclusaoDefinitiva,
  processarRestauracao,
} from "../lib/acoes.js";

const ENV = { UPLOAD_PASSWORD: "girafa azul", GITHUB_TOKEN: "tok-secreto-123", GITHUB_BRANCH: "master" };
const AGORA = () => new Date("2026-11-10T17:03:22.123Z");
const TS = "2026-11-10T17-03-22-123Z";
const TS_ANTIGO = "2026-11-01T10-00-00-000Z";
const MICHELANGELO = "trabalhos/História - Michelangelo.pdf";
const INDEPENDENCIA = "trabalhos/História - Independência do Brasil.pdf";

const repoPadrao = () => ({
  "build.mjs": "codigo",
  [MICHELANGELO]: "%PDF-1.4 michelangelo",
  [INDEPENDENCIA]: "%PDF-1.4 independencia",
});

// GitHub falso em memória: implementa só as 7 rotas da Git Data API que as funções usam.
function criarGitHubFalso(iniciais = repoPadrao()) {
  let contador = 0;
  const novoSha = () => (++contador).toString(16).padStart(40, "0");
  const blobs = new Map();
  const arvores = new Map();
  const commits = new Map();
  const chamadas = [];
  const falhas = {};
  let antesDoPatch = null;

  const arvoreInicial = new Map();
  for (const [caminho, conteudo] of Object.entries(iniciais)) {
    const sha = novoSha();
    blobs.set(sha, Buffer.from(conteudo));
    arvoreInicial.set(caminho, sha);
  }
  const arvoreRaiz = novoSha();
  arvores.set(arvoreRaiz, arvoreInicial);
  let head = novoSha();
  commits.set(head, { tree: arvoreRaiz, parents: [], message: "inicial" });

  const responder = (status, corpo = {}) =>
    new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

  async function fetch(url, opcoes = {}) {
    const { pathname } = new URL(url);
    const prefixo = "/repos/MatheusFinatto/marcosfinatto";
    assert.ok(pathname.startsWith(prefixo), `rota inesperada: ${url}`);
    const rota = pathname.slice(prefixo.length);
    const metodo = opcoes.method ?? "GET";
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : undefined;
    const passo =
      metodo === "GET" && rota === "/git/ref/heads/master" ? "ref"
      : metodo === "GET" && rota.startsWith("/git/commits/") ? "commit"
      : metodo === "GET" && rota.startsWith("/git/trees/") ? "tree"
      : metodo === "POST" && rota === "/git/blobs" ? "blob"
      : metodo === "POST" && rota === "/git/trees" ? "novatree"
      : metodo === "POST" && rota === "/git/commits" ? "novocommit"
      : metodo === "PATCH" && rota === "/git/refs/heads/master" ? "patch"
      : null;
    assert.ok(passo, `rota inesperada: ${metodo} ${rota}`);
    chamadas.push({ passo, url, headers: opcoes.headers, signal: opcoes.signal, corpo });

    const falha = falhas[passo];
    if (falha === "rede") throw new TypeError("fetch failed");
    if (falha === "timeout") throw new DOMException("tempo esgotado", "TimeoutError");
    if (typeof falha === "number") return responder(falha, { message: "falha programada" });
    if (falha === "timeout-no-corpo") {
      const corpoTravado = new ReadableStream({ start: (c) => c.error(new DOMException("tempo esgotado", "TimeoutError")) });
      return new Response(corpoTravado, { status: 200 });
    }

    if (passo === "ref") return responder(200, { object: { sha: head, type: "commit" } });
    if (passo === "commit") {
      const sha = rota.split("/").pop();
      return responder(200, { sha, tree: { sha: commits.get(sha).tree } });
    }
    if (passo === "tree") {
      if (falha === "truncated") return responder(200, { sha: "x", tree: [], truncated: true });
      if (falha === "malformado") return responder(200, { sha: "x", tree: null });
      const sha = rota.split("/").pop();
      const entradas = [...arvores.get(sha)].map(([path, s]) => ({ path, mode: "100644", type: "blob", sha: s }));
      return responder(200, { sha, tree: entradas, truncated: false });
    }
    if (passo === "blob") {
      assert.equal(corpo.encoding, "base64");
      const sha = novoSha();
      blobs.set(sha, Buffer.from(corpo.content, "base64"));
      return responder(201, { sha });
    }
    if (passo === "novatree") {
      const nova = new Map(arvores.get(corpo.base_tree));
      for (const e of corpo.tree) {
        if (e.sha === null) {
          if (!nova.has(e.path)) return responder(422, { message: "path not found" });
          nova.delete(e.path);
        } else {
          nova.set(e.path, e.sha);
        }
      }
      const sha = novoSha();
      arvores.set(sha, nova);
      return responder(201, { sha });
    }
    if (passo === "novocommit") {
      assert.equal(corpo.author, undefined);
      assert.equal(corpo.committer, undefined);
      const sha = novoSha();
      commits.set(sha, { tree: corpo.tree, parents: corpo.parents, message: corpo.message });
      return responder(201, { sha });
    }
    antesDoPatch?.();
    const novo = commits.get(corpo.sha);
    if (corpo.force !== false || novo.parents[0] !== head) return responder(422, { message: "Update is not a fast forward" });
    head = corpo.sha;
    return responder(200, { object: { sha: head } });
  }

  const arvoreAtual = () => new Map(arvores.get(commits.get(head).tree));

  return {
    fetch,
    chamadas,
    falhas,
    arvore: arvoreAtual,
    conteudo: (caminho) => {
      const sha = arvoreAtual().get(caminho);
      return sha && blobs.get(sha).toString();
    },
    mensagens() {
      const lista = [];
      for (let c = head; commits.get(c).parents.length; c = commits.get(c).parents[0]) lista.unshift(commits.get(c).message);
      return lista;
    },
    simularGravacaoConcorrente() {
      antesDoPatch = () => {
        const outro = novoSha();
        commits.set(outro, { tree: commits.get(head).tree, parents: [head], message: "outra gravação" });
        head = outro;
        antesDoPatch = null;
      };
    },
  };
}

const pdf = (texto = "novo") => Buffer.from(`%PDF-1.7 ${texto}`);

function pedidoEnvio({ senha = ENV.UPLOAD_PASSWORD, nome = "Geografia - Relevo", bytes = pdf(), substituir } = {}) {
  const form = new FormData();
  if (senha !== null) form.append("senha", senha);
  if (nome !== null) form.append("nome", nome);
  if (bytes !== null) form.append("arquivo", new File([bytes], "qualquer.pdf", { type: "application/pdf" }));
  if (substituir) form.append("substituir", substituir);
  return new Request("https://site.test/api?acao=enviar", { method: "POST", body: form });
}

const pedidoJson = (acao, corpo) =>
  new Request(`https://site.test/api?acao=${acao}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });

let linhas = [];
const consoleOriginal = { log: console.log, warn: console.warn, error: console.error };
beforeEach(() => {
  linhas = [];
  console.log = console.warn = console.error = (...partes) => linhas.push(partes.join(" "));
});
afterEach(() => Object.assign(console, consoleOriginal));

async function rodar(processar, pedido, gh, env = ENV) {
  const resposta = await processar(pedido, { env, fetch: gh.fetch, agora: AGORA });
  assert.equal(resposta.headers.get("content-type"), "application/json; charset=utf-8");
  return { status: resposta.status, corpo: await resposta.json() };
}

const shasDePdf = (arvore) => new Set([...arvore].filter(([c]) => c.endsWith(".pdf")).map(([, s]) => s));

function assertNadaSePerdeu(antes, depois) {
  const restantes = shasDePdf(depois);
  for (const sha of shasDePdf(antes)) assert.ok(restantes.has(sha), `o blob ${sha} sumiu da árvore`);
}

describe("comum a todas as ações", () => {
  const pedidos = {
    enviar: [processarEnvio, () => pedidoEnvio()],
    excluir: [processarExclusao, () => pedidoJson("excluir", { senha: ENV.UPLOAD_PASSWORD, slug: "historia-michelangelo" })],
    restaurar: [processarRestauracao, () => pedidoJson("restaurar", { senha: ENV.UPLOAD_PASSWORD, id: "abc" })],
    "excluir-de-vez": [processarExclusaoDefinitiva, () => pedidoJson("excluir-de-vez", { senha: ENV.UPLOAD_PASSWORD, id: "abc" })],
  };

  for (const [acao, [processar, criar]] of Object.entries(pedidos)) {
    test(`${acao}: sem config responde config sem chamar o GitHub`, async () => {
      for (const env of [
        { ...ENV, UPLOAD_PASSWORD: undefined },
        { ...ENV, UPLOAD_PASSWORD: "   " },
        { ...ENV, GITHUB_TOKEN: undefined },
        { ...ENV, GITHUB_BRANCH: undefined },
        { ...ENV, GITHUB_BRANCH: "" },
      ]) {
        const gh = criarGitHubFalso();
        const { status, corpo } = await rodar(processar, criar(), gh, env);
        assert.equal(status, 500);
        assert.equal(corpo.erro, "config");
        assert.equal(gh.chamadas.length, 0);
      }
    });

    test(`${acao}: senha errada responde 401 sem chamar o GitHub`, async () => {
      const gh = criarGitHubFalso();
      const env = { ...ENV, UPLOAD_PASSWORD: "outra senha" };
      const { status, corpo } = await rodar(processar, criar(), gh, env);
      assert.equal(status, 401);
      assert.deepEqual(corpo, { ok: false, erro: "senha", mensagem: "Senha errada." });
      assert.equal(gh.chamadas.length, 0);
    });
  }

  test("senha com espaço no fim passa; com outra capitalização, não", async () => {
    let gh = criarGitHubFalso();
    const antes = gh.arvore();
    let r = await rodar(processarExclusao, pedidoJson("excluir", { senha: "girafa azul  ", slug: "historia-michelangelo" }), gh);
    assert.equal(r.status, 200);
    assertNadaSePerdeu(antes, gh.arvore());
    gh = criarGitHubFalso();
    r = await rodar(processarExclusao, pedidoJson("excluir", { senha: "Girafa azul", slug: "historia-michelangelo" }), gh);
    assert.equal(r.corpo.erro, "senha");
  });

  for (const status of [401, 403, 404]) {
    test(`${status} ao ler o ref vira fora-do-ar com gh=ref:${status} no log`, async () => {
      const gh = criarGitHubFalso();
      gh.falhas.ref = status;
      const r = await rodar(processarExclusao, pedidoJson("excluir", { senha: ENV.UPLOAD_PASSWORD, slug: "historia-michelangelo" }), gh);
      assert.equal(r.status, 503);
      assert.equal(r.corpo.erro, "fora-do-ar");
      assert.deepEqual(linhas, [`excluir: fora-do-ar historia-michelangelo gh=ref:${status}`]);
    });
  }

  test("422 no PATCH do ref vira conflito", async () => {
    const gh = criarGitHubFalso();
    gh.falhas.patch = 422;
    const r = await rodar(processarExclusao, pedidoJson("excluir", { senha: ENV.UPLOAD_PASSWORD, slug: "historia-michelangelo" }), gh);
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro, "conflito");
    assert.equal(gh.mensagens().length, 0);
  });

  test("gravação concorrente vira conflito e não muda o repo", async () => {
    const gh = criarGitHubFalso();
    gh.simularGravacaoConcorrente();
    const r = await rodar(processarExclusao, pedidoJson("excluir", { senha: ENV.UPLOAD_PASSWORD, slug: "historia-michelangelo" }), gh);
    assert.equal(r.corpo.erro, "conflito");
    assert.deepEqual(gh.mensagens(), ["outra gravação"]);
    assert.ok(gh.arvore().has(MICHELANGELO));
  });

  test("500 no blob, rede, timeout e truncated viram github com o passo no log", async () => {
    const casos = [
      ["blob", 500, "enviar: github geografia-relevo gh=blob:500", processarEnvio, pedidoEnvio],
      ["ref", "rede", "excluir: github historia-michelangelo gh=ref:rede"],
      ["commit", "timeout", "excluir: github historia-michelangelo gh=commit:timeout"],
      ["tree", "truncated", "excluir: github historia-michelangelo gh=tree:truncated"],
      ["tree", "timeout-no-corpo", "excluir: github historia-michelangelo gh=tree:timeout"],
    ];
    for (const [passo, falha, linha, processar = processarExclusao, criar] of casos) {
      linhas = [];
      const gh = criarGitHubFalso();
      gh.falhas[passo] = falha;
      const pedido = criar ? criar() : pedidoJson("excluir", { senha: ENV.UPLOAD_PASSWORD, slug: "historia-michelangelo" });
      const r = await rodar(processar, pedido, gh);
      assert.equal(r.status, 502);
      assert.equal(r.corpo.erro, "github");
      assert.deepEqual(linhas, [linha]);
    }
  });

  test("toda chamada ao GitHub leva os headers e o timeout", async () => {
    const gh = criarGitHubFalso();
    await rodar(processarEnvio, pedidoEnvio(), gh);
    assert.equal(gh.chamadas.length, 7);
    for (const c of gh.chamadas) {
      assert.equal(c.headers.Authorization, "Bearer tok-secreto-123");
      assert.equal(c.headers.Accept, "application/vnd.github+json");
      assert.equal(c.headers["X-GitHub-Api-Version"], "2022-11-28");
      assert.equal(c.headers["User-Agent"], "marcosfinatto-site");
      assert.ok(c.signal instanceof AbortSignal);
    }
  });

  test("log tem uma linha por pedido e nunca traz senha nem token", async () => {
    const execucoes = [
      [processarEnvio, () => pedidoEnvio()],
      [processarEnvio, () => pedidoEnvio({ senha: "errada" })],
      [processarExclusao, () => pedidoJson("excluir", { senha: ENV.UPLOAD_PASSWORD, slug: "historia-michelangelo" })],
    ];
    for (const [processar, criar] of execucoes) await rodar(processar, criar(), criarGitHubFalso());
    assert.equal(linhas.length, execucoes.length);
    for (const linha of linhas) {
      assert.ok(!linha.includes(ENV.UPLOAD_PASSWORD));
      assert.ok(!linha.includes(ENV.GITHUB_TOKEN));
    }
  });

  test("Trabalhos/ com T maiúsculo e trabalhos/X.pdf.txt não contam como trabalho", async () => {
    const gh = criarGitHubFalso({ "Trabalhos/X.pdf": "%PDF-1", "trabalhos/X.pdf.txt": "%PDF-1", "trabalhos/sub/x.pdf": "%PDF-1" });
    const r = await rodar(processarExclusao, pedidoJson("excluir", { senha: ENV.UPLOAD_PASSWORD, slug: "x" }), gh);
    assert.equal(r.status, 404);
    assert.equal(r.corpo.erro, "nao-existe");
  });
});

describe("enviar", () => {
  test("corpo que não é multipart ou arquivo como texto viram invalido", async () => {
    let r = await rodar(processarEnvio, pedidoJson("enviar", { senha: ENV.UPLOAD_PASSWORD }), criarGitHubFalso());
    assert.equal(r.corpo.erro, "invalido");
    const form = new FormData();
    form.append("senha", ENV.UPLOAD_PASSWORD);
    form.append("nome", "X");
    form.append("arquivo", "texto");
    r = await rodar(processarEnvio, new Request("https://site.test/api", { method: "POST", body: form }), criarGitHubFalso());
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro, "invalido");
  });

  test("4.194.304 bytes passa; 4.194.305 é grande", async () => {
    const limite = Buffer.alloc(4194304, 0x20);
    limite.write("%PDF-");
    let gh = criarGitHubFalso();
    const antes = gh.arvore();
    let r = await rodar(processarEnvio, pedidoEnvio({ bytes: limite }), gh);
    assert.equal(r.status, 200);
    assertNadaSePerdeu(antes, gh.arvore());
    gh = criarGitHubFalso();
    r = await rodar(processarEnvio, pedidoEnvio({ bytes: Buffer.concat([limite, Buffer.from(" ")]) }), gh);
    assert.equal(r.status, 413);
    assert.equal(r.corpo.erro, "grande");
    assert.equal(gh.chamadas.length, 0);
  });

  test("PNG ou arquivo vazio não é PDF", async () => {
    for (const bytes of [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), Buffer.alloc(0)]) {
      const r = await rodar(processarEnvio, pedidoEnvio({ bytes }), criarGitHubFalso());
      assert.equal(r.corpo.erro, "nao-pdf");
    }
  });

  test("nomes inválidos", async () => {
    for (const nome of ["", "   ", "!!!", "a".repeat(101), "a/b", "a\\b", "a\tb", "a" + "中".repeat(99)]) {
      const r = await rodar(processarEnvio, pedidoEnvio({ nome }), criarGitHubFalso());
      assert.equal(r.corpo.erro, "nome", `nome aceito: ${JSON.stringify(nome)}`);
    }
  });

  test("tira o .PDF do nome e grava o caminho em NFC", async () => {
    let gh = criarGitHubFalso();
    let antes = gh.arvore();
    await rodar(processarEnvio, pedidoEnvio({ nome: "Trabalho.PDF" }), gh);
    assert.ok(gh.arvore().has("trabalhos/Trabalho.pdf"));
    assertNadaSePerdeu(antes, gh.arvore());

    gh = criarGitHubFalso();
    antes = gh.arvore();
    const nfd = "Geografia - Rele" + "vo" + " - Ca" + "c" + String.fromCodePoint(0x327) + "a";
    await rodar(processarEnvio, pedidoEnvio({ nome: nfd }), gh);
    assert.ok(gh.arvore().has(`trabalhos/${nfd.normalize("NFC")}.pdf`));
    assert.ok(!gh.arvore().has(`trabalhos/${nfd}.pdf`));
    assertNadaSePerdeu(antes, gh.arvore());
  });

  test("nome novo cria só esse arquivo, num commit", async () => {
    const gh = criarGitHubFalso();
    const antes = gh.arvore();
    const r = await rodar(processarEnvio, pedidoEnvio(), gh);
    assert.deepEqual(r.corpo, { ok: true, nome: "Geografia - Relevo", url: "/geografia-relevo.pdf", substituido: false });
    assert.deepEqual(gh.mensagens(), ["Envia trabalho: Geografia - Relevo"]);
    const depois = gh.arvore();
    assert.equal(depois.size, antes.size + 1);
    assert.equal(gh.conteudo("trabalhos/Geografia - Relevo.pdf"), "%PDF-1.7 novo");
    assertNadaSePerdeu(antes, depois);
    assert.deepEqual(linhas, ["enviar: ok geografia-relevo"]);
  });

  test("slug existente sem substituir pergunta e não muda o repo", async () => {
    const gh = criarGitHubFalso();
    const r = await rodar(processarEnvio, pedidoEnvio({ nome: "historia - michelangelo" }), gh);
    assert.equal(r.status, 409);
    assert.deepEqual(r.corpo, {
      ok: false,
      erro: "existe",
      mensagem: 'Já existe "História - Michelangelo" no site. Quer substituir pelo arquivo novo? O atual vai para Excluídos.',
      existente: "História - Michelangelo",
    });
    assert.deepEqual(gh.mensagens(), []);
  });

  test("substituir grava o novo no caminho antigo e manda o antigo para excluídos", async () => {
    const gh = criarGitHubFalso();
    const antes = gh.arvore();
    const r = await rodar(processarEnvio, pedidoEnvio({ nome: "historia - michelangelo", substituir: "1" }), gh);
    assert.deepEqual(r.corpo, { ok: true, nome: "História - Michelangelo", url: "/historia-michelangelo.pdf", substituido: true });
    assert.deepEqual(gh.mensagens(), ["Substitui trabalho: História - Michelangelo"]);
    assert.equal(gh.conteudo(MICHELANGELO), "%PDF-1.7 novo");
    assert.equal(gh.arvore().get(`excluidos/${TS}/História - Michelangelo.pdf`), antes.get(MICHELANGELO));
    assertNadaSePerdeu(antes, gh.arvore());
  });
});

describe("excluir", () => {
  test("slug inválido é invalido", async () => {
    for (const slug of ["../x", "Abc", "", "a--b", "x".repeat(201)]) {
      const r = await rodar(processarExclusao, pedidoJson("excluir", { senha: ENV.UPLOAD_PASSWORD, slug }), criarGitHubFalso());
      assert.equal(r.corpo.erro, "invalido", `slug aceito: ${slug}`);
    }
    const r = await rodar(processarExclusao, pedidoJson("excluir", "não é json"), criarGitHubFalso());
    assert.equal(r.corpo.erro, "invalido");
  });

  test("slug que não existe", async () => {
    const r = await rodar(processarExclusao, pedidoJson("excluir", { senha: ENV.UPLOAD_PASSWORD, slug: "nada" }), criarGitHubFalso());
    assert.equal(r.status, 404);
    assert.equal(r.corpo.erro, "nao-existe");
  });

  test("move para excluídos com o mesmo sha e devolve o id", async () => {
    const gh = criarGitHubFalso();
    const antes = gh.arvore();
    const r = await rodar(processarExclusao, pedidoJson("excluir", { senha: ENV.UPLOAD_PASSWORD, slug: "historia-michelangelo" }), gh);
    assert.deepEqual(r.corpo, { ok: true, nome: "História - Michelangelo", id: "2026-11-10t17-03-22-123z-historia-michelangelo" });
    assert.deepEqual(gh.mensagens(), ["Exclui trabalho: História - Michelangelo"]);
    const depois = gh.arvore();
    assert.ok(!depois.has(MICHELANGELO));
    assert.equal(depois.get(`excluidos/${TS}/História - Michelangelo.pdf`), antes.get(MICHELANGELO));
    assertNadaSePerdeu(antes, depois);
  });

  test("excluir o último trabalho deixa trabalhos/ vazio", async () => {
    const gh = criarGitHubFalso({ "trabalhos/Único.pdf": "%PDF-1" });
    const antes = gh.arvore();
    await rodar(processarExclusao, pedidoJson("excluir", { senha: ENV.UPLOAD_PASSWORD, slug: "unico" }), gh);
    assert.deepEqual([...gh.arvore().keys()].filter((c) => c.startsWith("trabalhos/")), []);
    assertNadaSePerdeu(antes, gh.arvore());
  });
});

describe("restaurar", () => {
  const excluido = (ts, arquivo) => `excluidos/${ts}/${arquivo}`;

  test("id que não existe", async () => {
    const r = await rodar(processarRestauracao, pedidoJson("restaurar", { senha: ENV.UPLOAD_PASSWORD, id: "nada" }), criarGitHubFalso());
    assert.equal(r.corpo.erro, "nao-existe");
  });

  test("trocar com tipo errado é invalido", async () => {
    const r = await rodar(processarRestauracao, pedidoJson("restaurar", { senha: ENV.UPLOAD_PASSWORD, id: "x", trocar: "sim" }), criarGitHubFalso());
    assert.equal(r.corpo.erro, "invalido");
  });

  test("sem colisão volta para trabalhos/", async () => {
    const gh = criarGitHubFalso({ [excluido(TS_ANTIGO, "Geografia.pdf")]: "%PDF-1 geo" });
    const antes = gh.arvore();
    const r = await rodar(processarRestauracao, pedidoJson("restaurar", { senha: ENV.UPLOAD_PASSWORD, id: "2026-11-01t10-00-00-000z-geografia" }), gh);
    assert.deepEqual(r.corpo, { ok: true, nome: "Geografia", url: "/geografia.pdf", trocado: false });
    assert.deepEqual(gh.mensagens(), ["Restaura trabalho: Geografia"]);
    assert.deepEqual([...gh.arvore().keys()], ["trabalhos/Geografia.pdf"]);
    assertNadaSePerdeu(antes, gh.arvore());
  });

  test("colisão sem trocar pergunta e não muda o repo", async () => {
    const gh = criarGitHubFalso({ ...repoPadrao(), [excluido(TS_ANTIGO, "História - Michelangelo.pdf")]: "%PDF-1 velho" });
    const r = await rodar(processarRestauracao, pedidoJson("restaurar", { senha: ENV.UPLOAD_PASSWORD, id: "2026-11-01t10-00-00-000z-historia-michelangelo" }), gh);
    assert.equal(r.status, 409);
    assert.equal(r.corpo.mensagem, 'Já existe "História - Michelangelo" no site. Quer trocar? O atual vai para Excluídos.');
    assert.deepEqual(gh.mensagens(), []);
  });

  test("trocar com o mesmo nome de arquivo troca os dois", async () => {
    const velho = excluido(TS_ANTIGO, "História - Michelangelo.pdf");
    const gh = criarGitHubFalso({ ...repoPadrao(), [velho]: "%PDF-1 velho" });
    const antes = gh.arvore();
    const r = await rodar(processarRestauracao, pedidoJson("restaurar", { senha: ENV.UPLOAD_PASSWORD, id: "2026-11-01t10-00-00-000z-historia-michelangelo", trocar: true }), gh);
    assert.equal(r.corpo.trocado, true);
    const depois = gh.arvore();
    assert.equal(depois.get(MICHELANGELO), antes.get(velho));
    assert.equal(depois.get(excluido(TS, "História - Michelangelo.pdf")), antes.get(MICHELANGELO));
    assert.ok(!depois.has(velho));
    assert.deepEqual(gh.mensagens(), ["Restaura trabalho: História - Michelangelo"]);
    assertNadaSePerdeu(antes, depois);
  });

  test("trocar com nomes que só diferem no acento tira o atual do caminho dele", async () => {
    const velho = excluido(TS_ANTIGO, "Historia - Michelangelo.pdf");
    const gh = criarGitHubFalso({ ...repoPadrao(), [velho]: "%PDF-1 velho" });
    const antes = gh.arvore();
    await rodar(processarRestauracao, pedidoJson("restaurar", { senha: ENV.UPLOAD_PASSWORD, id: "2026-11-01t10-00-00-000z-historia-michelangelo", trocar: true }), gh);
    const depois = gh.arvore();
    assert.equal(depois.get("trabalhos/Historia - Michelangelo.pdf"), antes.get(velho));
    assert.ok(!depois.has(MICHELANGELO));
    assert.equal(depois.get(excluido(TS, "História - Michelangelo.pdf")), antes.get(MICHELANGELO));
    assertNadaSePerdeu(antes, depois);
  });

  test("com dois excluídos do mesmo nome, só o pedido volta", async () => {
    const outroTs = "2026-11-05T09-30-00-000Z";
    const gh = criarGitHubFalso({ [excluido(TS_ANTIGO, "X.pdf")]: "%PDF-1 a", [excluido(outroTs, "X.pdf")]: "%PDF-1 b" });
    const antes = gh.arvore();
    await rodar(processarRestauracao, pedidoJson("restaurar", { senha: ENV.UPLOAD_PASSWORD, id: "2026-11-05t09-30-00-000z-x" }), gh);
    assert.equal(gh.conteudo("trabalhos/X.pdf"), "%PDF-1 b");
    assert.ok(gh.arvore().has(excluido(TS_ANTIGO, "X.pdf")));
    assertNadaSePerdeu(antes, gh.arvore());
  });

  test("trocar com nomes que só diferem na maiúscula tira o atual do caminho dele", async () => {
    const velho = excluido(TS_ANTIGO, "história - michelangelo.pdf");
    const gh = criarGitHubFalso({ ...repoPadrao(), [velho]: "%PDF-1 velho" });
    const antes = gh.arvore();
    await rodar(processarRestauracao, pedidoJson("restaurar", { senha: ENV.UPLOAD_PASSWORD, id: "2026-11-01t10-00-00-000z-historia-michelangelo", trocar: true }), gh);
    const depois = gh.arvore();
    assert.equal(depois.get("trabalhos/história - michelangelo.pdf"), antes.get(velho));
    assert.ok(!depois.has(MICHELANGELO));
    assert.equal(depois.get(excluido(TS, "História - Michelangelo.pdf")), antes.get(MICHELANGELO));
    assertNadaSePerdeu(antes, depois);
  });
});

describe("excluir de vez", () => {
  test("id que não existe", async () => {
    const r = await rodar(processarExclusaoDefinitiva, pedidoJson("excluir-de-vez", { senha: ENV.UPLOAD_PASSWORD, id: "nada" }), criarGitHubFalso());
    assert.equal(r.corpo.erro, "nao-existe");
  });

  test("remove só aquele caminho", async () => {
    const outroTs = "2026-11-05T09-30-00-000Z";
    const gh = criarGitHubFalso({ [`excluidos/${TS_ANTIGO}/X.pdf`]: "%PDF-1 a", [`excluidos/${outroTs}/X.pdf`]: "%PDF-1 b" });
    const r = await rodar(processarExclusaoDefinitiva, pedidoJson("excluir-de-vez", { senha: ENV.UPLOAD_PASSWORD, id: "2026-11-01t10-00-00-000z-x" }), gh);
    assert.deepEqual(r.corpo, { ok: true, nome: "X" });
    assert.deepEqual([...gh.arvore().keys()], [`excluidos/${outroTs}/X.pdf`]);
    assert.deepEqual(gh.mensagens(), ["Exclui de vez: X"]);
  });
});

describe("api/index.js", () => {
  let fetchOriginal;
  let envOriginal;
  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
    envOriginal = { ...process.env };
    Object.assign(process.env, ENV);
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    for (const chave of Object.keys(ENV)) delete process.env[chave];
    Object.assign(process.env, envOriginal);
  });

  const chamar = async (url, opcoes) => {
    const resposta = await handler.fetch(new Request(url, opcoes));
    return { status: resposta.status, corpo: await resposta.json() };
  };

  test("GET recebe 405", async () => {
    const r = await chamar("https://site.test/api?acao=excluir");
    assert.equal(r.status, 405);
    assert.equal(r.corpo.erro, "invalido");
    assert.deepEqual(linhas, ["api: invalido metodo=GET"]);
  });

  test("ação desconhecida ou ausente recebe 400, sem o valor cru no log", async () => {
    for (const url of ["https://site.test/api?acao=xyz", "https://site.test/api", "https://site.test/api?acao=a%0Aexcluir:%20ok", "https://site.test/api?acao=toString"]) {
      linhas = [];
      const r = await chamar(url, { method: "POST" });
      assert.equal(r.status, 400);
      assert.deepEqual(linhas, ["api: invalido acao=?"]);
    }
  });

  test("roteia para a ação certa", async () => {
    const gh = criarGitHubFalso();
    globalThis.fetch = gh.fetch;
    const r = await chamar("https://site.test/api?acao=excluir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ senha: ENV.UPLOAD_PASSWORD, slug: "historia-michelangelo" }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(gh.mensagens(), ["Exclui trabalho: História - Michelangelo"]);
  });

  test("exceção inesperada vira github com gh=excecao:outro", async () => {
    const gh = criarGitHubFalso();
    gh.falhas.tree = "malformado";
    globalThis.fetch = gh.fetch;
    const r = await chamar("https://site.test/api?acao=excluir", {
      method: "POST",
      body: JSON.stringify({ senha: ENV.UPLOAD_PASSWORD, slug: "historia-michelangelo" }),
    });
    assert.equal(r.status, 502);
    assert.equal(r.corpo.erro, "github");
    assert.deepEqual(linhas, ["excluir: github gh=excecao:outro"]);
  });

  test("id duplicado na árvore vira gh=excecao:duplicado", async () => {
    const gh = criarGitHubFalso({ [`excluidos/${TS_ANTIGO}/História.pdf`]: "%PDF-1", [`excluidos/${TS_ANTIGO}/Historia.pdf`]: "%PDF-1" });
    globalThis.fetch = gh.fetch;
    const r = await chamar("https://site.test/api?acao=excluir-de-vez", {
      method: "POST",
      body: JSON.stringify({ senha: ENV.UPLOAD_PASSWORD, id: "2026-11-01t10-00-00-000z-historia" }),
    });
    assert.equal(r.status, 502);
    assert.deepEqual(linhas, ["excluir-de-vez: github gh=excecao:duplicado"]);
  });
});

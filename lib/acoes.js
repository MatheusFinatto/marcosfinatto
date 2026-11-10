import { carimbo, idDe } from "./repo.js";
import { slugify } from "./slug.js";
import { configOk, criarGitHub, ErroGitHub, falha, falhaExiste, json, registrar, senhaConfere } from "./github.js";

const LIMITE = 4194304;
const LIMITE_BYTES_NOME = 200;
const ALVO = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ASSINATURA_PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

const ehPdf = (bytes) => ASSINATURA_PDF.every((b, i) => bytes[i] === b);

const temProibido = (s) =>
  [...s].some((c) => {
    const codigo = c.codePointAt(0);
    return c === "/" || c === "\\" || codigo < 0x20 || codigo === 0x7f;
  });

function normalizarNome(bruto) {
  return bruto.normalize("NFC").trim().replace(/\.pdf$/i, "").trim();
}

function nomeValido(nome) {
  return (
    nome.length >= 1 &&
    nome.length <= 100 &&
    Buffer.byteLength(`${nome}.pdf`, "utf8") <= LIMITE_BYTES_NOME &&
    !temProibido(nome) &&
    slugify(nome) !== ""
  );
}

function recusar(acao, erro, alvo) {
  registrar(acao, erro, alvo);
  return falha(erro);
}

// `decidir` devolve o corpo de sucesso ou { erro, existente? }. Erro do GitHub vira resposta aqui;
// qualquer outra exceção sobe para api/index.js, que registra `gh=excecao`.
async function comGitHub(acao, alvo, { env, fetch }, decidir) {
  const gh = criarGitHub({ env, fetch });
  let resultado;
  try {
    resultado = await decidir(gh);
  } catch (e) {
    if (!(e instanceof ErroGitHub)) throw e;
    registrar(acao, e.erro, alvo, `${e.passo}:${e.status}`);
    return falha(e.erro);
  }
  if (resultado.erro === "existe") {
    registrar(acao, "existe", alvo);
    return falhaExiste(acao, resultado.existente);
  }
  if (resultado.erro) return recusar(acao, resultado.erro, alvo);
  registrar(acao, "ok", alvo);
  return json(resultado);
}

async function lerJson(request, campo) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return null;
  }
  if (!corpo || typeof corpo !== "object") return null;
  const alvo = corpo[campo];
  if (typeof corpo.senha !== "string" || typeof alvo !== "string") return null;
  if (alvo.length > 200 || !ALVO.test(alvo)) return null;
  if (corpo.trocar !== undefined && typeof corpo.trocar !== "boolean") return null;
  return corpo;
}

async function acaoJson(acao, campo, request, { env, fetch }, decidir) {
  if (!configOk(env)) return recusar(acao, "config");
  const corpo = await lerJson(request, campo);
  if (!corpo) return recusar(acao, "invalido");
  if (!senhaConfere(corpo.senha, env)) return recusar(acao, "senha");
  return comGitHub(acao, corpo[campo], { env, fetch }, (gh) => decidir(gh, corpo));
}

export async function processarEnvio(request, { env, fetch, agora = () => new Date() }) {
  const acao = "enviar";
  if (!configOk(env)) return recusar(acao, "config");

  let form;
  try {
    form = await request.formData();
  } catch {
    return recusar(acao, "invalido");
  }
  const senha = form.get("senha");
  const nomeBruto = form.get("nome");
  const arquivo = form.get("arquivo");
  if (typeof senha !== "string" || typeof nomeBruto !== "string" || !(arquivo instanceof File)) {
    return recusar(acao, "invalido");
  }
  if (!senhaConfere(senha, env)) return recusar(acao, "senha");

  if (arquivo.size > LIMITE) return recusar(acao, "grande");
  const conteudo = new Uint8Array(await arquivo.arrayBuffer());
  if (!ehPdf(conteudo)) return recusar(acao, "nao-pdf");
  const nome = normalizarNome(nomeBruto);
  if (!nomeValido(nome)) return recusar(acao, "nome");
  const slug = slugify(nome);

  return comGitHub(acao, slug, { env, fetch }, async (gh) => {
    const estado = await gh.lerEstado();
    const existente = estado.trabalhos.find((t) => t.slug === slug);
    if (!existente) {
      await gh.gravar(estado, [{ path: `trabalhos/${nome}.pdf`, conteudo }], `Envia trabalho: ${nome}`);
      return { ok: true, nome, url: `/${slug}.pdf`, substituido: false };
    }
    if (form.get("substituir") !== "1") return { erro: "existe", existente: existente.nome };
    await gh.gravar(
      estado,
      [
        { path: existente.caminho, conteudo },
        { path: `excluidos/${carimbo(agora())}/${existente.arquivo}`, sha: existente.sha },
      ],
      `Substitui trabalho: ${existente.nome}`,
    );
    return { ok: true, nome: existente.nome, url: `/${slug}.pdf`, substituido: true };
  });
}

export function processarExclusao(request, { env, fetch, agora = () => new Date() }) {
  return acaoJson("excluir", "slug", request, { env, fetch }, async (gh, { slug }) => {
    const estado = await gh.lerEstado();
    const trabalho = estado.trabalhos.find((t) => t.slug === slug);
    if (!trabalho) return { erro: "nao-existe" };
    const ts = carimbo(agora());
    await gh.gravar(
      estado,
      [
        { path: `excluidos/${ts}/${trabalho.arquivo}`, sha: trabalho.sha },
        { path: trabalho.caminho, sha: null },
      ],
      `Exclui trabalho: ${trabalho.nome}`,
    );
    return { ok: true, nome: trabalho.nome, id: idDe(ts, trabalho.nome) };
  });
}

export function processarRestauracao(request, { env, fetch, agora = () => new Date() }) {
  return acaoJson("restaurar", "id", request, { env, fetch }, async (gh, { id, trocar }) => {
    const estado = await gh.lerEstado();
    const excluido = estado.excluidos.find((e) => e.id === id);
    if (!excluido) return { erro: "nao-existe" };
    const slug = slugify(excluido.nome);
    const atual = estado.trabalhos.find((t) => t.slug === slug);
    if (atual && trocar !== true) return { erro: "existe", existente: atual.nome };

    const destino = `trabalhos/${excluido.arquivo}`;
    const mudancas = [
      { path: destino, sha: excluido.sha },
      { path: excluido.caminho, sha: null },
    ];
    if (atual) {
      mudancas.push({ path: `excluidos/${carimbo(agora())}/${atual.arquivo}`, sha: atual.sha });
      if (atual.caminho !== destino) mudancas.push({ path: atual.caminho, sha: null });
    }
    await gh.gravar(estado, mudancas, `Restaura trabalho: ${excluido.nome}`);
    return { ok: true, nome: excluido.nome, url: `/${slug}.pdf`, trocado: Boolean(atual) };
  });
}

// `agora` fica na assinatura só por uniformidade com as outras ações: excluir de vez não gera carimbo.
export function processarExclusaoDefinitiva(request, { env, fetch, agora = () => new Date() }) {
  return acaoJson("excluir-de-vez", "id", request, { env, fetch }, async (gh, { id }) => {
    const estado = await gh.lerEstado();
    const excluido = estado.excluidos.find((e) => e.id === id);
    if (!excluido) return { erro: "nao-existe" };
    await gh.gravar(estado, [{ path: excluido.caminho, sha: null }], `Exclui de vez: ${excluido.nome}`);
    return { ok: true, nome: excluido.nome };
  });
}

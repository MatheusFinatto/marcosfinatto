import { createHash, timingSafeEqual } from "node:crypto";
import { classificar } from "./repo.js";

const REPO_PADRAO = "MatheusFinatto/marcosfinatto";
const TIMEOUT = 15000;

const MENSAGENS = {
  config: "O site está sem acesso para mudanças. Avisa quem cuida do site.",
  invalido: "Não deu para ler o pedido. Recarrega a página e tenta de novo.",
  senha: "Senha errada.",
  grande: "Arquivo grande demais (máximo 4 MB). Exporta o PDF de novo com qualidade menor e tenta outra vez.",
  "nao-pdf": "Esse arquivo não é um PDF. Exporta como PDF e tenta de novo.",
  nome: "Escolhe outro nome: com letras ou números, não muito longo, sem / nem \\.",
  "nao-existe": "Esse trabalho não está mais aqui. Recarrega a página.",
  conflito: "O site mudou enquanto você fazia isso. Tenta de novo.",
  "fora-do-ar": "O site está sem acesso para mudanças. Avisa quem cuida do site.",
  github: "Não deu para fazer isso agora. Tenta de novo em alguns minutos.",
};

const STATUS = {
  config: 500,
  invalido: 400,
  senha: 401,
  grande: 413,
  "nao-pdf": 400,
  nome: 400,
  existe: 409,
  "nao-existe": 404,
  conflito: 409,
  "fora-do-ar": 503,
  github: 502,
};

const PERGUNTA_EXISTE = {
  enviar: (existente) => `Já existe "${existente}" no site. Quer substituir pelo arquivo novo? O atual vai para Excluídos.`,
  restaurar: (existente) => `Já existe "${existente}" no site. Quer trocar? O atual vai para Excluídos.`,
};

export class ErroGitHub extends Error {
  constructor(passo, status) {
    super(`GitHub ${passo}: ${status}`);
    this.passo = passo;
    this.status = status;
  }

  get erro() {
    if (this.status === 401 || this.status === 403 || this.status === 404) return "fora-do-ar";
    if (this.status === 409 || (this.status === 422 && this.passo === "patch")) return "conflito";
    return "github";
  }
}

// Na leitura do corpo, só timeout e falha de stream são transporte; JSON inválido continua sendo exceção.
function erroDeTransporte(passo, e) {
  if (e?.name === "TimeoutError") return new ErroGitHub(passo, "timeout");
  if (e instanceof TypeError) return new ErroGitHub(passo, "rede");
  return e;
}

export function registrar(acao, resultado, alvo, gh) {
  console.log(`${acao}: ${resultado}${alvo ? ` ${alvo}` : ""}${gh ? ` gh=${gh}` : ""}`);
}

export function json(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function falha(erro, extra = {}, status = STATUS[erro]) {
  const mensagem = extra.mensagem ?? MENSAGENS[erro];
  return json({ ok: false, erro, mensagem, ...extra }, status);
}

export function falhaExiste(acao, existente) {
  return falha("existe", { mensagem: PERGUNTA_EXISTE[acao](existente), existente });
}

export const configOk = (env) =>
  ["UPLOAD_PASSWORD", "GITHUB_TOKEN", "GITHUB_BRANCH"].every((v) => typeof env[v] === "string" && env[v].trim() !== "");

const resumo = (texto) => createHash("sha256").update(texto.trim()).digest();

export const senhaConfere = (senha, env) => timingSafeEqual(resumo(senha), resumo(env.UPLOAD_PASSWORD));

export function criarGitHub({ env, fetch }) {
  const repo = env.GITHUB_REPO?.trim() || REPO_PADRAO;
  const branch = env.GITHUB_BRANCH.trim().split("/").map(encodeURIComponent).join("/");
  const base = `https://api.github.com/repos/${repo}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN.trim()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "marcosfinatto-site",
  };

  async function chamar(passo, method, caminho, corpo) {
    const opcoes = { method, headers: { ...headers }, signal: AbortSignal.timeout(TIMEOUT) };
    if (corpo !== undefined) {
      opcoes.headers["Content-Type"] = "application/json";
      opcoes.body = JSON.stringify(corpo);
    }
    let resposta;
    try {
      resposta = await fetch(base + caminho, opcoes);
    } catch (e) {
      throw new ErroGitHub(passo, e?.name === "TimeoutError" ? "timeout" : "rede");
    }
    if (!resposta.ok) throw new ErroGitHub(passo, resposta.status);
    // O timeout também vale para a leitura do corpo: o GitHub pode mandar os headers e travar depois.
    try {
      return await resposta.json();
    } catch (e) {
      throw erroDeTransporte(passo, e);
    }
  }

  async function lerEstado() {
    const ref = await chamar("ref", "GET", `/git/ref/heads/${branch}`);
    const head = ref.object.sha;
    const commit = await chamar("commit", "GET", `/git/commits/${head}`);
    const baseTree = commit.tree.sha;
    const arvore = await chamar("tree", "GET", `/git/trees/${baseTree}?recursive=1`);
    if (arvore.truncated) throw new ErroGitHub("tree", "truncated");

    const shas = new Map(arvore.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
    const { trabalhos, excluidos } = classificar([...shas.keys()]);
    for (const item of [...trabalhos, ...excluidos]) item.sha = shas.get(item.caminho);
    return { head, baseTree, trabalhos, excluidos };
  }

  // Cada mudança é { path, sha } (sha null remove) ou { path, conteudo } para um arquivo novo.
  async function gravar(estado, mudancas, mensagem) {
    const tree = [];
    for (const m of mudancas) {
      let sha = m.sha;
      if (m.conteudo) {
        const blob = await chamar("blob", "POST", "/git/blobs", {
          content: Buffer.from(m.conteudo).toString("base64"),
          encoding: "base64",
        });
        sha = blob.sha;
      }
      tree.push({ path: m.path, mode: "100644", type: "blob", sha });
    }
    const novaArvore = await chamar("novatree", "POST", "/git/trees", { base_tree: estado.baseTree, tree });
    const novo = await chamar("novocommit", "POST", "/git/commits", {
      message: mensagem,
      tree: novaArvore.sha,
      parents: [estado.head],
    });
    await chamar("patch", "PATCH", `/git/refs/heads/${branch}`, { sha: novo.sha, force: false });
  }

  return { lerEstado, gravar };
}

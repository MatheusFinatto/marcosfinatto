import { slugify } from "./slug.js";

// Sem a flag `i` de propósito: `Trabalhos/X.pdf` não é trabalho, porque o build só lê `trabalhos/`.
const TRABALHO = /^trabalhos\/([^/]+\.[pP][dD][fF])$/;
const EXCLUIDO = /^excluidos\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\/([^/]+\.[pP][dD][fF])$/;

const nomeDe = (arquivo) => arquivo.slice(0, -4).trim();

export const idDe = (ts, nome) => slugify(`${ts} ${nome}`);

function duplicado(mensagem) {
  const erro = new Error(mensagem);
  erro.code = "duplicado";
  return erro;
}

export function classificar(caminhos) {
  const trabalhos = [];
  const excluidos = [];
  const ignorados = [];
  const slugs = new Set();
  const ids = new Set();

  for (const caminho of caminhos) {
    const t = TRABALHO.exec(caminho);
    if (t) {
      const arquivo = t[1];
      const nome = nomeDe(arquivo);
      const slug = slugify(nome);
      if (slugs.has(slug)) throw duplicado(`Dois PDFs geram o mesmo link (${slug}). Renomeie um deles.`);
      slugs.add(slug);
      trabalhos.push({ caminho, arquivo, nome, slug });
      continue;
    }
    const e = EXCLUIDO.exec(caminho);
    if (e) {
      const [, ts, arquivo] = e;
      const nome = nomeDe(arquivo);
      const id = idDe(ts, nome);
      if (ids.has(id)) throw duplicado(`Dois excluídos geram o mesmo link (${id}). Renomeie um deles.`);
      ids.add(id);
      excluidos.push({ caminho, arquivo, nome, ts, id });
      continue;
    }
    if (caminho.startsWith("trabalhos/") || caminho.startsWith("excluidos/")) ignorados.push(caminho);
  }

  return { trabalhos, excluidos, ignorados };
}

export const carimbo = (data) => data.toISOString().replace(/[:.]/g, "-");

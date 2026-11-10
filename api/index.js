import {
  processarEnvio,
  processarExclusao,
  processarExclusaoDefinitiva,
  processarRestauracao,
} from "../lib/acoes.js";
import { falha, registrar } from "../lib/github.js";

const ACOES = {
  enviar: processarEnvio,
  excluir: processarExclusao,
  restaurar: processarRestauracao,
  "excluir-de-vez": processarExclusaoDefinitiva,
};

export default {
  async fetch(request) {
    let acao = "api";
    try {
      if (request.method !== "POST") {
        registrar("api", "invalido", `metodo=${request.method}`);
        return falha("invalido", {}, 405);
      }
      const pedida = new URL(request.url).searchParams.get("acao");
      // O valor cru de `acao` não vai para o log: um %0A forjaria uma linha de "ok".
      if (!Object.hasOwn(ACOES, pedida)) {
        registrar("api", "invalido", "acao=?");
        return falha("invalido");
      }
      acao = pedida;
      return await ACOES[acao](request, { env: process.env, fetch: globalThis.fetch });
    } catch (e) {
      registrar(acao, "github", undefined, `excecao:${e?.code === "duplicado" ? "duplicado" : "outro"}`);
      return falha("github");
    }
  },
};

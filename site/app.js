const LIMITE = 4194304;
const VALIDADE = 600000;
const CHAVE = "marcosfinatto:senha";
const MSG_GRANDE = "Arquivo grande demais (máximo 4 MB). Exporta o PDF de novo com qualidade menor e tenta outra vez.";
const MSG_GITHUB = "Não deu para fazer isso agora. Tenta de novo em alguns minutos.";

// Senha lembrada. O sessionStorage pode voltar ao reabrir uma aba fechada,
// então a senha vencida é apagada ativamente, e não só ignorada.
let memoria = null;
let relogio = 0;

function lerGuardada() {
  let dado = null;
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    dado = bruto ? JSON.parse(bruto) : null;
  } catch {}
  return dado ?? memoria;
}

function esquecerSenha() {
  memoria = null;
  clearTimeout(relogio);
  try {
    sessionStorage.removeItem(CHAVE);
  } catch {}
}

function agendarEsquecimento(expira) {
  clearTimeout(relogio);
  relogio = setTimeout(esquecerSenha, Math.max(0, expira - Date.now()));
}

function senhaLembrada() {
  const dado = lerGuardada();
  if (!dado) return null;
  if (typeof dado.senha !== "string" || typeof dado.expira !== "number" || Date.now() >= dado.expira) {
    esquecerSenha();
    return null;
  }
  return dado.senha;
}

function lembrarSenha(senha) {
  const dado = { senha, expira: Date.now() + VALIDADE };
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(dado));
    memoria = null;
  } catch {
    memoria = dado;
  }
  agendarEsquecimento(dado.expira);
}

if (senhaLembrada() !== null) agendarEsquecimento(lerGuardada().expira);

async function pedir(acao, corpo) {
  const opcoes = { method: "POST", body: corpo };
  if (!(corpo instanceof FormData)) {
    opcoes.headers = { "content-type": "application/json" };
    opcoes.body = JSON.stringify(corpo);
  }
  let resposta;
  try {
    resposta = await fetch(`/api?acao=${acao}`, opcoes);
  } catch {
    return { ok: false, erro: "github", mensagem: MSG_GITHUB };
  }
  try {
    const dados = await resposta.json();
    if (typeof dados?.ok === "boolean") return dados;
  } catch {}
  if (resposta.status === 413) return { ok: false, erro: "grande", mensagem: MSG_GRANDE };
  return { ok: false, erro: "github", mensagem: MSG_GITHUB };
}

const lista = document.querySelector("[data-lista]");
const vazio = document.querySelector("[data-vazio]");
const selo = document.querySelector("[data-selo]");
const aviso = document.querySelector("[data-aviso]");

function atualizarVazio() {
  const temItens = lista.children.length > 0;
  lista.hidden = !temItens;
  vazio.hidden = temItens;
}

function mudarSelo(delta) {
  const total = Math.max(0, Number(selo.textContent || 0) + delta);
  selo.textContent = String(total);
  selo.hidden = total === 0;
}

function avisar(texto, acao) {
  aviso.replaceChildren();
  if (!texto) return;
  const span = document.createElement("span");
  span.textContent = texto;
  aviso.append(span);
  if (acao) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "botao";
    botao.textContent = acao.rotulo;
    botao.addEventListener("click", () => acao.aoClicar(botao));
    aviso.append(botao);
  }
}

function ocuparBotao(botao, progresso) {
  const filhos = [...botao.childNodes];
  botao.disabled = true;
  botao.textContent = progresso;
  return () => {
    botao.replaceChildren(...filhos);
    botao.disabled = false;
  };
}

function controlarDialogo(nome) {
  const el = document.querySelector(`[data-dialogo="${nome}"]`);
  if (!el) return null;
  const form = el.querySelector("form");
  const texto = el.querySelector("[data-texto]");
  const campoSenha = el.querySelector("[data-campo-senha]");
  const inputSenha = campoSenha.querySelector("input");
  const msg = el.querySelector("[data-msg]");
  const confirmar = el.querySelector("[data-confirmar]");
  const cancelar = el.querySelector("[data-cancelar]");
  let rotulo = confirmar.textContent;

  const d = {
    el,
    form,
    get aberto() {
      return el.open;
    },
    abrir({ texto: t, rotulo: r } = {}) {
      form.reset();
      d.mensagem("");
      if (texto && t !== undefined) texto.textContent = t;
      d.rotulo(r ?? rotulo);
      campoSenha.hidden = senhaLembrada() !== null;
      cancelar.hidden = false;
      d.ocupado(false);
      if (!el.open) el.showModal();
    },
    texto(t) {
      texto.textContent = t;
    },
    rotulo(r) {
      rotulo = r;
      confirmar.textContent = r;
    },
    mensagem(t, tipo = "") {
      msg.textContent = t;
      msg.className = tipo ? `msg ${tipo}` : "msg";
    },
    ocupado(sim, progresso) {
      confirmar.disabled = sim;
      cancelar.disabled = sim;
      confirmar.textContent = sim ? progresso : rotulo;
    },
    esconderCancelar() {
      cancelar.hidden = true;
    },
    esconderSenha() {
      campoSenha.hidden = true;
    },
    // A decisão de pedir a senha é tomada no envio: ela pode ter vencido com o diálogo aberto.
    senhaParaEnviar() {
      const lembrada = senhaLembrada();
      if (lembrada !== null) return { senha: lembrada, digitada: false };
      if (campoSenha.hidden || !inputSenha.value.trim()) {
        campoSenha.hidden = false;
        inputSenha.focus();
        return null;
      }
      return { senha: inputSenha.value, digitada: true };
    },
    senhaErrada(mensagem) {
      esquecerSenha();
      campoSenha.hidden = false;
      inputSenha.value = "";
      inputSenha.focus();
      d.mensagem(mensagem);
    },
    fechar() {
      el.close();
    },
  };

  cancelar.addEventListener("click", () => el.close());
  return d;
}

// Restaurar é usado nas duas páginas: pelo botão da aba Excluídos e pelo Desfazer da aba Trabalhos.
const restaurar = controlarDialogo("restaurar");
let restauracao = null;

function concluirRestauracao(r, senhaUsada) {
  if (r.ok) {
    if (senhaUsada?.digitada) lembrarSenha(senhaUsada.senha);
    if (restaurar.aberto) restaurar.fechar();
    restauracao.aoSucesso(r);
    return;
  }
  if (r.erro === "existe") {
    restauracao.trocar = true;
    if (!restaurar.aberto) restaurar.abrir();
    restaurar.mensagem("");
    restaurar.texto(r.mensagem);
    restaurar.rotulo("Trocar");
    return;
  }
  if (r.erro === "senha") {
    if (!restaurar.aberto) restaurar.abrir({ texto: `Restaurar "${restauracao.nome}"?`, rotulo: "Restaurar" });
    restaurar.senhaErrada(r.mensagem);
    return;
  }
  if (r.erro === "nao-existe") {
    if (restaurar.aberto) restaurar.fechar();
    restauracao.aoNaoExiste?.();
    avisar(r.mensagem);
    return;
  }
  if (restaurar.aberto) restaurar.mensagem(r.mensagem);
  else avisar(r.mensagem, restauracao.repetir);
}

async function pedirRestauracao(opcoes) {
  restauracao = { ...opcoes, trocar: false };
  const lembrada = senhaLembrada();
  if (lembrada === null) {
    restaurar.abrir({ texto: `Restaurar "${opcoes.nome}"?`, rotulo: "Restaurar" });
    return;
  }
  const liberar = ocuparBotao(opcoes.botao, "Restaurando…");
  const r = await pedir("restaurar", { senha: lembrada, id: opcoes.id });
  if (opcoes.botao.isConnected) liberar();
  concluirRestauracao(r, null);
}

restaurar?.form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const s = restaurar.senhaParaEnviar();
  if (!s) return;
  restaurar.ocupado(true, "Restaurando…");
  const corpo = { senha: s.senha, id: restauracao.id };
  if (restauracao.trocar) corpo.trocar = true;
  const r = await pedir("restaurar", corpo);
  restaurar.ocupado(false);
  concluirRestauracao(r, s);
});

function iniciarTrabalhos() {
  const envio = controlarDialogo("envio");
  const excluir = controlarDialogo("excluir");
  const inputArquivo = envio.form.elements.arquivo;
  const inputNome = envio.form.elements.nome;
  const camposEnvio = envio.el.querySelectorAll("[data-campo]");
  let substituir = false;
  let concluido = false;

  function voltarAoEnvio() {
    substituir = false;
    envio.rotulo("Enviar");
    envio.mensagem("");
  }

  document.querySelector("[data-abrir-envio]").addEventListener("click", () => {
    avisar(null);
    concluido = false;
    substituir = false;
    for (const campo of camposEnvio) campo.hidden = false;
    envio.abrir({ rotulo: "Enviar" });
  });

  inputArquivo.addEventListener("change", () => {
    const arquivo = inputArquivo.files[0];
    if (arquivo) inputNome.value = arquivo.name.replace(/\.[^.]*$/, "").normalize("NFC");
    voltarAoEnvio();
  });
  inputNome.addEventListener("input", voltarAoEnvio);

  envio.form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (concluido) {
      envio.fechar();
      return;
    }
    const arquivo = inputArquivo.files[0];
    if (!arquivo) {
      envio.mensagem("Escolhe o arquivo PDF.");
      return;
    }
    if (arquivo.size > LIMITE) {
      envio.mensagem(MSG_GRANDE);
      return;
    }
    const s = envio.senhaParaEnviar();
    if (!s) return;

    const dados = new FormData();
    dados.append("senha", s.senha);
    dados.append("nome", inputNome.value);
    dados.append("arquivo", arquivo);
    if (substituir) dados.append("substituir", "1");

    envio.ocupado(true, "Enviando…");
    const r = await pedir("enviar", dados);
    envio.ocupado(false);

    if (r.ok) {
      if (s.digitada) lembrarSenha(s.senha);
      if (r.substituido) mudarSelo(1);
      concluido = true;
      for (const campo of camposEnvio) campo.hidden = true;
      envio.esconderSenha();
      envio.esconderCancelar();
      envio.mensagem("Enviado! Em cerca de 1 minuto aparece aqui. Recarrega a página para ver.", "ok");
      envio.rotulo("Fechar");
      return;
    }
    if (r.erro === "existe") {
      substituir = true;
      envio.mensagem(r.mensagem, "pergunta");
      envio.rotulo("Substituir");
      return;
    }
    if (r.erro === "senha") {
      envio.senhaErrada(r.mensagem);
      return;
    }
    envio.mensagem(r.mensagem);
  });

  let alvo = null;

  lista.addEventListener("click", (evento) => {
    const botao = evento.target.closest("[data-excluir]");
    if (!botao) return;
    avisar(null);
    alvo = botao.closest("li");
    excluir.abrir({
      texto: `Excluir "${alvo.dataset.nome}"? Ele vai para Excluídos e dá para restaurar depois.`,
      rotulo: "Excluir",
    });
  });

  excluir.form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const s = excluir.senhaParaEnviar();
    if (!s) return;
    excluir.ocupado(true, "Excluindo…");
    const r = await pedir("excluir", { senha: s.senha, slug: alvo.dataset.slug });
    excluir.ocupado(false);

    if (r.ok) {
      if (s.digitada) lembrarSenha(s.senha);
      excluir.fechar();
      const card = alvo;
      const proximo = card.nextElementSibling;
      card.remove();
      mudarSelo(1);
      atualizarVazio();
      // Se o Desfazer falhar, o aviso de erro mantém o botão para tentar de novo.
      const desfazer = { rotulo: "Desfazer" };
      desfazer.aoClicar = (botaoDesfazer) =>
        pedirRestauracao({
          id: r.id,
          nome: r.nome,
          botao: botaoDesfazer,
          repetir: desfazer,
          aoSucesso: (restaurado) => {
            for (const outro of lista.querySelectorAll("li")) {
              if (outro.dataset.slug === card.dataset.slug) outro.remove();
            }
            lista.insertBefore(card, proximo?.isConnected ? proximo : null);
            if (!restaurado.trocado) mudarSelo(-1);
            atualizarVazio();
            avisar(`"${restaurado.nome}" voltou.`);
          },
        });
      avisar(`"${r.nome}" foi para Excluídos. Aparece lá em cerca de 1 minuto.`, desfazer);
      return;
    }
    if (r.erro === "nao-existe") {
      excluir.fechar();
      alvo.remove();
      atualizarVazio();
      avisar(r.mensagem);
      return;
    }
    if (r.erro === "senha") {
      excluir.senhaErrada(r.mensagem);
      return;
    }
    excluir.mensagem(r.mensagem);
  });
}

function iniciarExcluidos() {
  const deVez = controlarDialogo("excluir-de-vez");
  let alvo = null;

  function tirar(card) {
    card.remove();
    mudarSelo(-1);
    atualizarVazio();
  }

  lista.addEventListener("click", (evento) => {
    const card = evento.target.closest("li");
    if (!card) return;
    const botaoRestaurar = evento.target.closest("[data-restaurar]");
    if (botaoRestaurar) {
      avisar(null);
      pedirRestauracao({
        id: card.dataset.id,
        nome: card.dataset.nome,
        botao: botaoRestaurar,
        aoSucesso: (r) => {
          card.remove();
          if (!r.trocado) mudarSelo(-1);
          atualizarVazio();
          avisar(`"${r.nome}" voltou para Trabalhos. Aparece lá em cerca de 1 minuto.`);
        },
        aoNaoExiste: () => tirar(card),
      });
      return;
    }
    if (evento.target.closest("[data-excluir-de-vez]")) {
      avisar(null);
      alvo = card;
      deVez.abrir({
        texto: `Excluir "${card.dataset.nome}" de vez? Não dá para desfazer pelo site.`,
        rotulo: "Excluir de vez",
      });
    }
  });

  deVez.form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const s = deVez.senhaParaEnviar();
    if (!s) return;
    deVez.ocupado(true, "Excluindo…");
    const r = await pedir("excluir-de-vez", { senha: s.senha, id: alvo.dataset.id });
    deVez.ocupado(false);

    if (r.ok) {
      if (s.digitada) lembrarSenha(s.senha);
      deVez.fechar();
      tirar(alvo);
      avisar(`"${r.nome}" foi excluído de vez.`);
      return;
    }
    if (r.erro === "nao-existe") {
      deVez.fechar();
      tirar(alvo);
      avisar(r.mensagem);
      return;
    }
    if (r.erro === "senha") {
      deVez.senhaErrada(r.mensagem);
      return;
    }
    deVez.mensagem(r.mensagem);
  });
}

if (document.body.dataset.pagina === "trabalhos") iniciarTrabalhos();
else iniciarExcluidos();

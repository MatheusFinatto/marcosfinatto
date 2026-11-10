---
id: 001
slug: enviar-e-excluir-pelo-site
status: implemented
source: 'conversa (sem TODO no projeto) :: Marcos envia, exclui (soft delete), restaura e exclui de vez PDFs pelo próprio site, com senha'
created: 2026-11-10
---

# Contrato de Implementação

**Autoridade:** se algo abaixo contradisser esta seção, vale esta seção.

**Mapa de leitura:**
- `/spec-implement`: esta seção, `# Requisitos Funcionais`, `# Arquivos Afetados`, `# Estratégia de Implementação`, `# Estratégia de Testes` e `# Critérios de Aceitação`. O resto pode pular.
- `/spec-audit`: esta seção e `# Decisões`. As alternativas recusadas em `# Decisões` são o que define escopo extra.
- Humano: `# Contexto`, `# Problema` e `# Riscos`.

## Estado final

O build gera duas abas:
- **`/` (Trabalhos):** lista o que está em `trabalhos/`. Tem o botão "Enviar trabalho" e um X no canto de cada card, que manda o trabalho para Excluídos.
- **`/excluidos` (Excluídos):** lista o que está em `excluidos/`. Cada card tem Abrir, Baixar e Restaurar, e um X no canto que exclui de vez.

Toda ação pede a senha, que fica lembrada por 10 minutos na aba do navegador, e chama uma função da Vercel. A função confere a senha no servidor e grava a mudança como **um único commit atômico** no repo, pela Git Data API do GitHub. A integração Git que a Vercel já usa publica cada commit, como hoje.

Nenhuma ação do site remove um arquivo sem antes passar por Excluídos, exceto "Excluir de vez".

## Modelo de dados no repo

| Caminho | Conteúdo | URL publicada |
|---|---|---|
| `trabalhos/<arquivo>.pdf` | trabalhos publicados (como hoje) | `/<slug>.pdf` |
| `excluidos/<ts>/<arquivo>.pdf` | um PDF excluído | `/excluidos/<id>.pdf` |

- **`<ts>`:** instante da exclusão em UTC, no formato `YYYY-MM-DDTHH-mm-ss-SSSZ`. Exemplo: `2026-11-10T17-03-22-123Z`. O servidor gera o valor a partir de `agora().toISOString()`, trocando `:` e `.` por `-`.
- **Nome de exibição:** o nome do arquivo sem o `.pdf` final, com `trim()`. É o mesmo cálculo de `build.mjs:37`.
- **`slug` de um trabalho:** `slugify(nome de exibição)`.
- **`id` de um excluído:** `slugify(ts + " " + nome de exibição)`.
- **Caminho válido em `trabalhos/`:** só filhos diretos, ou seja, caminhos que casam com `^trabalhos/([^/]+\.[pP][dD][fF])$`. A regex MUST ser usada exatamente assim, **sem a flag `i`**: `Trabalhos/X.pdf` não é trabalho, porque o build só lê a pasta `trabalhos/`. Subpastas e arquivos que não são PDF são ignorados pelas funções e pelo build. O build continua avisando dos ignorados, como faz hoje.
- **Caminho válido em `excluidos/`:** tem que casar com `^excluidos/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/([^/]+\.[pP][dD][fF])$`, sem a flag `i`. Um caminho fora desse padrão é ignorado pelas funções e pelo build, e o build avisa no log cada caminho ignorado em `excluidos/`.
- **Unicidade:** os slugs são únicos dentro de `trabalhos/`; o build já falha se não forem (`build.mjs:39`). Os `id` criados pelas funções são únicos por construção, mas uma pasta feita à mão pode repetir um. `classificar` MUST lançar um erro quando dois trabalhos têm o mesmo `slug` ou dois excluídos têm o mesmo `id`. No build, isso falha o build, como hoje. Nas funções, a exceção vira `github` (ver `api/index.js`). O mesmo nome pode existir ao mesmo tempo em `trabalhos/` e em `excluidos/`, e em mais de uma pasta `<ts>`.

## Componentes

| Arquivo | Papel |
|---|---|
| `lib/slug.js` | MUST exportar `slugify(s)`, com comportamento idêntico ao atual de `build.mjs:13-14`. A faixa de acentos fica escrita como `/[\u0300-\u036f]/g`. É a única definição de slug do projeto. |
| `lib/repo.js` | MUST exportar `classificar(caminhos)`. Recebe caminhos relativos à raiz do repo (por exemplo `trabalhos/X.pdf`) e devolve `{ trabalhos: [{ caminho, arquivo, nome, slug }], excluidos: [{ caminho, arquivo, nome, ts, id }] }`, aplicando o modelo de dados acima. O build e as funções MUST usar essa função. |
| `lib/github.js` | MUST concentrar o que é comum às funções: checagem de config, checagem de senha, `lerEstado`, `gravar`, mapeamento de erros, montagem das respostas e log. |
| `lib/acoes.js` | MUST exportar `processarEnvio`, `processarExclusao`, `processarRestauracao` e `processarExclusaoDefinitiva`. Todas têm a assinatura `(request, { env, fetch, agora = () => new Date() })` e devolvem um `Response` Web. Nenhuma guarda estado global. |
| `api/index.js` | Única função da Vercel, servida em `/api`. MUST exportar `export default { async fetch(request) }`. Aceita só `POST`; qualquer outro método recebe 405, com o corpo de `invalido`. A ação vem do parâmetro de URL `acao`: `enviar`, `excluir`, `restaurar` ou `excluir-de-vez`. Qualquer outro valor recebe 400 `invalido`. Chama a função correspondente de `lib/acoes.js` com `{ env: process.env, fetch: globalThis.fetch }`. MUST envolver tudo num `try/catch`: uma exceção não tratada vira a resposta JSON `github` e a linha de log com `gh=excecao:<duplicado|outro>`. Também grava a linha de log dos 405 e 400 (ver **Log**). Não tem nenhuma outra lógica. |
| `site/app.js` | JS do cliente das duas páginas. O build copia para `dist/app.js`. As páginas carregam com `<script src="/app.js" defer>`. |
| `build.mjs` | Ver "Build" abaixo. |
| `vercel.json` | MUST adicionar estes headers:<br>• `X-Content-Type-Options: nosniff` em todas as rotas (`"source": "/(.*)"`);<br>• `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'` só nas rotas HTML (`/`, `/index.html`, `/excluidos`, `/excluidos/`, `/excluidos/index.html`). Os PDFs ficam sem CSP para não interferir no leitor de PDF do navegador (D-032);<br>• `X-Robots-Tag: noindex` em `/excluidos` e `/excluidos/(.*)`. |
| `package.json` | MUST adicionar `"test": "node --test"`. MUST NOT adicionar dependências. |

## Variáveis de ambiente

| Variável | Obrigatória | Default | Uso |
|---|---|---|---|
| `UPLOAD_PASSWORD` | sim | — | senha de todas as ações, escolhida pelo Marcos |
| `GITHUB_TOKEN` | sim | — | token fine-grained, só deste repo, com `Contents: Read and write` |
| `GITHUB_REPO` | não | `MatheusFinatto/marcosfinatto` | destino, no formato `dono/repo` |
| `GITHUB_BRANCH` | **sim** | — (sem padrão) | branch de destino: `master` em Production, a branch de teste em Preview |

## Constraints

| Item | Valor |
|---|---|
| Tamanho máximo do PDF | **4.194.304 bytes** (4 MiB), conferido no navegador **e** no servidor |
| Assinatura de PDF | os 5 primeiros bytes MUST ser `%PDF-` |
| Nome no site | de 1 a 100 caracteres depois de normalizado **e** `Buffer.byteLength(nome + ".pdf", "utf8") <= 200`. O sistema de arquivos aceita no máximo 255 bytes por nome. |
| Caracteres proibidos no nome | `/`, `\`, U+0000–U+001F, U+007F |
| `slug` e `id` aceitos pelas ações | `^[a-z0-9]+(-[a-z0-9]+)*$`, até 200 caracteres |
| Validade da senha lembrada | **600.000 ms** a partir da resposta `ok` em que ela foi digitada; não renova com uso |
| Limite de tentativas de senha | **nenhum** |
| Arquivos por envio | 1 |
| Timeout de cada chamada ao GitHub | 15.000 ms (`AbortSignal.timeout(15000)`) |

## Algoritmo comum às funções, nesta ordem

1. **Config.** Se `env.UPLOAD_PASSWORD`, `env.GITHUB_TOKEN` ou `env.GITHUB_BRANCH` estiver ausente ou vazio depois de `trim()`, responder `config` sem ler o corpo.
2. **Leitura.** Ler o corpo no formato da ação. Se falhar, ou se faltar um campo, ou se um campo vier com o tipo errado, responder `invalido`. Um `slug` ou `id` fora da regra de Constraints também é `invalido`.
3. **Senha.** Calcular o SHA-256 de `senha.trim()` e o de `env.UPLOAD_PASSWORD.trim()`, e comparar os dois com `crypto.timingSafeEqual`. A comparação diferencia maiúsculas de minúsculas. Se não bater, responder `senha`. **Nenhuma chamada ao GitHub acontece antes deste passo.**
4. **Validações próprias da ação** que não dependem do repo (só no Enviar).
5. **`lerEstado`:**
   1. `GET /repos/{repo}/git/ref/heads/{branch}` → `head`, que é o SHA do commit.
   2. `GET /repos/{repo}/git/commits/{head}` → `baseTree`.
   3. `GET /repos/{repo}/git/trees/{baseTree}?recursive=1` → as entradas com `type === "blob"`, cada uma com `path` e `sha`. Se vier `truncated: true`, responder `github`.
   4. Passar os caminhos por `classificar`, mantendo o `sha` de cada item.
6. **Decisão da ação** (abaixo), que produz uma lista de `mudancas` e uma `mensagem`.
7. **`gravar(mudancas, mensagem)`:**
   1. Para cada mudança com conteúdo novo: `POST /repos/{repo}/git/blobs` com `{ content: <base64>, encoding: "base64" }` → `sha`.
   2. `POST /repos/{repo}/git/trees` com `{ base_tree: baseTree, tree: [{ path, mode: "100644", type: "blob", sha }] }`. `sha: null` remove o caminho. Mover um arquivo é um par: `{ path: destino, sha: <sha existente> }` mais `{ path: origem, sha: null }`, sem reenviar o conteúdo.
   3. `POST /repos/{repo}/git/commits` com `{ message, tree, parents: [head] }`.
   4. `PATCH /repos/{repo}/git/refs/heads/{branch}` com `{ sha: <commit novo>, force: false }`.
8. **Erros do GitHub**, em qualquer chamada dos passos 5 e 7:

   | Resposta do GitHub | Erro devolvido |
   |---|---|
   | 401, 403 ou 404 | `fora-do-ar` |
   | 409 em qualquer chamada, ou 422 no `PATCH` do ref | `conflito` |
   | qualquer outro status, erro de rede, timeout de 15 s ou `truncated` | `github` |

Toda chamada ao GitHub MUST usar `signal: AbortSignal.timeout(15000)` (D-035) e enviar estes headers:
- `Authorization: Bearer <GITHUB_TOKEN>`
- `Accept: application/vnd.github+json`
- `X-GitHub-Api-Version: 2022-11-28`
- `User-Agent: marcosfinatto-site`

O commit MUST NOT definir `author` nem `committer`; vale a identidade do token.

**Log (D-033):** exatamente uma linha por requisição, no formato `<acao>: <erro|ok> <slug|id?> gh=<passo>:<status>`.
- O trecho `gh=` só aparece quando o erro veio do GitHub ou de uma exceção.
- `<passo>` é um destes: `ref`, `commit`, `tree`, `blob`, `novatree`, `novocommit`, `patch` ou `excecao`.
- `<status>` é o código HTTP, `rede`, `timeout` ou `truncated` (só com `tree`). Com `excecao`, é `duplicado` quando `classificar` lançou erro por `slug` ou `id` repetido, e `outro` em qualquer outra exceção.
- Os 405 e 400 de `api/index.js` geram a linha `api: invalido metodo=<método>` ou `api: invalido acao=?`. O valor de `acao` vindo da URL MUST NOT ir para o log, porque um `%0A` quebraria a linha e permitiria forjar uma linha de `ok`.
- `classificar` lança um `Error` com `code: "duplicado"`. `api/index.js` loga `excecao:duplicado` quando `err.code === "duplicado"` e `excecao:outro` em qualquer outro caso.
- Assim o dono separa token vencido (401), falta de permissão (403) e repo ou branch errados (404), que para o Marcos aparecem como a mesma mensagem.
- MUST NOT logar corpo, headers, senha nem token.

## Ações

### Enviar: `POST /api?acao=enviar`

- **Corpo:** `multipart/form-data` com `senha` (texto), `nome` (texto), `arquivo` (`File`) e `substituir` (opcional; só conta se for exatamente `"1"`).
- **Passo 4:**
  - se `arquivo.size > 4194304`, responder `grande`;
  - se os 5 primeiros bytes não forem `%PDF-` (vale também para arquivo vazio), responder `nao-pdf`;
  - normalizar o nome nesta ordem: `normalize("NFC")`, `trim()`, remover um `.pdf` final (sem diferenciar maiúsculas) e `trim()` de novo;
  - responder `nome` se o comprimento ficar fora de 1 a 100, se passar do limite de bytes de Constraints, se houver caractere proibido, ou se `slugify(nome)` der `""`. Daqui em diante, `slug = slugify(nome)`.
- **Passo 6:** procurar em `trabalhos` um item com o mesmo `slug`.
  - **Existe e `substituir !== "1"`:** responder `existe`, com `existente: <nome dele>`.
  - **Existe e `substituir === "1"`:**
    - mudanças:
      - o conteúdo novo vai para `existente.caminho`;
      - o `sha` antigo vai para `excluidos/<ts>/<existente.arquivo>`;
    - mensagem: `Substitui trabalho: <existente.nome>`;
    - resposta: `{ ok: true, nome: existente.nome, url: "/<slug>.pdf", substituido: true }`.
  - **Não existe:**
    - mudança: o conteúdo novo vai para `trabalhos/<nome>.pdf`;
    - mensagem: `Envia trabalho: <nome>`;
    - resposta: `{ ok: true, nome, url: "/<slug>.pdf", substituido: false }`.

### Excluir: `POST /api?acao=excluir`

- **Corpo:** JSON `{ "senha": string, "slug": string }`.
- **Passo 6:** procurar em `trabalhos` o item com esse `slug`. Se não houver, responder `nao-existe`.
  - mudança: mover `caminho` para `excluidos/<ts>/<arquivo>`;
  - mensagem: `Exclui trabalho: <nome>`;
  - resposta: `{ ok: true, nome, id }`, em que `id` é o do novo item em `excluidos/`. O Desfazer usa esse `id`.

### Restaurar: `POST /api?acao=restaurar`

- **Corpo:** JSON `{ "senha": string, "id": string, "trocar"?: boolean }`.
- **Passo 6:** procurar em `excluidos` o item com esse `id`. Se não houver, responder `nao-existe`. Em seguida, procurar em `trabalhos` um item `atual` com `slug === slugify(excluido.nome)`.
  - **`atual` existe e `trocar !== true`:** responder `existe`, com `existente: atual.nome`.
  - **`atual` existe e `trocar === true`:**
    - mudanças:
      - `excluido.sha` vai para `trabalhos/<excluido.arquivo>`;
      - `excluido.caminho` recebe `null`;
      - `atual.sha` vai para `excluidos/<ts>/<atual.arquivo>`;
      - se `atual.caminho !== "trabalhos/" + excluido.arquivo`, então `atual.caminho` também recebe `null`;
    - mensagem: `Restaura trabalho: <excluido.nome>`;
    - resposta: `{ ok: true, nome: excluido.nome, url: "/<slug>.pdf", trocado: true }`.
  - **Não existe:**
    - mudança: mover `excluido.caminho` para `trabalhos/<excluido.arquivo>`;
    - mensagem: igual ao caso anterior;
    - resposta: `trocado: false`.

### Excluir de vez: `POST /api?acao=excluir-de-vez`

- **Corpo:** JSON `{ "senha": string, "id": string }`.
- **Passo 6:** procurar em `excluidos` o item com esse `id`. Se não houver, responder `nao-existe`.
  - mudança: `caminho` recebe `null`;
  - mensagem: `Exclui de vez: <nome>`;
  - resposta: `{ ok: true, nome }`.

## Respostas de erro

Toda resposta da função, de sucesso ou de erro, MUST ser JSON com `Content-Type: application/json; charset=utf-8`. O corpo de erro é sempre `{ ok: false, erro, mensagem }`. No erro `existe`, o corpo também traz `existente`. As mensagens são exatamente estas:

| `erro` | HTTP | `mensagem` |
|---|---|---|
| `config` | 500 | `O site está sem acesso para mudanças. Avisa quem cuida do site.` |
| `invalido` | 400 | `Não deu para ler o pedido. Recarrega a página e tenta de novo.` |
| `senha` | 401 | `Senha errada.` |
| `grande` | 413 | `Arquivo grande demais (máximo 4 MB). Exporta o PDF de novo com qualidade menor e tenta outra vez.` |
| `nao-pdf` | 400 | `Esse arquivo não é um PDF. Exporta como PDF e tenta de novo.` |
| `nome` | 400 | `Escolhe outro nome: com letras ou números, não muito longo, sem / nem \.` |
| `existe` (enviar) | 409 | `Já existe "<existente>" no site. Quer substituir pelo arquivo novo? O atual vai para Excluídos.` |
| `existe` (restaurar) | 409 | `Já existe "<existente>" no site. Quer trocar? O atual vai para Excluídos.` |
| `nao-existe` | 404 | `Esse trabalho não está mais aqui. Recarrega a página.` |
| `conflito` | 409 | `O site mudou enquanto você fazia isso. Tenta de novo.` |
| `fora-do-ar` | 503 | `O site está sem acesso para mudanças. Avisa quem cuida do site.` |
| `github` | 502 | `Não deu para fazer isso agora. Tenta de novo em alguns minutos.` |

## Páginas

### Barra do topo (nas duas páginas)

- Tem `max-width: 720px; margin: 0 auto 16px`, a mesma largura máxima do `ul` (`build.mjs:70`). É um `display: flex` com `justify-content: space-between`, `flex-wrap: wrap` e `gap: 12px`.
- **À esquerda:** `<nav aria-label="Seções">` como controle segmentado, com dois links: "Trabalhos" (`/`) e "Excluídos" (`/excluidos`).
  - Borda e raio iguais aos do grupo `.fmt` (`build.mjs:75-78`).
  - A aba ativa leva `aria-current="page"`, fundo `#f3f4f6` e peso 600.
  - "Excluídos" mostra a quantidade num selo (fundo `#e5e5e5`, 12 px, `border-radius: 999px`) quando ela for maior que 0.
- **À direita, só em `/`:** botão "Enviar trabalho" com ícone de upload. Fundo `#222`, texto branco, raio de 6 px, hover `#000`.

### `/` (Trabalhos)

- Cards como os de hoje, com `data-slug` e `data-nome`.
- Cada card tem um X no canto superior direito: área de toque de no mínimo 36×36 px, cor `#777`, hover `#222`, `aria-label="Excluir <nome>"`. O card ganha `padding-right` suficiente para o X não cobrir o conteúdo.
- Lista vazia: `Nenhum trabalho ainda.`
- **Diálogo "Enviar trabalho"** (`<dialog>`):
  - Campos, nesta ordem:
    1. arquivo, com `accept="application/pdf,.pdf"`;
    2. "Nome no site", preenchido ao escolher o arquivo com o nome dele sem extensão, em NFC, e editável;
    3. senha, só quando não houver senha lembrada válida;
    4. os botões "Enviar" e "Cancelar".
  - Antes de enviar, conferir se há arquivo e se tem no máximo 4.194.304 bytes. Se passar disso, mostrar a mensagem de `grande` sem fazer a requisição.
  - Se a resposta for `existe`, mostrar a mensagem com os botões "Substituir" (reenvia com `substituir=1`) e "Cancelar".
  - Se der certo, mostrar `Enviado! Em cerca de 1 minuto aparece aqui. Recarrega a página para ver.` e o botão "Fechar". Se foi uma substituição (`substituido: true`), somar 1 no selo de Excluídos.
- **Diálogo "Excluir"** (abre ao tocar no X):
  - Texto: `Excluir "<nome>"? Ele vai para Excluídos e dá para restaurar depois.`
  - Campo de senha, só quando necessário, e os botões "Excluir" e "Cancelar".
  - MUST abrir **sempre**, mesmo com senha lembrada.
  - Se der certo:
    - fechar o diálogo;
    - tirar o card do DOM, guardando o elemento e a posição dele;
    - somar 1 no selo de Excluídos, criando o selo se ainda não existir;
    - mostrar o aviso `"<nome>" foi para Excluídos. Aparece lá em cerca de 1 minuto.` com o botão **Desfazer**;
    - se a lista ficar vazia, mostrar `Nenhum trabalho ainda.`
- **Desfazer** (D-031):
  - Chama `restaurar` com o `id` devolvido pela exclusão, sem `trocar`. Com senha lembrada válida, vai direto. Sem ela, abre o diálogo de restaurar, que o build inclui **nas duas páginas** e o `app.js` compartilha.
  - Se der certo, o card volta para a posição original e o aviso vira `"<nome>" voltou.` Sem troca, o selo perde 1. Com troca (`trocado: true`), o selo não muda, e o card atual com o mesmo slug sai da lista, se estiver na página.
  - Se a resposta for `existe`, o mesmo diálogo de restaurar mostra a mensagem com [Trocar] e [Cancelar].
  - O botão some na próxima ação ou ao recarregar a página.

### `/excluidos` (Excluídos)

- Gerada como `dist/excluidos/index.html`, com `<meta name="robots" content="noindex">`.
- Itens ordenados por `ts`, do mais recente para o mais antigo.
- **Card:**
  - nome;
  - linha `excluído em <data>`, calculada a partir de `ts` com o mesmo `fmtData` em `America/Sao_Paulo`;
  - grupo `.fmt` com [Abrir | Baixar], apontando para `/excluidos/<id>.pdf`;
  - botão "Restaurar", com ícone de seta circular, no mesmo estilo de botão;
  - X no canto, com `aria-label="Excluir de vez <nome>"`;
  - o `<li>` leva `data-id` e `data-nome`.
- Lista vazia: `Nada excluído.`
- **Restaurar:**
  - Com senha lembrada válida, envia direto. Sem ela, abre um diálogo com a senha e os botões [Restaurar] [Cancelar].
  - Se a resposta for `existe`, o diálogo mostra a mensagem com [Trocar] (reenvia com `trocar: true`) e [Cancelar].
  - Se der certo: tirar o card e mostrar o aviso `"<nome>" voltou para Trabalhos. Aparece lá em cerca de 1 minuto.` Sem troca, o selo perde 1. Com troca (`trocado: true`), o selo não muda, porque um item sai e outro entra.
- **X (excluir de vez):**
  - MUST abrir **sempre** o diálogo `Excluir "<nome>" de vez? Não dá para desfazer pelo site.`
  - O diálogo tem o campo de senha, quando necessário, o botão "Excluir de vez" (fundo `#b91c1c`, texto branco) e "Cancelar".
  - Se der certo: tirar o card, subtrair 1 do selo e mostrar o aviso `"<nome>" foi excluído de vez.`

### Comportamento comum do cliente (`site/app.js`)

- **Guardar a senha:** depois de uma resposta `ok: true` a uma ação em que a senha foi digitada, gravar `{ senha, expira: Date.now() + 600000 }` em `sessionStorage`, na chave `marcosfinatto:senha`.
- **Senha lembrada válida:** é a que existe e tem `Date.now() < expira`. O uso não renova a validade.
- **Apagar a senha vencida (D-034):**
  - ao carregar a página e a cada leitura, se `Date.now() >= expira`, fazer `removeItem`;
  - ao gravar uma senha, ou ao carregar uma ainda válida, agendar um `setTimeout` que apaga a entrada no instante `expira`;
  - a variável em memória segue a mesma regra.

  Com a página aberta, a senha nunca fica guardada depois de vencer.
- **Quando pedir a senha:** a decisão acontece no momento de enviar, não ao abrir o diálogo. Se não houver senha lembrada válida e o campo de senha estiver escondido ou vazio, mostrar o campo, dar foco nele e não enviar.
- **Resposta `nao-existe`:** tirar o card correspondente, se ainda estiver na página, e mostrar a `mensagem`.
- **Resposta `senha`:** apagar a senha lembrada, mostrar o campo de senha vazio e com foco, e manter o resto do que estava preenchido.
- **Falha do `sessionStorage`:** toda leitura e escrita fica dentro de `try/catch`. Se falhar, usar uma variável em memória com a mesma regra de validade.
- **Durante a requisição:** o botão de ação fica desabilitado e mostra um texto de progresso ("Enviando…", "Excluindo…", "Restaurando…").
- **Resposta que não é JSON:** se o status for 413, mostrar a mensagem de `grande`; em qualquer outro caso, a de `github`.
- **Avisos:** ficam num `<p role="status">` acima da lista.
- **Textos vindos do servidor ou do usuário:** sempre por `textContent`, nunca por `innerHTML`.
- **Layout:** funciona em 360 px de largura sem rolagem horizontal.
- **Lista vazia:** se `/excluidos` ficar sem itens depois de uma ação, mostrar `Nada excluído.`, e o selo some quando chega a 0.

### Build (`build.mjs`)

- MUST importar `slugify` de `./lib/slug.js` e apagar a definição local.
- MUST montar as listas com `classificar`, a partir dos arquivos de `trabalhos/` e `excluidos/*/`. Se uma pasta não existir, a lista dela fica vazia.
- `trabalhos`: continua igual ao de hoje, incluindo a data por `addedAt`, a ordenação, os slugs, as URLs e o erro quando dois arquivos têm o mesmo slug.
- **Histórico completo (D-028):** antes de calcular qualquer data, o build roda `git rev-parse --is-shallow-repository`. Se a saída for `true`, MUST tentar, em ordem, até a primeira que der certo:
  1. `git fetch --unshallow --quiet origin`;
  2. se `VERCEL_GIT_REPO_OWNER` e `VERCEL_GIT_REPO_SLUG` existirem, `git fetch --unshallow --quiet https://github.com/<owner>/<slug>.git`.

  Cada tentativa tem timeout de 60 s (`execFileSync` com `timeout: 60000`), roda com `GIT_TERMINAL_PROMPT=0` no ambiente e não repassa o stderr do git para o log. Uma tentativa só conta como bem-sucedida se, depois dela, `git rev-parse --is-shallow-repository` devolver `false`. Se uma der certo, o log mostra `Histórico do git completo.`. Se todas falharem, MUST registrar `Aviso: histórico do git incompleto; as datas dos trabalhos podem estar erradas.` com `console.warn` e seguir com o build, que não pode falhar por isso. Fora de um clone raso, ou sem git, o passo não faz nada.
- MUST copiar os PDFs excluídos para `dist/excluidos/<id>.pdf` e gerar `dist/excluidos/index.html`.
- MUST copiar `site/app.js` para `dist/app.js`.
- **Escape (D-032):** toda interpolação no HTML gerado, em texto e em atributos (`data-*`, `aria-label`, `href`, `download`), MUST passar por `escape()` (`build.mjs:16-17`).
- **Servidor de dev (`--serve`):**
  - MUST servir o `index.html` de um diretório, em `/excluidos` e em `/excluidos/`;
  - MUST servir `.js` como `text/javascript; charset=utf-8`;
  - MUST NOT executar a função de `/api`.

## MUST NOT

- MUST NOT limitar tentativas de senha, nem criar armazenamento para isso.
- MUST NOT colocar a senha ou o token no código, no repo, no HTML ou nos logs.
- MUST NOT existir página de envio separada (`/enviar`).
- MUST NOT renomear trabalhos pelo site.
- MUST NOT mudar a ordenação, os slugs ou as URLs dos trabalhos que já existem.
- MUST NOT aceitar nenhum formato além de PDF, nem converter arquivos.
- MUST NOT usar Vercel Blob ou outro armazenamento. O único destino é o repo.
- MUST NOT gravar pela API de conteúdo do GitHub (`/contents`). Toda gravação usa a Git Data API, com um commit por ação.
- MUST NOT remover um arquivo do repo fora da ação "Excluir de vez". Excluir, substituir e trocar sempre passam por `excluidos/`.
- MUST NOT excluir ou excluir de vez sem o diálogo de confirmação.
- MUST NOT lembrar a senha por mais de 10 minutos, nem guardá-la em `localStorage`, cookie ou URL.
- MUST NOT inserir texto do servidor ou do usuário com `innerHTML`.
- MUST NOT interpolar texto no HTML do build sem `escape()`.
- MUST NOT usar script inline ou handler inline (`onclick=` etc.) nas páginas, porque a CSP bloqueia.
- MUST NOT adicionar dependências npm, a Vercel CLI ou um framework.
- MUST NOT criar mais de um arquivo em `api/`. A Vercel cria uma função por arquivo e recomenda não ter uma função por endpoint (D-027).

# Contexto

O site `marcosfinatto.vercel.app` é uma lista estática de PDFs. O `build.mjs` gera essa lista a partir da pasta `trabalhos/`, e a Vercel publica a cada push na Production Branch do projeto, hoje `master`. Isso fica nas configurações da Vercel, não no `vercel.json`. O projeto não tem dependências, e o README promete que continua assim.

O Marcos tem 14 anos e abre o site em aula. Hoje, cada trabalho novo depende de o dono do repo receber o arquivo e fazer commit e push.

Fatos sobre a Vercel, verificados na documentação oficial em 2026-11-10:
- O corpo da requisição e da resposta de uma função vai até 4,5 MB. Acima disso, a resposta é 413 `FUNCTION_PAYLOAD_TOO_LARGE` ([limitations](https://vercel.com/docs/functions/limitations)).
- No plano Hobby, a duração padrão e a máxima são 300 s.
- As versões de Node disponíveis são 26.x (padrão), 24.x e 22.x ([node-js-versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)).
- ESM vale com `"type": "module"` ([node-js](https://vercel.com/docs/functions/runtimes/node-js)).
- O build faz `git clone --depth=10` ([configure-a-build](https://vercel.com/docs/builds/configure-a-build)). Nenhuma forma de clonar o histórico completo está documentada.

O repo é público. A consulta `gh api repos/MatheusFinatto/marcosfinatto` devolve `"private": false`. Os PDFs atuais têm entre 150 e 360 KB. Pelo `curl -I` de 2026-11-10, o site serve os PDFs como `application/pdf` e sem `nosniff`.

# Problema

O Marcos não consegue publicar, tirar do ar nem corrigir um trabalho sozinho. Tudo passa pelo dono do repo, e o GitHub não é uma ferramenta amigável para ele.

# Objetivo

O Marcos envia, exclui, restaura e exclui de vez os próprios PDFs pelo site, usando só uma senha. Nenhuma ação feita por engano é definitiva, a não ser "Excluir de vez". Tudo continua versionado no git. O dono não recebe aviso das ações (D-029): fica sabendo pelo site e pelo histórico de commits.

# Decisões

> Apêndice de auditoria. O implementador não lê esta seção: o que vale é o contrato acima.

## D-001 — Por onde o Marcos publica
Problema: como o Marcos publica sem passar pelo dono.
Alternativas: (A) pelo GitHub web, como colaborador; (B) por uma pasta no Google Drive sincronizada com Apps Script e Deploy Hook; (C) por uma página no site sem credencial; (D) por uma página no site com link secreto; (E) pelo site, com senha.
Decisão: E.
Motivo: o dono acha o GitHub pouco amigável para um adolescente de 14 anos (A) e quer tudo pelo próprio site, o que descarta B. C foi recusada: o endereço é aberto em aula, e qualquer colega ou bot publicaria o que quisesse numa conta da Vercel que é do dono. D e E dão a mesma segurança, e o dono escolheu E.

## D-002 — Quem escolhe a senha
Problema: usar uma senha gerada (quatro palavras aleatórias) ou deixar o Marcos escolher.
Alternativas: (A) gerada; (B) escolhida pelo Marcos.
Decisão: B.
Motivo: a senha gerada só sai de graça se ficar salva no celular. No computador da escola ela não deve ficar salva, então ele precisa lembrar. A orientação para ele é não usar nada que um amigo saiba (aniversário, nome do bicho, time, apelido). O dono aceita o risco (R-01).

## D-003 — Limite de tentativas de senha
> Premissa corrigida pela D-029: commits não geram notificação. O risco continua aceito (R-01).

Problema: limitar ou não as tentativas.
Alternativas: (A) limitar, o que exige um armazenamento externo (KV) numa função serverless; (B) não limitar.
Decisão: B.
Motivo: decisão do dono. Um acerto vira commits, que geram notificação e podem ser revertidos. Um armazenamento só para contar tentativas traria mais uma conta, mais um segredo e mais uma dependência.

## D-004 — Onde o arquivo é gravado
> Premissa corrigida pela D-029: o "e-mail do GitHub" citado no motivo não existe.
> SUPERSEDED em parte por D-020: o destino continua sendo o repo, mas a gravação passa a usar a Git Data API, e não mais a API de conteúdo.

Problema: commit no repo ou armazenamento separado.
Alternativas: (A) commit em `trabalhos/` pela API do GitHub; (B) Vercel Blob, com upload direto do navegador.
Decisão: A, com limite de 4 MiB por arquivo.
Motivo: A mantém o build de hoje, a data tirada do commit (`build.mjs:20-26`), o `git revert` e o e-mail do GitHub. O limite vem do teto de 4,5 MB no corpo da requisição das funções da Vercel. Os PDFs reais têm menos de 400 KB.

## D-005 — Como validar que o arquivo é PDF
Problema: o que conta como prova de que é PDF.
Alternativas: (A) a extensão ou o MIME que o navegador informa; (B) os 5 primeiros bytes serem `%PDF-`.
Decisão: B.
Motivo: extensão e MIME são definidos por quem envia, então não provam nada.

## D-006 — Envio com nome que já existe
> Complementada por D-018: na substituição, a versão antiga vai para Excluídos.

Problema: o que fazer quando o slug do nome novo já existe em `trabalhos/`.
Alternativas: (A) perguntar e substituir; (B) recusar.
Decisão: A. A comparação é pelo slug, e o arquivo substituído mantém o nome antigo.
Motivo: nome repetido quase sempre é uma versão corrigida. Comparar pelo slug evita que dois arquivos gerem o mesmo link e quebrem o build (`build.mjs:39`).

## D-007 — Link para a página de envio
> SUPERSEDED por D-012: a página de envio separada deixou de existir.

Problema: mostrar ou não um link para `/enviar`.
Alternativas: (A) nenhum link, só um favorito; (B) um link discreto no rodapé.
Decisão: B.
Motivo: escolha do dono. A recomendação contrária (A) fica registrada.

## D-008 — Apagar e renomear pelo site
> SUPERSEDED por D-013 e D-015: apagar entra no escopo, como soft delete. Renomear continua fora.

Problema: incluir isso na v1.
Alternativas: (A) incluir; (B) deixar de fora.
Decisão: B.
Motivo: manter a v1 pequena.

## D-009 — Lógica compartilhada entre o build e as funções
Problema: o build e as funções precisam calcular o mesmo slug e classificar os caminhos do mesmo jeito.
Alternativas: (A) copiar o código; (B) módulos compartilhados (`lib/slug.js` e `lib/repo.js`).
Decisão: B.
Motivo: se as cópias divergirem, a checagem de colisão deixa passar um nome que quebra o build (`build.mjs:39`). Com o build quebrado, nada novo é publicado, e ninguém é avisado.

## D-010 — Teste de ponta a ponta
Problema: como testar as funções de verdade.
Alternativas: (A) o servidor de dev rodar as funções; (B) um Preview da Vercel com `GITHUB_BRANCH` apontando para uma branch de teste.
Decisão: B, junto com testes unitários sobre um GitHub falso em memória.
Motivo: A exige adaptar o servidor de dev ou instalar a Vercel CLI, que não está instalada. B testa na plataforma real sem encostar em `master`.

## D-011 — Sem dependências
Problema: usar bibliotecas ou só as APIs nativas.
Alternativas: (A) bibliotecas (`@vercel/blob`, `formidable`, `@octokit/rest`); (B) só nativas: `Request.formData()`, `fetch` e `node:crypto`, todas do Node 22.
Decisão: B.
Motivo: o README promete zero dependências, e as APIs nativas resolvem.

## D-012 — Tudo na página principal
Problema: onde ficam o envio e a exclusão.
Alternativas: (A) uma página `/enviar` separada, com link no rodapé (D-007); (B) uma página separada sem link, só com favorito; (C) um botão de envio e um X em cada card, direto na página principal.
Decisão: C.
Motivo: escolha do dono. A recomendação anterior (B) fica registrada. O custo de C é que os botões ficam à vista de toda a turma (R-02).

## D-013 — Uma senha só para todas as ações
Problema: excluir, restaurar e excluir de vez usam a mesma senha do envio?
Alternativas: (A) a mesma senha; (B) uma senha separada para ações destrutivas.
Decisão: A.
Motivo: escolha do dono. Duas senhas pesam para um adolescente. Quem descobrir a senha consegue fazer tudo (R-01).

## D-014 — Lembrar a senha
> Complementada pela D-034: a senha vencida é apagada ativamente. O "some quando a aba fecha" do motivo abaixo não é garantido, porque o `sessionStorage` volta quando a aba fechada é reaberta.

Problema: pedir a senha em toda ação ou lembrar dela.
Alternativas: (A) pedir em toda ação; (B) lembrar até a aba fechar; (C) lembrar por 10 minutos.
Decisão: C. A validade é fixa, conta a partir da digitação e não se renova com o uso. A senha fica em `sessionStorage`.
Motivo: escolha do dono. A validade fixa limita quanto tempo a senha fica exposta num computador compartilhado (R-11). Já o `sessionStorage` faz a senha valer nas duas abas do site dentro da mesma aba do navegador e some quando a aba fecha. `localStorage` foi recusado porque não expira sozinho.

## D-015 — Excluir é soft delete
Problema: excluir remove o arquivo ou só tira da lista?
Alternativas: (A) remover de verdade (hard delete); (B) mover para uma pasta `excluidos/`; (C) marcar como excluído num arquivo de índice.
Decisão: B.
Motivo: pedido do dono. B não exige formato novo de arquivo: o build lê a pasta direto, e o git registra cada movimento. C criaria um segundo lugar onde a verdade mora.

## D-016 — Uma pasta por exclusão
> Nota da revisão: "cada `id` é único" vale para as pastas criadas pelas funções. Uma pasta feita à mão pode repetir um `id`, e o build falha nesse caso (modelo de dados).

Problema: como guardar mais de um excluído com o mesmo nome.
Alternativas: (A) `excluidos/<arquivo>.pdf`, guardando só o mais recente; (B) um sufixo de data no nome do arquivo; (C) `excluidos/<ts>/<arquivo>.pdf`.
Decisão: C.
Motivo: A apaga em silêncio a versão excluída antes, e o soft delete existe justamente para nada sumir sem querer. B obrigaria a separar a data do nome, o que quebra se o próprio nome do trabalho tiver algo parecido. Em C, o nome da pasta já dá a data da exclusão sem consultar o git, e cada `id` é único.

## D-017 — O que aparece na aba Excluídos
Problema: os excluídos continuam acessíveis e o que dá para fazer com eles.
Alternativas: (A) só o nome e o botão Restaurar, sem servir o PDF; (B) Abrir, Baixar, Restaurar e Excluir de vez.
Decisão: B.
Motivo: escolha do dono. A recomendação contrária (A) fica registrada: um PDF de zoeira excluído continua público até ser excluído de vez. O "Excluir de vez" é a saída para esse caso (R-13).

## D-018 — Substituir manda a versão antiga para Excluídos
Problema: no envio com substituição, o que acontece com a versão antiga.
Alternativas: (A) vai para Excluídos; (B) fica só no histórico do git.
Decisão: A, no mesmo commit da substituição.
Motivo: é coerente com o soft delete. Uma substituição errada se desfaz pelo Restaurar, sem precisar do dono.

## D-019 — Restaurar com um nome que já está publicado
Problema: o que fazer se já existe em `trabalhos/` um item com o mesmo slug do que está sendo restaurado.
Alternativas: (A) perguntar e trocar os dois; (B) recusar.
Decisão: A, num commit só: o restaurado volta, e o atual vai para Excluídos.
Motivo: nenhum dos dois se perde. Com B, seriam dois passos para chegar ao mesmo resultado.

## D-020 — Gravar pela Git Data API
> Nota da revisão: a documentação do GitHub só cita o limite de 100 MB na *leitura* de blob; o limite de criação não está documentado. O teste de ponta a ponta 7, com um PDF de cerca de 4 MB, prova que funciona.

Problema: como gravar mudanças que mexem em mais de um arquivo (mover, trocar, substituir com arquivamento).
Alternativas: (A) a API de conteúdo (`/contents`), que grava um arquivo por commit; (B) a Git Data API (blob, árvore, commit e ref).
Decisão: B, para todas as ações.
Motivo: com A, mover um arquivo vira dois commits. Se o segundo falhar, o arquivo fica duplicado ou some. B grava tudo num commit atômico, move arquivos sem reenviar o conteúdo, aceita blobs maiores que os 4 MiB que vamos usar (isso também resolve a dúvida de tamanho que a API de conteúdo deixava) e lê o repo inteiro num só snapshot. O `PATCH` do ref com `force: false` detecta quando outra gravação aconteceu no meio.

## D-021 — Quando pedir confirmação
Problema: quais ações confirmam antes de executar.
Alternativas: (A) nenhuma; (B) todas; (C) só as que tiram algo de onde está.
Decisão: C. Excluir e Excluir de vez sempre confirmam, mesmo com a senha lembrada. Enviar e Restaurar só confirmam quando há substituição ou troca.
Motivo: no celular é fácil tocar no X sem querer. Restaurar e enviar algo novo não tiram nada do lugar.

## D-022 — Link para a aba Excluídos
Problema: como chegar em `/excluidos` a partir da página principal. O dono pediu "algo bonito".
Alternativas: (A) um link no rodapé; (B) um botão solto; (C) um controle segmentado com as abas "Trabalhos | Excluídos", mostrando a contagem.
Decisão: C.
Motivo: C mostra em que aba a pessoa está, deixa claro que há itens excluídos e repete o estilo de botão que o site já usa (`.fmt`), em vez de criar um elemento visual novo.

## D-023 — JS do cliente num arquivo próprio
Problema: onde fica o JS das páginas.
Alternativas: (A) inline, dentro do template em `build.mjs`; (B) em `site/app.js`, copiado no build.
Decisão: B.
Motivo: o JS ficou grande demais para morar dentro de uma template string, onde cada `${` e cada crase precisam de escape. Em arquivo próprio, ele também serve às duas páginas sem duplicar.

## D-024 — Build com pastas ausentes
Problema: o git não guarda pasta vazia. Depois de excluir o último trabalho, `trabalhos/` deixa de existir no clone, e hoje o `readdirSync` (`build.mjs:29`) falharia.
Alternativas: (A) manter um `.gitkeep`; (B) o build tratar a pasta ausente como lista vazia.
Decisão: B.
Motivo: A depende de ninguém apagar o `.gitkeep`, e o build atual ainda avisaria que o ignorou a cada execução.

## D-025 — Interface otimista
Problema: as páginas são estáticas e só mudam depois do deploy, que leva cerca de 1 minuto.
Alternativas: (A) recarregar a página até o deploy terminar; (B) tirar o card na hora e avisar sobre o tempo de publicação.
Decisão: B. Nas ações que tiram um card (excluir, restaurar, excluir de vez), o card some na hora. No envio, aparece só um aviso.
Motivo: A precisaria consultar o deploy, e isso é escopo novo. O aviso explica por que um card pode voltar a aparecer se ele recarregar a página antes do deploy terminar (R-12).

## D-026 — Uma função por ação
> SUPERSEDED por D-027: a documentação da Vercel recomenda o contrário.

Problema: um endpoint para tudo ou um por ação.
Alternativas: (A) um único `api/acao.js`, com um campo `acao`; (B) quatro arquivos em `api/`, um por ação.
Decisão: B, com a lógica em `lib/acoes.js` e cada handler só repassando a chamada.
Motivo: cada rota fica com um contrato de corpo próprio (o envio é multipart, as outras são JSON), e os logs da Vercel já separam as ações pela rota.

## D-027 — Uma função só, com `export default { fetch }`
Problema: verificado na documentação da Vercel em 2026-11-10. O quickstart diz: "For projects without a framework, Vercel creates a separate function for each supported source file in the root `api/` directory [...] Avoid creating a separate function for each API endpoint." O formato recomendado é um handler `fetch` no `export default`.
Alternativas: (A) quatro arquivos com `export function POST` (D-026), um formato documentado mas desaconselhado; (B) `api/index.js` com rewrites no `vercel.json` para `/api/<acao>`; (C) `api/index.js` escolhendo a ação pelo parâmetro de URL `?acao=`.
Decisão: C.
Motivo: A vai contra a recomendação da plataforma. B depende de o `request.url` manter o caminho original depois do rewrite, algo que não foi verificado, e acrescenta configuração. C não depende de roteamento da plataforma: `/api` já cai em `api/index.js`.

## D-028 — Datas num clone raso
Problema: a documentação da Vercel confirma `git clone --depth=10`. As datas vêm do `git log` (`build.mjs:20-26`), e cada ação gera um commit. Depois de cerca de 10 ações, os trabalhos mais antigos que a borda do clone passam a mostrar a data do commit da borda, e a ordem da lista se perde.
Alternativas: (A) o build busca o histórico completo com `git fetch --unshallow`, a partir de `origin` e, se falhar, da URL pública do repo; se nada der certo, avisa e segue; (B) só a variável `VERCEL_DEEP_CLONE=true`; (C) a data no caminho, `trabalhos/<ts>/<arquivo>.pdf`.
Decisão: A. Escolha do dono.
Motivo: B não está na documentação da Vercel e pode parar de funcionar sem aviso. C muda a estrutura dos trabalhos que já existem e o fluxo manual descrito no README. A custa poucas linhas, e a URL pública funciona enquanto o repo for público. O build não pode falhar por causa disso, porque com o build quebrado nada novo é publicado.

## D-029 — Aviso ao dono sobre as ações
Problema: a revisão descobriu que a premissa "Watch no repo manda e-mail a cada commit" é falsa. O Watch avisa sobre conversas (issues, PRs, comentários), não sobre push. Além disso, os commits saem com o token do próprio dono, e o GitHub não notifica a pessoa sobre ações dela mesma.
Alternativas: (A) uma GitHub Action comenta numa issue "Atividade do site" a cada commit em `trabalhos/` ou `excluidos/`; (B) nenhum aviso; (C) o feed RSS de commits.
Decisão: B. Escolha do dono.
Motivo: o dono aceita só ficar sabendo pelo site e pelo histórico. Um PDF indevido fica no ar até alguém reparar (R-01).

## D-030 — `GITHUB_BRANCH` obrigatória
Problema: com o padrão `master`, um deploy de Preview sem a variável grava no site de produção.
Alternativas: (A) obrigatória, sem padrão; (B) padrão `master`.
Decisão: A. As variáveis de Preview ficam restritas à branch de teste.
Motivo: falha fechada. Faltar a variável recusa as ações em vez de escrever no site real. Restringir as variáveis de Preview a uma branch impede que outro Preview qualquer receba o token.

## D-031 — Desfazer depois de excluir
Problema: o revisor frio apontou que, depois de excluir, `/excluidos` continua sendo a página estática do deploy anterior. Do jeito que o UC-03 estava escrito, ele abria a aba e não encontrava o item.
Alternativas: (A) um botão Desfazer no aviso, que restaura pelo `id` devolvido na exclusão; (B) só avisar que o item aparece em cerca de 1 minuto.
Decisão: A. Escolha do dono.
Motivo: resolve a exclusão por engano na hora, sem esperar o deploy, reaproveitando a ação `restaurar`. B obriga a esperar e a ir até a outra aba.

## D-032 — Escape em toda interpolação e CSP nas páginas HTML
Problema: só o `data-nome` tinha escape exigido. Os nomes podem conter `"`, `<` e `>`, e a senha fica em texto puro na mesma origem.
Alternativas: (A) só escape; (B) escape e CSP em todas as rotas; (C) escape e CSP só nas páginas HTML.
Decisão: C.
Motivo: o escape é a defesa principal. A CSP sem script inline é a segunda camada caso algum escape falhe. Ela fica fora dos PDFs porque o efeito de uma CSP no leitor de PDF do navegador não foi verificado.

## D-033 — Log com passo e status do GitHub
Problema: `fora-do-ar` junta três causas (401, 403 e 404), e `github` junta bug, 5xx e rede. Pelo log, o dono não conseguia descobrir a causa.
Alternativas: (A) logar só o código do erro; (B) dar ao Marcos mensagens diferentes para cada causa; (C) mostrar a mesma mensagem ao Marcos e registrar a causa no log.
Decisão: C.
Motivo: o Marcos não tem o que fazer com a diferença entre as causas; o dono tem. O log não traz corpo nem headers, então nenhum segredo vaza.

## D-034 — Apagar a senha vencida
Problema: a validade só era conferida na leitura. Uma senha vencida ficava em texto puro no `sessionStorage` enquanto a aba estivesse aberta, e o `sessionStorage` volta quando a aba fechada é reaberta.
Alternativas: (A) conferir só na leitura; (B) apagar ao carregar a página, a cada leitura e por `setTimeout` no instante `expira`.
Decisão: B.
Motivo: limita a exposição real aos 10 minutos que o dono escolheu na D-014.

## D-035 — Timeout de cada chamada ao GitHub
Problema: uma chamada travada prenderia a função até o limite de 300 s, com o botão parado em "Enviando…".
Alternativas: (A) sem timeout; (B) `AbortSignal.timeout(15000)` em cada chamada, respondendo `github`.
Decisão: B.
Motivo: 15 s cobre uma chamada normal com folga, e o Marcos recebe uma mensagem em vez de esperar 5 minutos.

# Não Objetivos

- Renomear trabalhos pelo site.
- Limite de tentativas, CAPTCHA, contas ou login.
- Formatos que não sejam PDF, ou conversão de formato.
- Arquivos acima de 4 MiB.
- Avisar o dono a cada ação, por e-mail, push, issue ou RSS (D-029).
- Atualizar a lista sozinha depois do deploy.
- Esvaziar a aba Excluídos de uma vez, ou fazer ações em lote.
- Mudar a data de um trabalho substituído ou restaurado. A data continua sendo a do `addedAt` de hoje.
- Apagar o arquivo do histórico do git. O repo é público, então "Excluir de vez" tira o arquivo do site e da árvore atual, mas não do histórico (R-14).

# Requisitos Funcionais

- **RF-01:** A página `/` mostra a barra de abas, o botão "Enviar trabalho" e um X em cada card.
- **RF-02:** A página `/excluidos` mostra a barra de abas e os excluídos com Abrir, Baixar, Restaurar e um X para excluir de vez.
- **RF-03:** Enviar um PDF válido com nome novo cria `trabalhos/<nome>.pdf` num commit `Envia trabalho: <nome>`.
- **RF-04:** Enviar com um slug que já existe pergunta antes. Se ele confirmar, um único commit substitui o conteúdo e manda a versão antiga para `excluidos/<ts>/`.
- **RF-05:** O X de um trabalho confirma e, depois, move o arquivo para `excluidos/<ts>/` num commit `Exclui trabalho: <nome>`.
- **RF-06:** Restaurar move o arquivo de volta para `trabalhos/`. Se houver colisão, pergunta e troca os dois num único commit.
- **RF-07:** Excluir de vez confirma e remove o arquivo de `excluidos/` num commit `Exclui de vez: <nome>`.
- **RF-08:** A senha fica lembrada por 10 minutos na aba do navegador, valendo para as duas páginas.
- **RF-09:** Cada tipo de erro mostra a mensagem própria da tabela do contrato.
- **RF-10:** Sem `UPLOAD_PASSWORD`, `GITHUB_TOKEN` ou `GITHUB_BRANCH`, todas as ações são recusadas.
- **RF-11:** O build gera as duas páginas, copia os PDFs das duas pastas e funciona mesmo sem uma ou as duas pastas.
- **RF-12:** O `npm run dev` serve as duas páginas e o `app.js`. As ações falham localmente com a mensagem genérica, e isso é esperado.
- **RF-13:** Depois de excluir, o aviso oferece um Desfazer que restaura na hora (D-031).

# Requisitos Não Funcionais

- **Segurança:** a senha é conferida só no servidor e em tempo constante. Os segredos ficam só nas variáveis de ambiente da Vercel e não aparecem nos logs. O cabeçalho `nosniff` vale para todas as rotas. As páginas HTML têm CSP, e os excluídos têm `X-Robots-Tag: noindex`. Nenhum texto entra na página por `innerHTML`, e o build escapa toda interpolação.
- **Integridade:** cada ação gera exatamente um commit atômico. Uma gravação concorrente é detectada e devolve `conflito`.
- **Zero dependências:** o `package.json` ganha só o script `test`.
- **Latência:** cada função faz de 6 a 7 chamadas ao GitHub, o que leva alguns segundos. A mudança aparece no site depois do deploy da Vercel, cerca de 1 minuto.
- **Usabilidade:** as páginas são pensadas para celular. As mensagens são em português simples, sem termo técnico.
- **Observabilidade:** cada requisição gera uma linha de log na Vercel. O histórico de commits funciona como trilha de auditoria. O build registra se conseguiu buscar o histórico completo.
- **Rollback:**
  - Para desligar as ações sem mexer em código, basta apagar `UPLOAD_PASSWORD` e fazer um Redeploy.
  - Para voltar ao site estático, reverter todos os commits da implementação. Os arquivos em `excluidos/` ficam no repo, e o build antigo simplesmente não os lê. O build antigo quebra se `trabalhos/` não existir (`build.mjs:29`); nesse caso, pôr ao menos um PDF em `trabalhos/` antes de reverter.
  - Não há migração de dados, porque `trabalhos/` continua no mesmo formato.

# Casos de Uso

- **UC-01 Envio pelo celular:** ele toca em "Enviar trabalho", escolhe o PDF, ajusta o nome para "Geografia - Relevo", digita a senha e envia. Cerca de 1 minuto depois, o trabalho aparece no topo da lista.
- **UC-02 Versão corrigida:** ele envia "Geografia - Relevo" de novo e confirma "Substituir". O arquivo novo ocupa o lugar do antigo, que vai para Excluídos.
- **UC-03 Exclusão por engano:** ele toca no X errado e confirma. O trabalho vai para Excluídos, e o aviso oferece Desfazer. Ele toca em Desfazer sem digitar a senha de novo, porque ainda está dentro dos 10 minutos, e o card volta. Se só perceber depois, restaura pela aba Excluídos, onde o item aparece cerca de 1 minuto depois da exclusão.
- **UC-04 Restaurar a versão antiga:** depois do UC-02, ele restaura a versão antiga e confirma "Trocar". A versão antiga volta para o site, e a nova vai para Excluídos.
- **UC-05 PDF de zoeira:** um colega descobre a senha e sobe um PDF. O Marcos exclui e depois exclui de vez. O dono só fica sabendo se alguém contar ou se ele olhar o site. Aí ele troca `UPLOAD_PASSWORD` na Vercel e faz um Redeploy.
- **UC-06 Arquivo de 6 MB:** a página avisa antes de mandar qualquer coisa.
- **UC-07 PPTX renomeado para .pdf:** o servidor recusa.
- **UC-08 Token vencido:** toda ação mostra a mensagem de "sem acesso". O dono gera um token novo, atualiza a variável e faz um Redeploy, porque variável alterada só vale num deploy novo.
- **UC-09 Computador da escola:** ele exclui um trabalho e deixa a aba aberta. Por até 10 minutos, quem sentar ali consegue fazer ações sem digitar a senha. Depois disso, a senha é apagada do navegador e pedida de novo.
- **UC-10 Excluir o último trabalho:** o build passa, e a página `/` mostra `Nenhum trabalho ainda.`

# Arquivos Afetados

| Arquivo | Mudança |
|---|---|
| `lib/slug.js` | novo |
| `lib/repo.js` | novo: `classificar` |
| `lib/github.js` | novo: config, senha, `lerEstado`, `gravar`, erros, log |
| `lib/acoes.js` | novo: as quatro ações |
| `api/index.js` | novo: função única, que escolhe a ação pelo parâmetro `acao` |
| `site/app.js` | novo: JS do cliente |
| `build.mjs` | importa os módulos de `lib/`; gera a barra de abas, os X, os diálogos e a página `/excluidos`; copia os PDFs excluídos e o `app.js`; tolera pastas ausentes; o servidor de dev passa a servir diretórios e `.js` |
| `vercel.json` | adiciona `nosniff`, CSP nas páginas HTML e `X-Robots-Tag` nos excluídos |
| `package.json` | adiciona o script `test` |
| `test/slug.test.js`, `test/repo.test.js`, `test/acoes.test.js`, `test/build.test.js` | novos |
| `README.md` | tudo o que está no passo 8 da `# Estratégia de Implementação` |

# Estratégia de Implementação

1. **Formato da função: já verificado** (R-05, D-027). É `api/index.js` com `export default { async fetch(request) }`. Se o primeiro Preview não responder em `/api?acao=…`, parar e reportar.
2. **`lib/slug.js` e `lib/repo.js`.** Trocar o import no `build.mjs` e rodar `npm run build`. Os PDFs em `dist/` têm que sair iguais aos de antes.
3. **`lib/github.js` e `lib/acoes.js`.** Escrever junto com `test/acoes.test.js`, que usa um GitHub falso em memória.
4. **`api/index.js`.**
5. **`build.mjs`:** a barra de abas, os X, os diálogos e a página `/excluidos`; a cópia de `site/app.js`; as pastas ausentes; o servidor de dev.
6. **`site/app.js`.**
7. **`vercel.json` e `package.json`.**
8. **`README.md`:**
   - **Seção do Marcos:** como enviar, excluir, restaurar e excluir de vez. Regra da senha: nada que um amigo saiba sobre ele.
   - **Seção do dono:**
     - criar um token fine-grained com *Only select repositories* (só este repo), *Contents: Read and write* e a maior validade que o GitHub permitir;
     - em Production, configurar `UPLOAD_PASSWORD`, `GITHUB_TOKEN` e `GITHUB_BRANCH=master`, com `UPLOAD_PASSWORD` e `GITHUB_TOKEN` marcadas como **Secret** (o antigo Sensitive). O valor de uma Secret só pode ser escrito, nunca lido de volta, então o token MUST ficar guardado também num gerenciador de senhas;
     - em Preview, configurar as mesmas três variáveis com `GITHUB_BRANCH=teste-envio`, **restritas à branch de teste** (Preview → *Select a custom Preview branch*) também como Secret. O `GITHUB_TOKEN` do Preview MUST ser um token fine-grained **próprio**, com o mesmo escopo e diferente do de produção, para que revogá-lo não afete o site real. Depois do teste de ponta a ponta, revogar esse token e apagar as variáveis de Preview junto com a branch;
     - avisar que variável alterada só vale num deploy novo: depois de trocar a senha ou o token, fazer um Redeploy;
     - para desligar tudo na hora, apagar `UPLOAD_PASSWORD` e fazer um Redeploy;
     - conferir que o **Git Fork Protection** está ligado (Project Settings → Security). Sem ele, um PR vindo de fork pode fazer deploy e ler o token;
     - marcar na agenda o vencimento do token;
     - como excluir à mão sem passar pelo site: mover o PDF para `excluidos/<ts>/`, com `<ts>` no formato do modelo de dados.
9. **Ponta a ponta no Preview.**

# Estratégia de Testes

**Unitários (`node --test`, sem dependências).** Um GitHub falso em memória implementa as 7 rotas usadas: ref, commit, tree recursiva, blobs, trees, commits e `PATCH` do ref. Ele guarda um mapa `caminho → sha/conteúdo` e o `head`. Os testes conferem o **estado final do repo falso**, a mensagem do commit e a resposta HTTP. Para injetar falhas, ele pode responder com um status programado em qualquer rota. Ele também MUST reproduzir dois comportamentos do GitHub:
- 422 ao criar uma árvore que remove um caminho inexistente;
- 422 no `PATCH` do ref quando o parent do commit novo já não é o `head` atual, simulando uma gravação concorrente.

`agora` é fixo nos testes, para que `<ts>` seja previsível.

- **Comum:**
  - sem `UPLOAD_PASSWORD`, ou com ela só com espaços: `config`, sem nenhuma chamada.
  - sem `GITHUB_BRANCH`: `config`, sem nenhuma chamada.
  - sem `GITHUB_TOKEN`: `config`, sem nenhuma chamada.
  - `Trabalhos/X.pdf` (com T maiúsculo) e `trabalhos/X.pdf.txt` não aparecem como trabalho.
  - timeout numa chamada: `github`, com `gh=<passo>:timeout` no log.
  - exceção inesperada dentro de uma ação: resposta JSON `github` e `gh=excecao:outro` no log. Um `id` duplicado na árvore gera `gh=excecao:duplicado`.
  - um 401 no `ref` gera `gh=ref:401` no log.
  - `truncated: true` gera `gh=tree:truncated` no log.
  - `GET` gera `api: invalido metodo=GET`, e `acao=a%0Aexcluir:%20ok` gera exatamente uma linha, `api: invalido acao=?`.
  - gravação concorrente (o `head` muda entre `lerEstado` e o `PATCH`): `conflito`, e o repo falso fica intacto.
  - um caminho `trabalhos/sub/x.pdf` na árvore não aparece como trabalho.
  - senha errada: 401 `senha`, sem nenhuma chamada.
  - senha certa com espaço no fim: passa.
  - senha com outra capitalização: `senha`.
  - 401, 403 ou 404 em `lerEstado`: `fora-do-ar`.
  - 422 no `PATCH` do ref: `conflito`.
  - 500 em blobs: `github`.
  - `fetch` lançando erro: `github`.
  - `truncated: true`: `github`.
  - nenhuma linha de log contém a senha ou o token.
  - em `api/index.js`, um `GET` recebe 405, e `acao=xyz` ou `acao` ausente recebe 400 `invalido`.
- **Enviar:**
  - corpo que não é multipart: `invalido`.
  - `arquivo` como texto: `invalido`.
  - arquivo de 4.194.304 bytes: passa. Com 4.194.305: `grande`.
  - bytes de PNG ou arquivo vazio: `nao-pdf`.
  - nomes `""`, `"!!!"`, 101 caracteres, `"a/b"` ou `"a"` seguido de 99 caracteres CJK (mais de 200 bytes): `nome`.
  - `"Trabalho.PDF"`: grava `trabalhos/Trabalho.pdf`.
  - nome em NFD: grava o caminho em NFC.
  - nome novo: cria só esse arquivo, com o conteúdo idêntico ao enviado, e responde `substituido: false`.
  - slug que já existe, sem `substituir`: 409 `existe` com `existente` preenchido, e o repo não muda.
  - mesmo caso com `substituir=1`: o conteúdo novo fica no caminho antigo e o conteúdo antigo vai para `excluidos/<ts>/<arquivo>`, num único commit `Substitui trabalho: …`.
- **Excluir:**
  - `slug` inválido (`"../x"`, maiúsculas ou vazio): `invalido`.
  - `slug` que não existe: `nao-existe`.
  - `slug` válido: o arquivo sai de `trabalhos/` e aparece em `excluidos/<ts>/` com o mesmo `sha`, e a resposta traz o `id` do novo excluído.
  - excluir o último trabalho: `trabalhos/` fica sem nenhum arquivo.
- **Restaurar:**
  - `id` que não existe: `nao-existe`.
  - sem colisão: o arquivo volta para `trabalhos/<arquivo>`.
  - com colisão, sem `trocar`: `existe`, e o repo não muda.
  - com colisão e `trocar: true`, mesmo nome de arquivo: troca os dois.
  - com colisão e `trocar: true`, nomes que só diferem em acento ou maiúscula: o atual sai do caminho antigo dele.
  - dois excluídos com o mesmo nome em pastas `<ts>` diferentes: só o `id` pedido é restaurado.
- **Excluir de vez:**
  - `id` que não existe: `nao-existe`.
  - `id` válido: só aquele caminho some, e o outro excluído com o mesmo nome continua.
- **Invariante (CA-03):** em todo teste de sucesso, exceto Excluir de vez, o conjunto de `sha` de PDFs depois da ação contém o conjunto de antes.

**Outros unitários:**
- `test/slug.test.js`: `slugify("História - Independência do Brasil") === "historia-independencia-do-brasil"`.
- `test/repo.test.js`:
  - caminhos válidos e inválidos em `excluidos/` são classificados corretamente;
  - o `id` sai como esperado;
  - um arquivo que não é PDF é ignorado.
- `test/build.test.js`, rodando o build num diretório temporário com cópias de `build.mjs`, `lib/` e `site/`:
  - sem as duas pastas: as duas páginas saem com o estado vazio;
  - com dois excluídos: `dist/excluidos/<id>.pdf` é gerado, o selo mostra 2 e a ordem segue `ts` decrescente;
  - `dist/app.js` existe;
  - um trabalho chamado `a"><img src=x onerror=alert(1)>` aparece escapado em todo o HTML. Um excluído com o mesmo nome também. Nenhum `<img` em `dist/index.html` nem em `dist/excluidos/index.html`;
  - dois excluídos com o mesmo `id`, em pastas feitas à mão, fazem o build falhar;
  - um caminho inválido em `excluidos/` gera aviso no log.
  - **clone raso:** criar um repo temporário com 3 commits, cada um com um `GIT_COMMITTER_DATE` diferente, e cloná-lo com `git clone --depth=1 file://…`. O build no clone mostra `Histórico do git completo.`, e as datas saem iguais às do repo original e diferentes entre si. Num **segundo** clone raso, novo, com o `origin` removido (`git remote remove origin`): o build mostra o aviso, não falha e gera o `dist/`.

**Regressão:** com o repo atual, o `dist/index.html` novo só pode diferir do anterior na barra, nos X, nos diálogos e no script. Comparar com `diff`. Slugs e URLs não mudam.

**Ponta a ponta no Preview da Vercel:** usar `GITHUB_BRANCH=teste-envio`, com essa branch criada **a partir da branch da implementação**, e testar **no Preview da própria `teste-envio`**. É o único Preview que recebe as variáveis (D-030), e cada ação gera um commit nela, o que dispara um Preview novo. O Preview é protegido por login da Vercel por padrão, então o celular precisa estar logado. No fim, revogar o token do Preview e apagar as variáveis de Preview e a branch de teste, sem fazer merge. Erros de CSP no console por causa da barra de ferramentas da Vercel (`vercel.live`) são esperados no Preview e não são bug. Pelo celular:
1. Enviar um PDF.
2. Enviar de novo com o mesmo nome e substituir.
3. Excluir.
4. Restaurar sem digitar a senha (dentro dos 10 minutos).
5. Restaurar com troca.
6. Excluir de vez.
7. Enviar um PDF de cerca de 4 MB.
8. Errar a senha.
9. Enviar um PPTX renomeado para `.pdf`.
10. Tentar um arquivo de 5 MB, que deve ser bloqueado no navegador.
11. Esperar mais de 10 minutos, ou editar `expira` no DevTools, e conferir que a senha volta a ser pedida.
12. Com mais de 10 commits na branch de teste, conferir que o log do build mostra `Histórico do git completo.` e que as datas dos trabalhos antigos continuam certas.
13. Excluir todos os trabalhos e conferir que o build passa e mostra `Nenhum trabalho ainda.`
14. Conferir o visual em 360 px e no desktop.
15. Rodar `curl -sI` em `/`, `/excluidos`, `/excluidos/` e num PDF publicado e num PDF excluído:
    - CSP só nas três páginas HTML;
    - `nosniff` em tudo;
    - `X-Robots-Tag: noindex` em `/excluidos`, `/excluidos/` e no PDF excluído;
    - `/enviar` responde 404.
16. Excluir com a senha lembrada: o diálogo de confirmação aparece mesmo assim (CA-05). Tocar em Desfazer e conferir que o card volta. Para testar o fluxo Trocar pelo Desfazer:
    1. excluir um trabalho na aba A do navegador;
    2. na aba B, ou em outro aparelho, enviar um arquivo com o mesmo nome;
    3. voltar à aba A, tocar em Desfazer e confirmar Trocar.
17. Senha vencida, nos dois caminhos:
    - deixar a página aberta, sem recarregar, por mais de 10 minutos e conferir no DevTools que a chave `marcosfinatto:senha` sumiu do `sessionStorage`;
    - num outro teste, recarregar a aba depois de vencer e conferir a mesma coisa.
18. **Último passo:** revogar no GitHub o token do Preview. Não precisa de Redeploy. Conferir a mensagem de `fora-do-ar` na página e `gh=ref:401` no log.

# Critérios de Aceitação

- **CA-01:** `/` mostra a barra de abas, o botão "Enviar trabalho" e um X com `aria-label` em cada card. `/excluidos` responde 200, tem `noindex` e mostra a aba ativa. `/enviar` responde 404.
- **CA-02:** cada ação bem-sucedida cria **exatamente um** commit, com a mensagem do contrato, e altera só os caminhos previstos.
- **CA-03:** em toda ação, exceto Excluir de vez, cada `sha` de PDF que existia na árvore antes continua existindo em algum caminho depois. Um teste confere isso comparando o conjunto de `sha` antes e depois.
- **CA-04:** com a senha errada, nenhuma chamada ao GitHub acontece. Sem config, todas as ações respondem 500 `config`.
- **CA-05:** Excluir e Excluir de vez sempre abrem o diálogo de confirmação, mesmo com a senha lembrada.
- **CA-06:** a senha lembrada vale por 10 minutos a partir da digitação e nas duas páginas. Com a página aberta, ela é apagada do `sessionStorage` no instante em que vence. Ao carregar uma página, uma senha vencida é apagada antes de qualquer uso. Quando a resposta é `senha`, ela também é apagada.
- **CA-07:** arquivo acima de 4.194.304 bytes é bloqueado no navegador, sem requisição, e o servidor recusa com 413. Um arquivo que não começa com `%PDF-` recebe 400 `nao-pdf`.
- **CA-08:** com token inválido, a página mostra a mensagem de `fora-do-ar`.
- **CA-09:** `npm test` passa, e o `package.json` continua sem `dependencies` e sem `devDependencies`.
- **CA-10:** os slugs e as URLs dos PDFs atuais não mudam.
- **CA-11:** `curl -sI` mostra `x-content-type-options: nosniff` em todas as rotas, `content-security-policy` só nas páginas HTML e `x-robots-tag: noindex` em `/excluidos` e nos PDFs excluídos.
- **CA-12:** nenhuma das duas páginas tem rolagem horizontal em 360 px.
- **CA-13:** nenhum segredo aparece no repo, no HTML ou nos logs.
- **CA-14:** o build passa sem `trabalhos/` e sem `excluidos/`. Num clone raso, ele tenta buscar o histórico completo e, se não conseguir, avisa e não falha (teste com um clone `--depth=1` local).
- **CA-15:** o README cobre o uso pelo Marcos e a configuração pelo dono, incluindo o lembrete de vencimento do token.
- **CA-16:** `api/` contém exatamente um arquivo, `index.js`.
- **CA-17:** sem `GITHUB_BRANCH`, todas as ações respondem 500 `config`.
- **CA-18:** depois de excluir, o Desfazer restaura o trabalho num único commit `Restaura trabalho: <nome>`, e o card volta à posição original.
- **CA-19:** um nome com `"`, `<` e `>` sai escapado em todo o HTML gerado (teste de build).
- **CA-20:** todo erro vindo do GitHub gera log com o passo e o status (`gh=<passo>:<status>`), e nenhum log traz corpo, headers, senha ou token.

# Riscos

- **R-01 Senha adivinhável, sem limite de tentativas e com poder total** (D-002, D-003, D-013). Quem acertar a senha consegue enviar, excluir, restaurar e excluir de vez.
  - Mitigação: Excluir e Excluir de vez dependem de confirmação. Qualquer ação se desfaz com `git revert`, inclusive Excluir de vez, mas aí só o dono consegue. Trocar `UPLOAD_PASSWORD` e fazer um Redeploy fecha o acesso. Apagar a variável e fazer um Redeploy desliga todas as ações.
  - O dono não recebe aviso (D-029). Um conteúdo indevido fica no ar até alguém reparar.
  - Aceito pelo dono.
- **R-02 Os botões aparecem para toda a turma** (D-012). Mais gente vai tentar senha. Isso agrava R-01. Aceito pelo dono.
- **R-03 O token vence.** Todas as ações param.
  - Mitigação: a página mostra uma mensagem clara, e o README tem o lembrete de vencimento. Trocar o token exige Redeploy.
- **R-04 O token vaza.** Pode acontecer se a conta da Vercel for comprometida, ou se o Git Fork Protection estiver desligado e um PR vindo de fork fizer deploy com as variáveis do projeto. O repo é público, então qualquer pessoa pode abrir um PR. O token dá escrita no conteúdo deste repo e de mais nenhum.
  - Mitigação: token fine-grained, restrito a este repo e à permissão de conteúdo. O README manda conferir o Git Fork Protection. As variáveis de Preview ficam restritas à branch de teste (D-030).
- **R-05 Formato da função: RESOLVIDO** (2026-11-10). O formato está documentado, e a spec adota o recomendado pela Vercel (D-027). O risco que sobra é o primeiro Preview não responder em `/api?acao=…`; nesse caso, a implementação para e avisa.
- **R-06 Tamanho do blob.** A dúvida sobre a API de conteúdo deixou de existir com a D-020. O limite de criação de blob não está documentado, e o teste de ponta a ponta 7 (cerca de 4 MB) prova que funciona.
- **R-07 Clone raso na Vercel: CONFIRMADO, mitigado pela D-028.** A documentação oficial diz `git clone --depth=10`. O `addedAt` (`build.mjs:20-26`) usa `git log --diff-filter=A`, e num clone raso o commit da borda parece ter adicionado todos os arquivos que existiam nele. Hoje funciona porque o repo tem só 3 commits. Este item cria um commit por ação: a partir do 11º commit, todo trabalho mais antigo que a borda passa a mostrar a data do commit da borda, e a ordem da lista se perde. As datas dos excluídos não sofrem com isso, porque saem do `<ts>`. Mitigação: o build busca o histórico completo. Se não conseguir, avisa no log e segue, e aí as datas podem sair erradas, mas o site continua sendo publicado. O `git fetch --unshallow` de dentro do build da Vercel não foi testado; o teste de ponta a ponta 12 prova.
- **R-08 PDF malicioso** (JavaScript embutido ou exploit de leitor de PDF). É o mesmo risco de hoje. O site serve como `application/pdf` com `nosniff`.
- **R-09 O build falha depois do commit.** O Marcos vê "ok", mas nada aparece no site. São quatro as falhas conhecidas que dependem do conteúdo:
  - colisão de slug, que as funções previnem (D-006, D-009, D-019);
  - pasta ausente, tratada (D-024);
  - `id` repetido numa pasta de `excluidos/` feita à mão, que falha o build de propósito (modelo de dados);
  - nome de arquivo acima de 255 bytes posto à mão, que quebra o clone.

  As duas últimas só acontecem por mexida manual no repo.
- **R-10 Substituir ou restaurar mantém a data original.** A versão trocada fica na mesma posição da lista. É o comportamento esperado.
- **R-11 Senha lembrada num computador compartilhado** (D-014, D-034). Por até 10 minutos, qualquer pessoa naquele computador consegue fazer ações sem senha e, se abrir o DevTools, ler a senha. Depois disso a senha é apagada. Aceito pelo dono.
- **R-12 Interface otimista** (D-025). Se ele recarregar antes do deploy terminar, o card volta a aparecer até o deploy concluir. A mensagem avisa sobre esse tempo.
- **R-13 Excluídos continuam públicos** (D-017). Um conteúdo indevido excluído continua acessível em `/excluidos` até ser excluído de vez. Aceito pelo dono.
- **R-14 O histórico do repo público guarda tudo.** Nem "Excluir de vez" apaga o arquivo do histórico do git no GitHub. Para remover de verdade, seria preciso reescrever o histórico, e isso está fora do escopo.
- **R-15 Status de não fast-forward não documentado.** A documentação do GitHub lista 200, 409 e 422 para "update a reference", mas não diz qual corresponde a não fast-forward. O mapeamento trata 409 e 422 do `PATCH` como `conflito`.
- **R-16 Abuso de cota sem limite de tentativas** (D-003). Um bot ou um colega martelando `/api` consome a cota de funções do plano Hobby. Se ela acabar, as ações param até o mês virar; o site estático continua no ar. Resposta: o Firewall da Vercel, configurado na mão, ou apagar `UPLOAD_PASSWORD` e fazer um Redeploy. Aceito junto com a D-003.
- **R-17 XSS armazenado pelo nome de um trabalho.** A senha fica em texto puro na mesma origem, então um XSS roubaria a senha, inclusive a nova depois de uma troca. Mitigação: escape em toda interpolação do build, `textContent` no cliente e CSP sem script inline (D-032).

PLAN_APPROVED
Aprovado em: 2026-11-10
Resumo da revisão: o loop próprio corrigiu a premissa falsa do Watch, o clone raso (`--depth=10`), o `GITHUB_BRANCH` obrigatório, o Git Fork Protection e o Redeploy necessário depois de trocar variáveis. O revisor frio rodou 3 rodadas, a primeira com 4 IMPORTANTES: senha vencida, Desfazer, escape e CSP, log diagnóstico. As rodadas 2 e 3 vieram APROVÁVEL; os MENORES da rodada 3 foram aplicados sem uma quarta rodada.

---

Auditoria pós-implementação, 2026-11-10. Esta nota foi registrada pelo implementador; não faz parte do texto aprovado.

- **Resultado:** SPEC_COMPLIANT com escopo LIMPO, em duas rodadas do `spec-auditor`.
- **Corrigido depois da primeira rodada:** timeout na leitura do corpo, Desfazer com retry, `try/catch` cobrindo todo o `api/index.js`, assinatura das quatro ações, escape também das constantes do build e o `catch` do `fetch()` voltando a mapear qualquer rejeição para `rede`.
- **Desvio residual (MENOR, só de letra), pendente de aceite do dono:** o `build.mjs` não importa `slugify` diretamente. Ele usa `classificar` (`lib/repo.js`), que importa de `lib/slug.js`. Não há cópia local, então a D-009 está cumprida.

# Trabalhos do Marcos

Site com os trabalhos do Marcos, para abrir na aula sem pendrive nem login: https://marcosfinatto.vercel.app

## Para o Marcos

Tudo é feito pelo próprio site, com a senha. Depois de digitar a senha uma vez, o site lembra dela por 10 minutos naquela aba.

- **Enviar:** toque em **Enviar trabalho**, escolha o PDF, confira o **Nome no site** (por exemplo `História - Independência do Brasil`), digite a senha e envie. Em cerca de 1 minuto o trabalho aparece no site.
  - Só PDF, até 4 MB. Apresentação em PowerPoint: exporte para PDF antes (Arquivo → Exportar → PDF).
  - Se já existir um trabalho com o mesmo nome, o site pergunta se você quer substituir. A versão antiga vai para **Excluídos**.
- **Excluir:** toque no **X** do trabalho e confirme. Ele vai para a aba **Excluídos**. Logo depois aparece o botão **Desfazer**, caso tenha sido sem querer.
- **Restaurar:** na aba **Excluídos**, toque em **Restaurar**.
- **Excluir de vez:** na aba **Excluídos**, toque no **X** e confirme. Isso não dá para desfazer pelo site.

Sobre a senha:
- Não use nada que um amigo saiba sobre você: aniversário, nome do bicho, time, apelido.
- Em computador da escola, nunca deixe o navegador salvar a senha.

## Para quem cuida do site

### Configurar o envio pelo site (uma vez)

1. Crie um token no GitHub: Settings → Developer settings → **Fine-grained tokens**.
   - *Repository access:* **Only select repositories** → só este repo.
   - *Permissions:* **Contents: Read and write**.
   - *Expiration:* a maior validade permitida. **Marque na agenda o dia em que ele vence.** Quando vencer, o site mostra "O site está sem acesso para mudanças".
   - Guarde o token num gerenciador de senhas: a Vercel não deixa ler o valor de volta.
2. Na Vercel, em Settings → Environment Variables, ambiente **Production**:
   - `UPLOAD_PASSWORD`: a senha que o Marcos escolheu. Tipo **Secret**.
   - `GITHUB_TOKEN`: o token do passo 1. Tipo **Secret**.
   - `GITHUB_BRANCH`: `master`.
3. Faça um **Redeploy**. Variável alterada só vale num deploy novo.
4. Em Settings → Security, confira que o **Git Fork Protection** está ligado. Sem ele, um PR vindo de um fork pode fazer deploy e ler o token.

### No dia a dia

- **Trocar a senha ou o token:** mude a variável na Vercel e faça um Redeploy.
- **Desligar tudo na hora:** apague `UPLOAD_PASSWORD` e faça um Redeploy. Todas as ações passam a ser recusadas.
- **Ver o que aconteceu:** cada ação vira um commit (`Envia trabalho: …`, `Exclui trabalho: …`, `Restaura trabalho: …`, `Exclui de vez: …`). Os logs da função na Vercel mostram uma linha por pedido. Quando o erro vem do GitHub, a linha traz o passo e o status, por exemplo `gh=ref:401` para token vencido, `gh=ref:403` para falta de permissão e `gh=ref:404` para repo ou branch errados.
- **Desfazer qualquer coisa,** inclusive "Excluir de vez": `git revert` do commit.

### Testar no Preview antes de publicar

1. Crie a branch `teste-envio` a partir da branch com as mudanças.
2. Crie um **segundo** token fine-grained, igual ao do passo 1, só para o teste.
3. Na Vercel, ambiente **Preview**, restrito à branch `teste-envio`: `UPLOAD_PASSWORD`, `GITHUB_TOKEN` (o segundo token) e `GITHUB_BRANCH=teste-envio`, todos como Secret.
4. Teste no Preview da própria `teste-envio`. Erros de CSP no console por causa da barra de ferramentas da Vercel (`vercel.live`) são esperados.
5. No fim, revogue o segundo token, apague as variáveis de Preview e apague a branch, sem fazer merge.

### Mexer à mão no repo

- **Adicionar:** coloque o PDF em `trabalhos/`, faça commit e push. O nome do arquivo é o que aparece no site.
- **Excluir sem passar pelo site:** mova o PDF para `excluidos/<data>/`, com `<data>` no formato `2026-11-10T17-03-22-123Z` (hora UTC, com `-` no lugar de `:` e `.`).

A lista mostra o mais novo primeiro, pela data do commit em que o PDF entrou. Cada PDF também ganha um link direto, sem acento nem espaço:
`https://marcosfinatto.vercel.app/historia-independencia-do-brasil.pdf`

## Ver localmente

```sh
npm run dev   # http://localhost:3000
npm test
```

Localmente dá para ver as páginas, mas as ações (enviar, excluir, restaurar) só funcionam na Vercel.

Não há dependências para instalar. Basta ter Node 21 ou mais novo.

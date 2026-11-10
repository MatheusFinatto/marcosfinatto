# Trabalhos do Marcos

Site com os trabalhos do Marcos, para abrir na aula sem pendrive nem login: https://marcosfinatto.vercel.app

## Adicionar um trabalho

1. Coloque o PDF na pasta `trabalhos/`. O nome do arquivo é o que aparece no site.
   Exemplo: `História - Independência do Brasil.pdf`.
   Só PDF é publicado. Apresentação em PowerPoint: exporte para PDF antes (Arquivo → Exportar → PDF).
2. Faça commit e push. A Vercel publica sozinha em cerca de 1 minuto.

A lista mostra o mais novo primeiro (pela data do commit em que o PDF entrou).

Cada PDF também ganha um link direto, sem acento nem espaço:
`https://marcosfinatto.vercel.app/historia-independencia-do-brasil.pdf`

## Ver localmente

```sh
npm run dev   # http://localhost:3000
```

Não há dependências para instalar. Basta ter Node 21 ou mais novo.

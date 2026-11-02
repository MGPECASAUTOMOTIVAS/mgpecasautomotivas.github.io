/* ===== Configuração do app MG Peças (único lugar a mudar) =====
   Carregado pelo index.html (antes do app.js) e pelo service worker (importScripts), para que o
   pré-cache do SW use os mesmos endereços de dados que o app lê.
   dadosBase: pasta dos dados do buscador (indice.json, produtos.json, imagens.json, marcas/).
     - local (padrão, funciona offline e no GitHub Pages): 'dados/'
     - produção via jsDelivr: 'https://cdn.jsdelivr.net/gh/filipefrancas/mg-site-arquivos@main/busca-veiculo/'
   detalhesUrl: aplicações, números originais e linha de cada peça (gerado para o app).
   placaUrl: Worker da consulta de placa (precisa liberar a origem do app no CORS; ver LEIA-ME.md).
   loja: site da MG; páginas de produto em loja + '/produtos/<handle>/'.
   urlApp: endereço público do app, usado nos links de "Compartilhar" (vazio = usa o endereço atual).
   mlMarcaId: filtro de marca do Mercado Livre (_BRAND_<id>); vazio = sem filtro. Conferir com o botão do site. */
self.MG_CONFIG = {
  dadosBase: 'dados/',
  detalhesUrl: 'dados/detalhes.json',
  placaUrl: 'https://mg-placa.filipefrancasilva10.workers.dev',
  loja: 'https://mgpecasautomotivas.com.br',
  urlApp: 'https://mgpecasautomotivas.github.io/',
  mlSufixo: 'MG Mangueiras - MG Peças Automotivas',
  mlMarcaId: '64522',
  versao: '2026.11.02-28'
};

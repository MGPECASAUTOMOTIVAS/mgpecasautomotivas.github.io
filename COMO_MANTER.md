# Como manter o app do catálogo MG

Guia curto para o Filipe. Tudo o que está aqui foi testado em 02/11/2026.

> **Mudança de endereço (02/11/2026):** o app saiu de `filipefrancas.github.io/mg-site-arquivos/app/` e passou a ser
> publicado na raiz de **https://mgpecasautomotivas.github.io/** (repositório `MGPECASAUTOMOTIVAS/mgpecasautomotivas.github.io`).
> O endereço antigo continua no ar só como redirecionamento para o novo (inclusive os links de peça `p/MG001.html`).

## 1. O que é e onde está
- É o catálogo da MG em forma de aplicativo: abre no navegador do celular e pode ser instalado na tela inicial
  (iPhone e Android). Mostra as peças, as aplicações e os números originais. Funciona sem internet depois da
  primeira abertura.
- **Minha lista** (aba Lista, tela `#/lista`): quem usa o app monta uma lista de códigos MG com quantidade (botão
  "Adicionar à lista" na ficha ou o "+" nos resultados) e manda pelo WhatsApp (sem número de destino: a pessoa escolhe
  para quem) ou copia o texto. Fica guardada só no aparelho (`localStorage`, chave `mg-lista`, como `mg-favoritos` para
  Minhas peças); nada passa por servidor; o texto traz só código, nome e quantidade, sem valores, e o link do app.
- **Imprimir / PDF**: botão na Minha lista, na ficha da peça e na lista de peças de um veículo (ao lado da ordem). Abre a
  caixa de impressão do navegador; no celular ela tem a opção "Salvar como PDF" (no iPhone, a folha de compartilhar do
  sistema). A folha sai limpa, em preto no branco, com o logo da MG, a data, a tabela (lista: quantidade, código, nome e
  linha; ficha: foto, aplicação completa e números originais; veículo: código, nome, linha e aplicação de todas as peças, na
  ordem e com o filtro da tela) e um QR code do link. Sem valores nem contato. Ctrl+P no computador imprime a mesma folha.
  Tudo é montado no aparelho (CSS `@media print` em `app.css`, seção `#impressao` em `app.js`); nada vai para servidor.
- **Busca por voz** (botão de microfone dentro do campo "Código, nº original ou nome", no Início e na tela Busca): a
  pessoa toca, fala ("mangueira radiador gol dois mil e dez um ponto seis") e o app escreve o texto no campo e faz a busca
  por texto normal. Números falados viram dígitos ("dois mil e dez" → 2010, "um ponto seis" → 1.6, "MG zero zero um" →
  MG001); nada além disso é trocado. Na 1ª vez aparece um aviso: o áudio é processado pelo serviço de reconhecimento de
  fala do navegador (no Chrome, o Google) e o app não o guarda; a escolha "Entendi, usar" fica no aparelho (chave
  `mg-voz-aviso`). **Limitação:** o botão só aparece onde funciona — Chrome, Edge e Samsung Internet no Android ou no
  computador, com internet. No iPhone/iPad ele fica escondido (o reconhecimento do Safari, que o Chrome do iPhone também
  usa, falha com frequência), e no Firefox e em navegadores sem reconhecimento de fala não existe; nesses casos a tela
  fica exatamente como antes. O acerto de nomes de peça depende do serviço do navegador; a busca por texto já tolera
  erros. Sem permissão do microfone, sem fala ou sem internet, o app avisa e volta ao campo. Código: `vozDisponivel`,
  `normalizarVoz` e `ligarVoz` em `app.js`.
- **Etiquetas com QR para a prateleira** — DESLIGADAS desde 02/11 (config.js `etiquetas: false`; o Filipe quer conversar antes, porque a MG já tem etiquetas padrão; o código fica guardado e volta com `etiquetas: true`; ao religar, devolva as etiquetas ao texto de privacidade.html, "Preferências" e "Compartilhar e imprimir", e a captura 6 da ficha da Play) (botão "Etiquetas" na Minha lista, tela `#/etiquetas`; na ficha, o link "Etiqueta
  desta peça"): folha A4 de etiquetas adesivas com o logo, o código MG em destaque, o nome, a linha e um QR code que abre a
  ficha da peça no app (`p/MG001.html`). Modelos: Pimaco A4360 (63,5 × 38,1 mm, 21 por folha), A4362 (99 × 33,9 mm, 16),
  A4356 (63,5 × 25,4 mm, 33), A4351 (38,2 × 21,2 mm, 65) e "Grade simples 3 × 8" (63 × 33 mm com linha de corte, para papel
  comum). Etiquetas de outra marca com a mesma medida e a mesma contagem costumam ter o mesmo gabarito; a prévia mostra a
  folha. Opções: uma etiqueta por peça ou por unidade da lista, pular as já usadas na 1ª folha. Na caixa de impressão escolha
  **100% / tamanho real** (sem "ajustar à página") e papel A4; imprima antes em papel comum e sobreponha à folha adesiva.
  Para mudar um modelo ou acrescentar outro: lista `ETIQUETA_MODELOS` em `app.js` (medidas em mm, com a fonte no comentário).
- **Dentro dos apps das lojas** (Google Play e, quando sair, App Store): o app já vem instalado, então some tudo o que é
  "instalar" (faixa flutuante, cartão do Início, botão e QR do Sobre, passo a passo; `#/instalar` abre o Início). O resto é
  igual, e no navegador nada muda. Como o app reconhece cada loja: LEIA-ME.md, "Dentro dos apps das lojas".
- **Tema claro por padrão** (o Filipe pediu, 02/11/2026): o app abre sempre no tema claro, como o site, mesmo com o
  celular no modo escuro. O escuro só aparece quando a pessoa escolhe: botão da lua no topo do Início (troca claro/escuro) ou
  Sobre › Tema › Escuro; a escolha fica guardada no aparelho (chave `mg-tema`) e vale nas próximas aberturas. "Automático"
  (segue o tema do celular) continua no Sobre, mas só vale se a pessoa escolher. A folha de impressão sai sempre em preto no
  branco. Detalhes técnicos: LEIA-ME.md, "Tema: claro por padrão".
- Endereço no ar: https://mgpecasautomotivas.github.io/
- Os arquivos ficam em dois lugares:
  - **Repositório** `MGPECASAUTOMOTIVAS/mgpecasautomotivas.github.io` no GitHub (organização da MG) → a raiz dele é o que
    está publicado. O repositório antigo `filipefrancas/mg-site-arquivos` guarda em `app/` só o redirecionamento para cá.
  - **Pasta do projeto** `site-nuvemshop/app_catalogo/` → cópia de trabalho, com os scripts que geram os dados.
- Na raiz do repositório, o que importa:
  - `dados/indice.json`, `produtos.json`, `imagens.json`, `marcas/` → lista de peças, fotos e tabela de veículos.
  - `dados/detalhes.json` → aplicações, números originais e linha de cada peça.
  - `p/` → uma página por peça (`p/MG001.html`) para o link compartilhado mostrar nome e foto nos aplicativos de mensagem.
  - `config.js` → versão do app e endereços.
  - `sw.js` → o "guardador" que faz o app funcionar sem internet; tem a mesma versão.
  - `teste/fumaca.js` → teste automático (abaixo).
  - `LEIA-ME.md` → explicação técnica completa; `COMO_MANTER.md` → este guia.

## 2. Peça nova ou aplicação alterada: como chega ao app
Os dados do app nunca são digitados à mão: eles saem dos mesmos arquivos do site. O caminho é sempre o mesmo:

1. **Atualize a origem.** A ficha da peça (tipo, aplicações, números originais) fica em
   `site-nuvemshop/lote_seo/saida/*.json` ou `site-nuvemshop/etapa7_novos/saida/*.json`, e a seção do catálogo
   impresso em `mg_catalogo_export_2026-10-15.csv`. Peça nova, aplicação nova ou número original novo entram ali
   (quem faz isso hoje é o agente, a pedido seu; nada é inventado, só o que a fábrica confirmou).
2. **Tabela de veículos e fotos** (`indice.json`, `produtos.json`, `imagens.json`, `marcas/`): são os arquivos do
   buscador do site, gerados por `site-nuvemshop/buscador_veiculo/gerar_base.py`. Esse script ainda grava numa pasta
   temporária do agente; peça ao agente para rodar e copiar o resultado para `buscador_veiculo/busca-veiculo/` e
   depois para `app_catalogo/dados/` (`imagens.json` e `marcas/` vão direto; `indice.json` e `produtos.json` não:
   são refeitos no passo 3).
3. **Gere os dados do app.** Na pasta `site-nuvemshop/app_catalogo/`:
   ```
   python3 -I gerar_detalhes.py
   ```
   Leva uns 4 segundos e regrava `dados/indice.json`, `dados/produtos.json`, `dados/detalhes.json` e, no fim,
   chama sozinho o `gerar_previas.py`, que refaz as 2.262 páginas da pasta `p/`. No fim ele imprime quantas peças
   ficaram sem aplicação e os números originais que descartou, para revisão. Nunca publique `dados/` sem a `p/`
   da mesma rodada.
4. **Copie para o repositório** (da pasta `app_catalogo/` para a raiz de `mgpecasautomotivas.github.io/`): `dados/`, `p/` e, se
   mudou, `app.js`, `app.css`, `config.js`, `sw.js`. Nada de copiar `teste/capturas` ou `previa/`.
5. Suba a versão (item 4), rode o teste (item 5) e publique (item 3).

## 3. Como publicar
O GitHub publica sozinho tudo o que entra no ramo principal (`main`). Na pasta `mgpecasautomotivas.github.io`:
```
git status                      # mostra o que mudou
git add -A
git commit -m "Peça MG1234 com aplicação Gol 2015"   # frase curta dizendo o que mudou
git push origin main
```
- Para conferir que foi: no GitHub, aba **Actions**, o fluxo "Publicar app no GitHub Pages" fica verde em 1 a 2
  minutos. Depois abra https://mgpecasautomotivas.github.io/config.js e veja se a `versao` é a nova,
  ou abra o app, toque em **Sobre** e veja a versão.
- Quem já tem o app instalado recebe a barra "Atualização disponível · Atualizar" na próxima vez que abrir
  (ou quando voltar para o app). Tocando em Atualizar, ele recarrega uma vez e confirma "App atualizado · versão …".
  Quem não tocar recebe a versão nova na abertura seguinte. Favoritos, recentes e tema não se perdem.
- No app do iPhone (e em navegador sem service worker) não aparece a barra: em **Sobre › Procurar atualização**, se
  houver versão nova, o app recarrega sozinho e confirma "App atualizado · versão …". Se ele disser que a versão nova
  ainda não chegou, tente de novo daqui a alguns minutos.

## 4. Como mudar a versão
A versão tem que mudar a cada publicação, senão o celular continua com os arquivos antigos. São dois lugares, com
o mesmo texto (formato ano.mês.dia-número):
- `config.js` → linha `versao: '2026.11.02-34'`
- `sw.js` → linha `var VERSAO = '2026.11.02-34';`
Se os dois ficarem diferentes, o teste do item 5 acusa.

## 5. Como rodar o teste
Precisa do Node.js e do Playwright com o Chromium (uma vez só: `npm install -g playwright` e
`npx playwright install chromium`). Na pasta `mgpecasautomotivas.github.io`:
```
node teste/fumaca.js
```
Em cerca de 1 minuto ele percorre o app inteiro (Início, buscas, ficha, favoritos, Minha lista, Imprimir / PDF, etiquetas, busca por voz, compartilhar,
instalar, apps das lojas, tema claro por padrão, versão, uso sem internet) e termina com `309/309 verificações`. Se aparecer `FALHA`, não publique: leia a linha que falhou.
Para guardar capturas de tela: `node teste/fumaca.js --capturas pasta_das_capturas`.

## 6. Onde estão as regras
- `site-nuvemshop/app_catalogo/MELHORIAS.md` → regras do app (o que nunca pode aparecer nele: valores, linguagem
  de venda, contatos da MG, nomes de distribuidores ou clientes, dado inventado; logo original; português correto),
  o histórico de tudo o que foi feito e as ideias que esperam a sua decisão.
- `site-nuvemshop/regras_filipe.md` → suas regras para o site, que valem também para o app.
- `LEIA-ME.md` → detalhes técnicos (arquivos, dados, publicação, Worker da placa, lojas de aplicativos).

## 7. O que depende do notebook e o que depende de você
Precisa do notebook (o agente não alcança):
- **Busca pela placa.** O serviço `mg-placa` no Cloudflare só responde ao site. Para o app funcionar no endereço novo,
  acrescentar `https://mgpecasautomotivas.github.io` na variável `ORIGENS` do `wrangler.toml` (pasta
  `Downloads\mg-buscador\worker-placa\deploy`, ver `buscador_veiculo/worker-placa/PASSO_A_PASSO.md`) e rodar
  `npx wrangler deploy`. Enquanto isso não for feito, a busca pela placa no app mostra a mensagem "ainda está sendo
  liberada" (o endereço antigo nunca foi liberado, então nada deixou de funcionar). O app já está pronto: nada muda no
  código quando a origem for liberada.
- **Painel da Nuvemshop** (fotos e fichas do site) e a conferência do filtro de marca do Mercado Livre
  (`mlMarcaId` em `config.js`, ver LEIA-ME.md).

Só com a sua autorização:
- Colocar a faixa "Baixe o app" no site (`trecho_site_baixe_app.html`).
- Endereço próprio `app.mgpecasautomotivas.com.br` (registro no DNS; ver LEIA-ME.md).
- Qualquer mudança de cadastro (peça, aplicação, número original, nome de modelo): a lista do que espera decisão
  está em "Ideias para depois" e "Ideias grandes" no MELHORIAS.md.
- Publicar nas lojas de aplicativos. **Google Play: tudo o que dava para preparar está pronto** (chave, configuração,
  workflow "Android (Google Play)", página de privacidade, textos e imagens da ficha); o passo a passo do que só você pode
  fazer (conta, US$ 25, segredos no GitHub, envio do .aab) está em `site-nuvemshop/app_catalogo/play/GUIA_GOOGLE_PLAY.md`.
  App Store: adiada.

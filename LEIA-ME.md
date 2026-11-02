# App de catálogo MG Peças Automotivas (PWA)

Protótipo instalável ("Adicionar à Tela de Início" / "Instalar app") do catálogo MG. Página única, JavaScript puro,
sem build. Criado em 31/10/2026.

**Publicado em https://mgpecasautomotivas.github.io/** (GitHub Pages da organização `MGPECASAUTOMOTIVAS`, repositório
`mgpecasautomotivas.github.io`, raiz do ramo `main`; `.github/workflows/pages.yml` publica a cada push). Este repositório é
o fonte do app. Até 02/11/2026 o app ficava em `https://filipefrancas.github.io/mg-site-arquivos/app/`; esse endereço
continua no ar só como redirecionamento (index.html, sw.js que se remove sozinho e `p/<CÓDIGO>.html` apontando para a ficha
aqui), preservando o `#/…` do link.

## Arquivos
```
index.html                  casca do app
config.js                   configuração (MG_CONFIG: dadosBase, detalhesUrl, placaUrl, loja, versao) — único lugar a mudar;
                            lido pelo index.html e pelo service worker (importScripts), para o pré-cache usar os mesmos endereços
app.css                     visual (azul MG #0b4ea2, Barlow / Barlow Condensed, tema claro por padrão e escuro por escolha, safe-area iPhone)
app.js                      rotas (#/ #/placa #/busca #/veiculo/… #/linhas #/linha/<id> #/peca/<CÓDIGO> #/minhas #/lista #/etiquetas #/sobre), busca, placa, instalação, impressão (folha #impressao montada só ao imprimir, CSS @media print), etiquetas com QR (ETIQUETA_MODELOS: folha A4 em mm)
sw.js                       service worker: casca + catálogo (inclusive marcas/*.json) em cache; mudar VERSAO a cada publicação
manifest.webmanifest        nome "MG Peças Automotivas", short_name "MG Peças", standalone, ícones 192/512 + maskable
icones/                     gerados com Pillow só a partir do logo original nova_cara/banners/fonte/cut/logo_mg_original_rgba.png
                            (784x295): logo-mg.png (topo e Sobre; no tema escuro vai sobre um chip branco), ícones 192/512 +
                            maskable, apple-touch-icon e capa-social em fundo branco; favicon-32/64 = recorte do globo do original.
                            logo-mg.png: 708x267 em 256 cores (38 KB; era 900x339 em RGBA, 284 KB, que no 3G atrasava produtos.json
                            em ~7 s) — mesma arte, só reamostrada; o original continua intocado.
                            Não há versão branca do logo: a que existia era um traçado vetorizado, não um arquivo original —
                            se o Filipe quiser logo branco no tema escuro, pedir o arquivo original branco.
dados/                      cópia de busca-veiculo/ (indice, produtos, imagens, marcas/*.json) + detalhes.json (gerado para o app)
previa/                     capturas 390x844 (Playwright)
trecho_site_baixe_app.html  faixa "Baixe o app da MG" para colar no site depois
p/                          prévias de compartilhamento: p/<CÓDIGO>.html, uma por peça (~1 KB cada, 2.262 páginas, ~2,2 MB),
                            geradas por gerar_previas.py (python3 -I gerar_previas.py, < 1 s). Só og:title (nome + código),
                            og:description (linha + veículos da aplicação), og:image (foto da peça em 640 px, ou
                            capa-social.jpg sem foto), og:url e redirecionamento imediato para ../#/peca/<CÓDIGO>. O botão
                            "Compartilhar" da ficha usa esse endereço. O service worker não guarda essas páginas (só rede;
                            offline redireciona direto para a ficha). gerar_detalhes.py roda gerar_previas.py no fim, então
                            regerar os dados já regera p/; depois de mudar só produtos/imagens, rodar gerar_previas.py à mão.
                            Foto da prévia: imagens.json só tem a foto do CDN em WebP; cada página leva a foto da peça e uma
                            2ª og:image com a capa-social.jpg (JPEG 1200x630) para robôs que recusam WebP ou foto externa.
gerar_previas.py            gera a pasta p/ (acima)
COMO_MANTER.md              guia curto, sem jargão, para o Filipe: como um dado novo chega ao app, publicar, versão, teste
.github/workflows/pages.yml publica a raiz no GitHub Pages a cada push em main
.github/workflows/android.yml gera o app Android (.aab/.apk) para a Google Play com o Bubblewrap (ver "Google Play" abaixo)
twa-manifest.json           configuração do app Android (Bubblewrap/TWA); appVersionCode sobe a cada envio à Play
.well-known/assetlinks.json Digital Asset Links (package + SHA-256 da chave de upload; acrescentar a do Google se ativar a assinatura pela Play)
privacidade.html            política de privacidade (link exigido pela ficha da Play); estática, fora do app
.nojekyll                   desliga o Jekyll do Pages (sem ele, arquivos e pastas começando com _ sumiriam)
```

## Rodar localmente
```
python3 -m http.server 8765 --directory /mnt/project-files/site-nuvemshop/app_catalogo
```
Abrir http://127.0.0.1:8765/ (no celular da mesma rede, usar o IP do computador). O service worker só registra em
`localhost`/`127.0.0.1` ou HTTPS. A consulta de placa não funciona fora do domínio liberado (ver CORS abaixo) e cai na
mensagem amigável.

## Dados
- `dados/indice.json`, `produtos.json`, `imagens.json`, `marcas/*.json`: os mesmos do buscador do site (gerados em 25/10 por
  `buscador_veiculo/gerar_base.py`). `indice.json` e `produtos.json` do app saem de `gerar_detalhes.py` a partir desses: `produtos.json`
  ganha um 5º campo por peça (posição da linha na lista `linhas` de `indice.json`, ~5 KB no total), para o Início, a tela Linhas e
  os filtros por linha não esperarem `detalhes.json` (500 KB; no 3G as contagens caíram de ~28 s para ~18 s e o load de 24 s para 9 s). Regerar os dois sempre
  junto com `detalhes.json` (nunca copiar `produtos.json` do buscador direto para `dados/`: perderia a linha).
- `dados/detalhes.json`: por código → linha (`l`), números originais (`o`), aplicações (`a` = veículo/motor/anos),
  montadoras (`m`), embalagem (`e`). Fontes: `lote_seo/saida/*.json`, `etapa7_novos/saida/*.json`, o dicionário `manual`
  de `buscador_veiculo/gerar_base.py` e `mg_catalogo_export_2026-10-15.csv` (seção do catálogo impresso e OEM quando a ficha
  não tem). Nada inventado. Para regenerar: `python3 gerar_detalhes.py` (nesta pasta, roda em segundos; no fim chama
  `gerar_previas.py`, que refaz as 2.262 páginas de `p/` — nunca publicar `dados/` sem a `p/` da mesma rodada).
- Para usar os dados do jsDelivr em vez da cópia local: em `config.js`, `dadosBase: 'https://cdn.jsdelivr.net/gh/filipefrancas/mg-site-arquivos@main/busca-veiculo/'`
  (detalhes.json continua local, pois ainda não está no repositório). O service worker lê o mesmo config.js e pré-cacheia
  indice, produtos, imagens, as 32 tabelas marcas/*.json e detalhes.json desse endereço, então a busca por veículo funciona
  offline para qualquer marca logo após a primeira visita.
- `gerar_detalhes.py` descarta o que não é número original e imprime a lista para revisão: "-" do catálogo impresso
  (= sem original), texto com espaço (nome de veículo), ano solto e valores com 3 caracteres ou menos. Correções revisadas à
  mão ficam no dicionário `CORRECOES_OEM` do script (MG204, MG482, MG483, MG1620–MG1624, MG102); as fichas de origem em
  lote_seo/saida continuam com o erro e devem ser corrigidas lá quando der.
- Peça com flag de publicação 0 em produtos.json (25 peças) abre por link direto em #/peca/<código>, mas sem o botão
  "Ver no site" (a página do site responde 404) e com o aviso "não está publicada no site no momento".
- Fotos: CDN da Nuvemshop (`imagens.json`), 320 px na lista e 640 px no detalhe, carregamento preguiçoso, cache no service worker.

## Lacunas de dados
- 2.262 peças; 2.261 com aplicação (MG-G0239 sem), 2.119 com número original (143 sem: 104 estão com "-" no catálogo
  impresso, isto é, sem original conhecido; 7 tinham só texto de veículo na ficha e ficaram sem; 32 nunca tiveram).
- 14 linhas; só MG4095 caiu em "Outras Peças" (MG7517P/M foram para Metal-Borracha, MG924 para Suspensão).
- Peças sem foto no site aparecem como "Foto em breve".
- Filtro de marca do Mercado Livre: o app monta `lista.mercadolivre.com.br/<termo>_BRAND_64522`, com o termo
  "<CÓDIGO> <nome sem o trecho entre parênteses> MG Mangueiras - MG Peças Automotivas" (regras_filipe.md 27/10; o app tira
  o parêntese do nome, ex. MG236 "Mangueira do Filtro de Ar (Bocal Maior)" vira "MG236 Mangueira do Filtro de Ar MG
  Mangueiras - …"). O ID 64522 veio da anotação "o ML acrescenta _BRAND_64522 sozinho"; **conferir no notebook com o link
  que o botão do site gera hoje** (backup em backups\2026-10-27_botao_lojas_parceiras) e ajustar `mlMarcaId` em
  `config.js` se for outro (vazio = sem filtro).

## Publicar
### Opção A (em uso) — GitHub Pages da organização MGPECASAUTOMOTIVAS
1. Repositório `MGPECASAUTOMOTIVAS/mgpecasautomotivas.github.io`, ramo `main`, app na raiz; o workflow
   `.github/workflows/pages.yml` (actions/upload-pages-artifact + deploy-pages, caminho `.`) publica a cada push.
2. Endereço: `https://mgpecasautomotivas.github.io/`. Funciona como PWA (HTTPS). O manifest usa caminhos relativos
   (`start_url` `./#/`, `scope` `./`), então o escopo do service worker é `/`; o `"id": "/app_catalogo/"` foi mantido de
   propósito, porque é a identidade do app já instalado.
3. Endereço anterior (`filipefrancas.github.io/mg-site-arquivos/app/`): só redirecionamento, mantido no repositório antigo.

### Opção B — subdomínio app.mgpecasautomotivas.com.br (DNS na Incandescente)
1. Hospedar os arquivos em um lugar com HTTPS (GitHub Pages com domínio próprio, Cloudflare Pages ou Netlify; todos grátis).
2. Na Incandescente, criar um registro **CNAME** `app` apontando para o host escolhido (ex.: `mgpecasautomotivas.github.io`
   para Pages, com o arquivo `CNAME` contendo `app.mgpecasautomotivas.com.br` na pasta publicada).
3. Esperar o certificado HTTPS ser emitido (automático).
4. Trocar `URL_DO_APP` no `trecho_site_baixe_app.html` e colar no site quando o Filipe autorizar.

### Worker da placa (CORS) — obrigatório para a busca por placa funcionar no app
O Worker `mg-placa` (buscador_veiculo/worker-placa/worker.js) só responde a origens listadas na variável `ORIGENS`
(wrangler.toml: `https://www.mgpecasautomotivas.com.br,https://mgpecasautomotivas.com.br,https://mgmangueiras.com.br,https://www.mgmangueiras.com.br`).
Para qualquer outra origem o Worker responde o preflight com `Access-Control-Allow-Origin: null`; o navegador bloqueia a
chamada pelo CORS e o app nem recebe o 403 (o fetch falha com TypeError). Nesse caso o app mostra "A busca pela placa ainda
está sendo liberada para o app. Enquanto isso, busque pelo veículo ou pelo código." com os botões "Buscar pelo veículo" e
"Buscar por código ou nome" (app.js: motivoFalhaPlaca distingue CORS/rede de 404 "não encontrada", 429 e 5xx; a placa nunca
vai para o console nem para o localStorage). Quando a origem for liberada, a mesma chamada passa a funcionar sem mudar o app. Para liberar, acrescentar a origem exata (esquema +
host, sem caminho):
- Opção A (endereço atual do app): `https://mgpecasautomotivas.github.io`
- Opção B: `https://app.mgpecasautomotivas.com.br`
(`https://filipefrancas.github.io` não precisa mais: o endereço antigo só redireciona.)
Onde mudar: **sempre** em `[vars] ORIGENS` de `buscador_veiculo/worker-placa/wrangler.toml` e depois `npx wrangler deploy`
(o Worker é publicado pelo wrangler, e cada deploy grava as variáveis do wrangler.toml por cima das do painel: uma origem
acrescentada só em Cloudflare > Workers > mg-placa > Settings > Variables some no deploy seguinte). Se for mudado no painel,
repetir a mudança no wrangler.toml, ou acrescentar `keep_vars = true` ao wrangler.toml. Nenhuma mudança no código do Worker é
necessária. **Não foi feito nada no Cloudflare.**
Se o app for empacotado para as lojas (Capacitor), as origens passam a ser `capacitor://localhost` (iOS) e `https://localhost`
(Android); acrescentar também.

### Google Play (preparado em 02/11/2026; envio manual pelo Filipe)
O app vai para a Play como Trusted Web Activity (TWA) gerada pelo Bubblewrap: um app Android que abre
https://mgpecasautomotivas.github.io/ em tela cheia. Arquivos no repositório:
- `twa-manifest.json` — configuração do Bubblewrap (packageId `br.com.mgpecasautomotivas.catalogo`, nome, cores, ícones
  publicados, atalhos do manifest, `appVersion` = versão do config.js, `appVersionCode` inteiro crescente — **aumentar a
  cada .aab enviado à Play**; `signingKey` aponta para `mg-app-upload.keystore`, que NÃO está no repositório).
- `.github/workflows/android.yml` — "Android (Google Play)": Run workflow (ou tag `android-v*`) gera o `.aab` e o `.apk`
  assinados com a chave de upload vinda dos segredos `KEYSTORE_B64` e `KEYSTORE_PASSWORD` (ver
  `site-nuvemshop/app_catalogo/play/GUIA_GOOGLE_PLAY.md`); artefatos por 30 dias; release do GitHub quando for tag. Sem
  os segredos, falha no 1º passo com a mensagem em português. Não envia nada para a Play.
- `.well-known/assetlinks.json` — Digital Asset Links: o Android confere este arquivo para abrir o app sem a barra do
  Chrome. Traz a impressão SHA-256 da chave de upload. **Se a "Assinatura de apps pelo Google Play" for ativada (recomendado),
  a impressão da chave de assinatura do Google (Play Console → Integridade do app) precisa ser ACRESCENTADA à lista
  `sha256_cert_fingerprints`, mantendo a atual.** O Pages serve a pasta `.well-known` porque o `.nojekyll` existe.
- `privacidade.html` — política de privacidade exigida pela ficha da loja (https://mgpecasautomotivas.github.io/privacidade.html);
  estática, nos dois temas (a mesma regra do app: claro, a não ser que a pessoa tenha escolhido outro), sem contato. Não está
  linkada no app de propósito (visual aprovado intocado).
Fora do repositório, em `site-nuvemshop/app_catalogo/play/`: `chave/` (keystore, base64, senha, sha256 — guardar em lugar
seguro), `ficha/` (ícone, gráfico de destaque, capturas 1080×1920 e textos.md) e o guia.
Apple App Store: adiada (US$ 99/ano; empacotar via Capacitor quando for a hora).

### Dentro dos apps das lojas: nada de "instalar"
O mesmo app roda dentro do app da Google Play (TWA) e do app do iPhone (WKWebView). Lá ele já está instalado, então o
`app.js` (`APP_LOJA`) tira tudo o que é instalar o PWA: faixa flutuante, cartão "Instale o app" do Início, botão "Instalar
app no celular" e link "QR code e passo a passo" do Sobre e folha "Adicionar à Tela de Início"; `#/instalar` abre o Início.
O resto fica igual, e no navegador (ou no app instalado pelo navegador) nada muda.
- Google Play: a 1ª página aberta pelo app chega com `document.referrer` começando por
  `android-app://br.com.mgpecasautomotivas.catalogo`. O referrer só existe nessa carga, então a marca fica na sessão
  (`sessionStorage` `mg-app-loja`). As prévias `p/<código>.html` gravam a mesma marca antes de redirecionar (link de peça
  aberto pelo app); ao regerar a pasta `p/`, use o `gerar_previas.py` atual.
- App Store: o app nativo define `window.MG_APP_LOJA = 'ios'` no início do documento (WKUserScript em atDocumentStart) e
  acrescenta `MGCatalogoApp-iOS` ao user agent; qualquer um dos dois basta.
- O `<html>` recebe a classe `app-loja` e `data-app-loja="android"` ou `"ios"`; o teste de fumaça simula os dois apps e o navegador.

### Tema: claro por padrão (o Filipe pediu, 02/11/2026)
O app abre sempre no tema claro, como o site, qualquer que seja o tema do celular. O escuro só aparece quando a pessoa
escolhe: botão da lua no topo do Início (troca claro/escuro) ou Sobre › Tema (Automático, Claro, Escuro). A escolha fica em
`localStorage` `mg-tema` (`light`, `dark` ou `auto`; sem a chave, claro) e o script no `<head>` do `index.html` a aplica antes
da 1ª pintura (`data-theme` no `<html>`, `theme-color` e `color-scheme`). "Automático" segue o celular (`prefers-color-scheme`),
mas só vale se a pessoa escolher. No CSS, o bloco `@media (prefers-color-scheme: dark)` vale só com `data-theme="auto"`, e o
claro é `color-scheme: only light` (o Chrome não escurece a página sozinho). A impressão sai sempre em preto no branco.

## Regras seguidas
Sem preço, sem palavras de venda, sem e-mail/WhatsApp da MG, sem distribuidores ou clientes. Só dados reais dos arquivos.
Botão "Encontre em lojas parceiras online" com a letra pequena "Você será direcionado a revendedores independentes".

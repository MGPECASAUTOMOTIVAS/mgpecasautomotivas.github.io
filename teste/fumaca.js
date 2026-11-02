/* Teste de fumaça do app MG Peças (Playwright + Chromium, ~1 minuto).
   Sobe um servidor estático da raiz do repositório (pasta do app) e percorre os fluxos principais; qualquer falha derruba o processo (código 1).
   Uso:  node teste/fumaca.js [--capturas <pasta>]      (a pasta recebe algumas capturas de tela, opcional)
   Fotos da loja e fontes do Google são respondidas localmente (o teste não depende de rede).
   Esta pasta (teste/) não entra no pré-cache do service worker e é ignorada por ele. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path');
var chromium = require('playwright').chromium;

var APP = path.resolve(__dirname, '..');
var args = process.argv.slice(2), capturas = null;
for (var i = 0; i < args.length; i++) if (args[i] === '--capturas' && args[i + 1]) capturas = path.resolve(args[++i]);
if (capturas) fs.mkdirSync(capturas, { recursive: true });

var TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8' };
function servidor() {
  var srv = http.createServer(function (req, res) {
    var p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    var arq = path.join(APP, p);
    if (arq.indexOf(APP) !== 0 || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(arq).pipe(res);
  });
  var conexoes = new Set();
  srv.on('connection', function (c) { conexoes.add(c); c.on('close', function () { conexoes.delete(c); }); });
  srv.derrubar = function () { return new Promise(function (ok) { conexoes.forEach(function (c) { c.destroy(); }); srv.close(function () { ok(); }); }); };
  return new Promise(function (ok) { srv.listen(0, '127.0.0.1', function () { ok(srv); }); });
}

var falhas = [], passos = 0;
function ok(cond, msg) { passos++; if (cond) console.log('  ok  ' + msg); else { falhas.push(msg); console.log('  FALHA  ' + msg); } }
function igual(a, b, msg) { ok(a === b, msg + ' (' + JSON.stringify(a) + (a === b ? '' : ' ≠ ' + JSON.stringify(b)) + ')'); }
function versaoDe(arquivo, re) { var m = re.exec(fs.readFileSync(path.join(APP, arquivo), 'utf8')); return m ? m[1] : ''; }

/* erros de console: os de rede (fotos bloqueadas, servidor derrubado no teste offline) não contam */
function colher(page, lista) {
  page.on('pageerror', function (e) { lista.push('pageerror: ' + e.message); });
  page.on('console', function (m) { if (m.type() === 'error' && !/Failed to load resource|net::ERR_|ERR_CONNECTION|Service Worker/.test(m.text())) lista.push('console: ' + m.text()); });
}
/* respostas locais para o que vem de fora: fotos da loja → ícone do app; fontes → CSS vazio */
function rotas(ctx) {
  var icone = fs.readFileSync(path.join(APP, 'icones', 'icone-512.png'));
  return ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, function (route) {
    var u = route.request().url();
    if (/mitiendanube|nuvemshop|tiendanube/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: icone });
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.abort();
  });
}
/* muda o hash e espera a tela nova (o conteúdo antigo recebe data-velho para não ser confundido com o novo) */
async function ir(page, hash, seletor) {
  await page.evaluate(function (h) { var t = document.getElementById('conteudo'); if (t.firstElementChild) t.firstElementChild.setAttribute('data-velho', '1'); location.hash = h; }, hash);
  return page.waitForSelector('#conteudo > :not([data-velho]) ' + seletor, { timeout: 15000 });
}
async function capturar(page, nome) { if (capturas) { await page.waitForTimeout(250); /* fim da animação de entrada da tela */ await page.screenshot({ path: path.join(capturas, nome + '.png'), fullPage: false }); } }

(async function () {
  var t0 = Date.now(), srv = await servidor(), base = 'http://127.0.0.1:' + srv.address().port + '/';
  var versao = versaoDe('config.js', /versao:\s*'([^']+)'/), versaoSw = versaoDe('sw.js', /var VERSAO = '([^']+)'/);
  console.log('Servindo ' + APP + ' em ' + base + ' · versão ' + versao);

  console.log('\nArquivos');
  igual(versaoSw, versao, 'VERSAO do sw.js igual à versao do config.js');
  var sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8'), casca = /var CASCA = \[([\s\S]*?)\];/.exec(sw)[1].match(/'([^']+)'/g).map(function (s) { return s.slice(1, -1); });
  var faltando = casca.filter(function (a) { return a !== './' && !fs.existsSync(path.join(APP, a)); });
  ok(!faltando.length, 'todos os arquivos do pré-cache existem' + (faltando.length ? ': faltam ' + faltando.join(', ') : ''));
  ok(!casca.some(function (a) { return /teste/.test(a); }) && /teste\\\//.test(sw), 'teste/ fora do pré-cache e ignorado pelo service worker');
  /* instalável: manifesto com id/start_url/scope/display, ícones 192 e 512 any e maskable (arquivos existem), apple-touch-icon e metas do iPhone */
  var man = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8')), indexHtml = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  function temIcone(tam, uso) { return man.icons.some(function (i) { return i.sizes === tam + 'x' + tam && i.purpose === uso && fs.existsSync(path.join(APP, i.src)); }); }
  ok(man.name && man.short_name && man.id && man.start_url && man.scope && man.display === 'standalone' && man.theme_color && man.background_color, 'manifest.webmanifest com name, short_name, id, start_url, scope, display standalone e cores');
  ok(temIcone(192, 'any') && temIcone(512, 'any') && temIcone(192, 'maskable') && temIcone(512, 'maskable'), 'ícones 192/512 any e maskable do manifesto existem em icones/');
  ok(/rel="apple-touch-icon"[^>]*href="icones\/apple-touch-icon.png"/.test(indexHtml) && fs.existsSync(path.join(APP, 'icones', 'apple-touch-icon.png')) && /apple-mobile-web-app-capable/.test(indexHtml) && /apple-mobile-web-app-title/.test(indexHtml) && (indexHtml.match(/name="theme-color"/g) || []).length === 2, 'apple-touch-icon, metas apple-mobile-web-app-* e theme-color claro/escuro no index.html');
  /* linha de cada peça nos arquivos pequenos (gerar_detalhes.py): 5º campo de produtos.json = posição em indice.json "linhas" */
  var indiceJson = JSON.parse(fs.readFileSync(path.join(APP, 'dados', 'indice.json'), 'utf8')), produtosJson = JSON.parse(fs.readFileSync(path.join(APP, 'dados', 'produtos.json'), 'utf8'));
  ok(Array.isArray(indiceJson.linhas) && indiceJson.linhas.length === 14, 'indice.json traz a lista "linhas" (14)');
  ok(produtosJson.length === 2262 && produtosJson.every(function (p) { return p.length === 5 && typeof p[4] === 'number' && p[4] >= 0 && p[4] < indiceJson.linhas.length; }), 'produtos.json: 2.262 peças, cada uma com a posição da linha (5º campo)');
  /* foto de cada linha nos cartões (FOTO_LINHA em app.js): 14 códigos publicados, com foto em imagens.json e da própria linha */
  var imagensJson = JSON.parse(fs.readFileSync(path.join(APP, 'dados', 'imagens.json'), 'utf8')), appJs = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
  var fotoLinha = {}, reFL = /'([a-z-]+)':\s*'([^']+)'/g, blocoFL = /var FOTO_LINHA = \{([\s\S]*?)\};/.exec(appJs)[1], mFL;
  while ((mFL = reFL.exec(blocoFL))) fotoLinha[mFL[1]] = mFL[2];
  var fotoLinhaErros = indiceJson.linhas.filter(function (l) {
    var cod = fotoLinha[l], i = produtosJson.findIndex(function (p) { return p[0] === cod; });
    return !cod || i < 0 || !produtosJson[i][3] || !imagensJson.itens[String(i)] || indiceJson.linhas[produtosJson[i][4]] !== l;
  });
  ok(Object.keys(fotoLinha).length === 14 && !fotoLinhaErros.length, 'FOTO_LINHA: 14 linhas com peça publicada, com foto e da própria linha' + (fotoLinhaErros.length ? ' (erro em ' + fotoLinhaErros.join(', ') + ')' : ''));

  var browser = await chromium.launch();
  /* ---------- fluxos de tela (sem service worker, para as fotos virem das rotas locais) ---------- */
  var ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'pt-BR' });
  await rotas(ctx);
  await ctx.addInitScript(function () {
    /* sem Web Share: "Compartilhar" cai no copiar; o texto copiado fica em window.__copiado */
    try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (e) {}
    var cb = { writeText: function (t) { window.__copiado = t; return Promise.resolve(); } };
    try { Object.defineProperty(navigator, 'clipboard', { value: cb, configurable: true }); } catch (e) {}
    /* impressão: window.print() só conta as chamadas (a caixa de impressão não abre no teste; afterprint é disparado à mão) */
    window.__imprimiu = 0; window.print = function () { window.__imprimiu++; };
  });
  var page = await ctx.newPage(), erros = [];
  colher(page, erros);

  console.log('\nInício');
  await page.goto(base + '#/');
  await page.waitForSelector('.secao-busca .entrada');
  /* Início (pedido do Filipe, ciclo 23): campo de código/nome primeiro com o botão na mesma linha, veículo em cartão compacto,
     sem o cartão azul; a placa fica num cartão discreto perto do fim, acima do texto legal (a aba Placa continua) */
  var ordem = await page.evaluate(function () {
    function t(sel) { var e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().top) : -1; }
    var b = document.querySelector('.inicio .busca-linha').getBoundingClientRect(), btn = document.querySelector('.inicio .btn-buscar').getBoundingClientRect(), pl = document.querySelector('.inicio .cartao-placa');
    return { hero: !!document.querySelector('.cartao-mg'), h1: (document.querySelector('#conteudo h1') || {}).textContent, busca: t('.inicio .busca-linha'), veic: t('.inicio .cartao-compacto'), linhas: t('.inicio .grade-linhas'), placa: t('.inicio .cartao-placa'), nota: t('.inicio .nota-legal'),
      alturaBusca: Math.round(b.height), btnLinha: Math.abs(btn.top - b.top) < 2 && btn.height >= 44 && btn.width >= 44, placaHref: pl && pl.getAttribute('href'), placaAltura: pl ? Math.round(pl.getBoundingClientRect().height) : 0, privacidade: /dado do proprietário/.test(document.getElementById('conteudo').textContent) };
  });
  ok(!ordem.hero && ordem.h1 === 'Catálogo MG Peças Automotivas', 'Início sem o cartão azul, com h1 (oculto) da tela');
  ok(ordem.busca < ordem.veic && ordem.veic < ordem.linhas && ordem.linhas < ordem.placa && ordem.placa < ordem.nota, 'ordem do Início: código/nome → veículo → linhas → placa → texto legal');
  ok(ordem.alturaBusca <= 60 && ordem.btnLinha, 'campo e botão Buscar na mesma linha de até 60 px, botão com 44 px ou mais (' + ordem.alturaBusca + ' px)');
  ok(ordem.placaHref === '#/placa' && ordem.placaAltura >= 44 && ordem.placaAltura <= 72 && !ordem.privacidade, 'cartão discreto "Tem a placa?" abre #/placa (' + ordem.placaAltura + ' px) e o aviso de privacidade não está no Início');
  await page.waitForFunction(function () { return !/…/.test(document.querySelector('.grade-linhas .cont').textContent); });
  ok((await page.$$('.grade-linhas .linha-card')).length === 6, 'Início mostra 6 linhas de produtos com contagem');
  /* cartões das linhas com a foto da peça típica (as fotos da loja chegam pelas rotas locais) e nome/contagem abaixo */
  await page.waitForFunction(function () { return document.querySelectorAll('.grade-linhas .linha-foto.ok img').length === 6; }, null, { timeout: 10000 });
  var fotosInicio = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.grade-linhas .linha-card'), function (a) {
      var img = a.querySelector('.linha-foto img'), f = a.querySelector('.linha-foto').getBoundingClientRect(), t = a.querySelector('.linha-txt b').getBoundingClientRect();
      return { src: img.src, alt: img.alt, lazy: img.loading, abaixo: t.top >= f.bottom, altura: Math.round(f.height), largura: Math.round(f.width), cartao: Math.round(a.getBoundingClientRect().height) };
    });
  });
  var codInicio = ['filtro-ar', 'arrefecimento', 'respiro', 'reservatorios', 'tampas-reservatorio', 'tubos-conexoes'].map(function (l) { return fotoLinha[l]; });
  ok(fotosInicio.every(function (f, i) { var idx = produtosJson.findIndex(function (p) { return p[0] === codInicio[i]; }); return f.src.indexOf(imagensJson.itens[String(idx)]) >= 0 && /-320-0\.webp$/.test(f.src); }), 'fotos do Início são as peças de FOTO_LINHA na variante de 320 px (' + codInicio.join(', ') + ')');
  var semRolar = await page.evaluate(function () { var c = document.querySelector('.grade-linhas .linha-card').getBoundingClientRect(), a = document.querySelector('.abas').getBoundingClientRect(); return [Math.round(c.bottom), Math.round(a.top), window.scrollY]; });
  ok(semRolar[2] === 0 && semRolar[0] <= semRolar[1], 'em 390x844 o campo, o cartão do veículo e a 1ª fileira das linhas aparecem sem rolar (cartão até y=' + semRolar[0] + ', abas em y=' + semRolar[1] + ')');
  ok(fotosInicio.every(function (f) { return f.lazy === 'lazy' && f.alt === '' && f.abaixo && f.largura > 120 && Math.abs(f.altura - f.largura * 11 / 20) <= 2 && f.cartao >= 44; }), 'fotos preguiçosas e decorativas (alt vazio: o nome do link é o da linha), caixa 20:11 e nome abaixo (' + fotosInicio[0].largura + '×' + fotosInicio[0].altura + ', cartão ' + fotosInicio[0].cartao + ' px)');
  var brancoFoto = await page.evaluate(function () { return getComputedStyle(document.querySelector('.grade-linhas .linha-foto.ok')).backgroundColor; });
  await page.emulateMedia({ colorScheme: 'dark' });
  var brancoFotoEscuro = await page.evaluate(function () { return getComputedStyle(document.querySelector('.grade-linhas .linha-foto.ok')).backgroundColor; });
  await page.emulateMedia({ colorScheme: 'light' });
  ok(brancoFoto === 'rgb(255, 255, 255)' && brancoFotoEscuro === 'rgb(255, 255, 255)', 'caixa da foto branca nos dois temas (a peça lê bem no escuro)');
  /* sem as fotos (CDN fora do ar ou offline): os cartões voltam ao ícone da linha, sem esqueleto preso */
  var ctxSemFoto = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'pt-BR' });
  await ctxSemFoto.route(/^https?:\/\/(?!127\.0\.0\.1)/, function (route) { return route.abort(); });
  var pSemFoto = await ctxSemFoto.newPage(); colher(pSemFoto, erros);
  await pSemFoto.goto(base + '#/'); await pSemFoto.waitForSelector('.grade-linhas .linha-card');
  await pSemFoto.waitForFunction(function () { return document.querySelectorAll('.grade-linhas .linha-foto.icone svg').length === 6 && !document.querySelector('.grade-linhas .linha-foto.aguardando, .grade-linhas .linha-foto img'); }, null, { timeout: 10000 });
  ok(true, 'com as fotos falhando, os 6 cartões mostram o ícone da linha');
  await capturar(pSemFoto, '01b-inicio-sem-fotos');
  await ctxSemFoto.close();
  ok(await page.$('.aba[data-aba="inicio"][aria-selected="true"]'), 'aba Início selecionada');
  await capturar(page, '01-inicio-claro');
  await page.emulateMedia({ colorScheme: 'dark' }); await capturar(page, '02-inicio-escuro'); await page.emulateMedia({ colorScheme: 'light' });
  /* × do campo: só o do app (o nativo do type=search fica escondido); no Início aparece ao digitar e limpa sem sair da tela */
  var xInicio = await page.evaluate(function () { var i = document.querySelector('.secao-busca .entrada'); return { nativo: getComputedStyle(i, '::-webkit-search-cancel-button').webkitAppearance, limparVazio: document.querySelector('.secao-busca .limpar').hidden }; });
  await page.fill('.secao-busca .entrada', 'mg0');
  var xDigitado = await page.evaluate(function () { return !document.querySelector('.secao-busca .limpar').hidden; });
  await page.focus('.secao-busca .entrada'); await page.keyboard.press('Tab');
  ok(await page.evaluate(function () { return document.activeElement.classList.contains('btn-buscar'); }), 'teclado: Tab do campo vai direto ao botão Buscar (o × fica fora do Tab)');
  await page.click('.secao-busca .limpar');
  var xLimpo = await page.evaluate(function () { return { valor: document.querySelector('.secao-busca .entrada').value, foco: document.activeElement === document.querySelector('.secao-busca .entrada'), hash: location.hash, escondido: document.querySelector('.secao-busca .limpar').hidden }; });
  ok(xInicio.nativo === 'none' && xInicio.limparVazio && xDigitado && xLimpo.valor === '' && xLimpo.foco && xLimpo.hash === '#/' && xLimpo.escondido, 'campo do Início: × nativo escondido, × do app só com texto, limpar esvazia e mantém o foco na mesma tela');
  /* o aviso de privacidade da placa fica só na tela Placa (destino do cartão discreto); ao voltar pelo histórico o Início
     abre na mesma posição (antes pulava para o topo) e trocar o tema no topo também mantém a posição */
  await page.evaluate(function () { document.querySelector('.inicio .cartao-placa').scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(150);
  var yAntes = await page.evaluate(function () { return window.scrollY; });
  await page.click('.inicio .cartao-placa'); await page.waitForSelector('#conteudo .entrada-placa');
  ok(/Nenhum dado do proprietário/.test(await page.textContent('#conteudo')), 'tela Placa (pelo cartão discreto) com o aviso de privacidade');
  ok((await page.evaluate(function () { return window.scrollY; })) === 0, 'tela nova abre no topo');
  await page.goBack(); await page.waitForSelector('#conteudo .secao-busca .entrada'); await page.waitForTimeout(150);
  var yDepois = await page.evaluate(function () { return window.scrollY; });
  ok(yAntes > 200 && Math.abs(yDepois - yAntes) <= 2, 'voltar pelo histórico: Início na mesma posição (' + yAntes + ' → ' + yDepois + ')');
  await page.click('.topo .btn-icone[title="Tema"]'); await page.waitForSelector('#conteudo .secao-busca .entrada'); await page.waitForTimeout(150);
  var temaTroca = await page.evaluate(function () { return { y: window.scrollY, tema: document.documentElement.getAttribute('data-theme') }; });
  ok(temaTroca.tema === 'dark' && Math.abs(temaTroca.y - yAntes) <= 2, 'trocar o tema no topo mantém a posição (' + temaTroca.y + ')');
  await page.click('.topo .btn-icone[title="Tema"]'); await page.waitForSelector('#conteudo .secao-busca .entrada');
  await page.evaluate(function () { localStorage.removeItem('mg-tema'); document.documentElement.removeAttribute('data-theme'); });

  console.log('\nInício e busca por código antes de detalhes.json');
  var pLento = await ctx.newPage(); colher(pLento, erros);
  var segurar = true;
  await pLento.route(/detalhes\.json/, async function (route) { var fim = Date.now() + 20000; while (segurar && Date.now() < fim) await new Promise(function (r) { setTimeout(r, 100); }); route.continue(); });
  await pLento.goto(base + '#/'); await pLento.waitForSelector('.secao-busca .entrada');
  var tCont = Date.now();
  await pLento.waitForFunction(function () { return !/…/.test(document.querySelector('.grade-linhas .cont').textContent); }, null, { timeout: 8000 }).then(function () { ok(true, 'contagens do Início aparecem sem esperar detalhes.json (' + (Date.now() - tCont) + ' ms)'); }, function () { ok(false, 'contagens do Início esperam detalhes.json'); });
  igual(await pLento.textContent('.grade-linhas .linha-card:first-child .cont'), '423 peças', 'Mangueiras do Filtro de Ar: 423 peças publicadas (pela linha em produtos.json)');
  await ir(pLento, '#/busca?q=mg001', '.painel-res .res-cont b');
  igual(await pLento.textContent('#conteudo .lista .item-cod'), 'MG001', '"mg001" responde antes de detalhes.json');
  ok(!(await pLento.$('#conteudo .lista .item-apl')), 'sem aplicação enquanto detalhes.json não chega');
  segurar = false;
  await pLento.waitForSelector('#conteudo .lista .item-apl', { timeout: 15000 });
  ok(/Fiat Palio/.test(await pLento.textContent('#conteudo .lista .item-apl')), 'aplicação entra no cartão quando detalhes.json chega');
  await pLento.close();

  console.log('\nBusca por texto antes de detalhes.json (lista parcial)');
  var pParcial = await ctx.newPage(); colher(pParcial, erros);
  var segurar2 = true, pedidosDetalhes = 0;
  await pParcial.route(/detalhes\.json/, async function (route) { pedidosDetalhes++; var fim = Date.now() + 20000; while (segurar2 && Date.now() < fim) await new Promise(function (r) { setTimeout(r, 100); }); route.continue(); });
  await pParcial.goto(base + '#/busca?q=' + encodeURIComponent('mangueira radiador'));
  await pParcial.waitForSelector('#conteudo .aviso-parcial', { timeout: 15000 });
  await pParcial.waitForSelector('#conteudo .painel-res .res-cont b', { timeout: 15000 });
  var nParcial = +(await pParcial.textContent('#conteudo .res-cont b'));
  ok(nParcial > 0, '"mangueira radiador" responde pelo índice parcial com o aviso "Carregando aplicações…" (' + nParcial + ' peças)');
  ok(!(await pParcial.$('#conteudo .lista .item-apl')), 'sem aplicação nos cartões enquanto detalhes.json não chega');
  /* filtro de linha escolhido na lista parcial continua quando a lista é refeita */
  var chipFiltro = await pParcial.$('#conteudo .filtro-linhas .chip:nth-child(2)'), filtroTxt = '';
  if (chipFiltro) { filtroTxt = (await chipFiltro.textContent()).replace(/\s*\(\d+\)$/, ''); await chipFiltro.click(); }
  /* "Mostrar mais" aberto na lista parcial: as mesmas páginas ficam abertas quando a lista é refeita */
  var paginasAntes = 1;
  if (await pParcial.$('#conteudo .painel-res .mais:not([hidden])')) { await pParcial.click('#conteudo .painel-res .mais button'); paginasAntes = +(await pParcial.getAttribute('#conteudo .painel-res', 'data-paginas')); }
  igual(paginasAntes, 2, '"Mostrar mais" abre a 2ª página na lista parcial (data-paginas)');
  segurar2 = false;
  await pParcial.waitForFunction(function () { return !document.querySelector('#conteudo .aviso-parcial') && document.querySelector('#conteudo .painel-res .res-cont b'); }, null, { timeout: 15000 });
  var nCompleto = await pParcial.evaluate(function () { return MG_APP.buscarTexto('mangueira radiador').then(function (l) { return l.length; }); });
  var contTxt = await pParcial.textContent('#conteudo .res-cont'), mTotal = /de (\d+)/.exec(contTxt);
  igual(mTotal ? +mTotal[1] : +(await pParcial.textContent('#conteudo .res-cont b')), nCompleto, 'lista refeita quando detalhes.json chega, com a contagem completa');
  ok(nCompleto >= nParcial, 'a lista completa não perde peças da parcial (' + nParcial + ' → ' + nCompleto + ')');
  ok((await pParcial.$$('#conteudo .lista .item-apl')).length >= 1, 'aplicações entram nos cartões');
  igual((await pParcial.$$('#conteudo .painel-res')).length, 1, 'um painel de resultados só (nada duplicado)');
  if (chipFiltro) igual((await pParcial.textContent('#conteudo .filtro-linhas .chip.ativo')).replace(/\s*\(\d+\)$/, ''), filtroTxt, 'filtro de linha mantido depois da lista refeita');
  var nVis = +(await pParcial.textContent('#conteudo .res-cont b')), nLi = (await pParcial.$$('#conteudo .painel-res .lista > li')).length;
  igual(+(await pParcial.getAttribute('#conteudo .painel-res', 'data-paginas')), Math.min(paginasAntes, Math.ceil(nVis / 30)), 'páginas do "Mostrar mais" reabertas na lista refeita');
  ok(nLi === Math.min(nVis, paginasAntes * 30), 'lista refeita com as mesmas peças à vista (' + nLi + ' de ' + nVis + ')');
  igual(pedidosDetalhes, 1, 'detalhes.json pedido uma vez só');
  await pParcial.close();

  var pCartao = await ctx.newPage(); colher(pCartao, erros);
  var segurar3 = true;
  await pCartao.route(/detalhes\.json/, async function (route) { var fim = Date.now() + 20000; while (segurar3 && Date.now() < fim) await new Promise(function (r) { setTimeout(r, 100); }); route.continue(); });
  await pCartao.goto(base + '#/busca?q=' + encodeURIComponent('mangueira palio'));
  await pCartao.waitForSelector('#conteudo .cartao-veic', { timeout: 15000 });
  ok(/Fiat Palio/.test(await pCartao.textContent('#conteudo .cartao-veic')), 'cartão "Ver peças para Fiat Palio" entra pelo índice, antes de detalhes.json');
  await pCartao.waitForSelector('#conteudo .aviso-parcial', { timeout: 15000 }); /* a busca espera 400 ms por detalhes.json antes de avisar */
  ok(await pCartao.$('#conteudo .aviso-parcial') && await pCartao.$('#conteudo .esqueleto'), '"mangueira palio" espera as aplicações (aviso + esqueleto), sem dizer "nada encontrado"');
  segurar3 = false;
  await pCartao.waitForSelector('#conteudo .painel-res .res-cont b', { timeout: 15000 });
  ok(+(await pCartao.textContent('#conteudo .res-cont b')) > 0 && !(await pCartao.$('#conteudo .aviso-parcial')), 'lista de "mangueira palio" aparece quando detalhes.json chega');
  igual((await pCartao.$$('#conteudo .cartao-veic')).length, 1, 'um cartão do veículo só');
  await pCartao.close();

  console.log('\nBusca por texto');
  await ir(page, '#/busca?q=' + encodeURIComponent('mangueria radiador gol'), '.painel-res .res-cont b');
  var nTexto = +(await page.textContent('#conteudo .res-cont b'));
  ok(nTexto > 0, '"mangueria radiador gol" encontra peças (' + nTexto + ')');
  ok((await page.textContent('#conteudo')).indexOf('Buscamos também por') >= 0, 'correção "mangueria" → mangueira avisada');
  var cartaoVeic = await page.$('#conteudo .cartao-veic');
  ok(cartaoVeic, 'cartão "Ver peças para Volkswagen Gol" acima dos resultados');
  igual(await page.textContent('#conteudo .topo-sub, .topo .topo-sub'), '“mangueria radiador gol”', 'termo no topo');
  var xRes = await page.evaluate(function () { var i = document.querySelector('#conteudo .busca-linha .entrada'); return { nativo: getComputedStyle(i, '::-webkit-search-cancel-button').webkitAppearance, limpar: document.querySelectorAll('#conteudo .busca-linha .limpar:not([hidden])').length, pad: getComputedStyle(i).paddingRight }; });
  ok(xRes.nativo === 'none' && xRes.limpar === 1 && xRes.pad === '48px', 'resultados: um × só no campo (o nativo escondido), com espaço para ele');
  /* voltar da ficha para a lista: a lista reabre na mesma posição */
  await page.evaluate(function () { document.querySelectorAll('#conteudo .lista .item')[3].scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(150);
  var yLista = await page.evaluate(function () { return window.scrollY; });
  await page.click('#conteudo .lista .item >> nth=3'); await page.waitForSelector('#conteudo .detalhe-cod');
  await page.goBack(); await page.waitForSelector('#conteudo .painel-res .res-cont b'); await page.waitForTimeout(400);
  var yLista2 = await page.evaluate(function () { return window.scrollY; });
  ok(yLista > 100 && Math.abs(yLista2 - yLista) <= 2, 'voltar da ficha: lista de resultados na mesma posição (' + yLista + ' → ' + yLista2 + ')');

  console.log('\nBusca por veículo');
  await ir(page, '#/veiculo/Volkswagen/Gol/2010?motor=1.6', '.painel-res .res-cont b');
  var nGol = +(await page.textContent('#conteudo .res-cont b'));
  igual(nGol, 96, 'Gol 2010 1.6 = 96 peças');
  var nApi = await page.evaluate(function () { return MG_APP.buscarVeiculo({ marca: 'Volkswagen', modelo: 'Gol', ano: 2010, motor: '1.6' }).then(function (l) { return l.length; }); });
  igual(nApi, 96, 'MG_APP.buscarVeiculo devolve os mesmos 96');
  ok(await page.$('#conteudo .filtro-veic .chip.ativo'), 'chips de ano/motor com o ativo marcado');
  ok(await page.$('#conteudo .filtro-linhas'), 'filtro por linha nos resultados');
  await capturar(page, '03-gol-2010');
  await ir(page, '#/veiculo/MarcaInexistente/Modelo/2010', '.vazio');
  ok((await page.textContent('#conteudo .vazio h2')).indexOf('Nenhuma peça cadastrada') === 0, 'marca fora do índice: estado vazio, não erro de conexão');

  console.log('\nFicha da peça');
  await ir(page, '#/peca/MG001', 'table.tabela tbody tr');
  igual(await page.textContent('#conteudo .detalhe-cod'), 'MG001', 'código na ficha');
  ok((await page.$$('#conteudo table.tabela tbody tr')).length >= 2, 'tabela de aplicação com linhas');
  ok((await page.$$('#conteudo .oem code')).length >= 1, 'números originais listados');
  var linkOutro = await page.$('#conteudo .cartao .link-outro-veic'), hrefOutro = linkOutro ? await linkOutro.getAttribute('href') : '';
  ok(linkOutro && /^#\/busca\?linha=[a-z-]+$/.test(hrefOutro), 'link "Buscar esta peça para outro veículo" abaixo da tabela de aplicação (' + hrefOutro + ')');
  ok(linkOutro && (await linkOutro.boundingBox()).height >= 44, 'link com toque de 44px');
  await page.waitForSelector('#conteudo .detalhe-foto img.ok');
  await capturar(page, '04-peca-mg001');
  /* seleção do mouse presa à caixa dos números originais (Chromium, sem user-select: contain): com o botão pressionado, a
     seleção que sai da caixa volta para dentro; solto fora da janela (blur), os ouvintes somem e nada mais é preso */
  if (!(await page.evaluate(function () { return CSS.supports('user-select', 'contain'); }))) {
    async function selecionarForaDaCaixa() {
      await page.evaluate(function () { var c = document.querySelector('#conteudo .oem code').firstChild, fora = document.querySelector('#conteudo .acoes-fixas .nota-legal').firstChild; document.getSelection().setBaseAndExtent(c, 0, fora, 3); });
      await page.waitForTimeout(80);
      return page.evaluate(function () { var s = document.getSelection(); return !!s.focusNode && document.querySelector('#conteudo .oem').contains(s.focusNode); });
    }
    await page.evaluate(function () { document.querySelector('#conteudo .oem').scrollIntoView({ block: 'center' }); });
    var caixa = await (await page.$('#conteudo .oem code')).boundingBox();
    await page.mouse.move(caixa.x + 4, caixa.y + caixa.height / 2); await page.mouse.down();
    ok(await selecionarForaDaCaixa(), 'com o mouse pressionado, a seleção fica presa à caixa dos números originais');
    await page.evaluate(function () { window.dispatchEvent(new Event('blur')); });
    ok(!(await selecionarForaDaCaixa()), 'mouse solto fora da janela (blur): os ouvintes somem e a seleção não é mais presa');
    await page.mouse.up(); await page.evaluate(function () { document.getSelection().removeAllRanges(); });
  }
  await ir(page, '#/peca/XYZ999', '.vazio');
  ok((await page.textContent('#conteudo .vazio h2')).indexOf('não encontrada') > 0, 'código desconhecido: "Peça não encontrada"');

  console.log('\nMinhas peças');
  await ir(page, '#/peca/MG001', '.btn-favorito');
  await page.click('#conteudo .btn-favorito');
  await page.waitForSelector('#conteudo .btn-favorito[aria-pressed="true"]');
  igual(await page.textContent('#toast .toast-txt'), 'Salva em Minhas peças', 'toast ao salvar');
  igual(await page.evaluate(function () { return localStorage.getItem('mg-favoritos'); }), '["MG001"]', 'favorito gravado no aparelho');
  await ir(page, '#/', '.secao.minhas:not([hidden]) .item-cod');
  igual(await page.textContent('#conteudo .secao.minhas .item-cod'), 'MG001', 'seção "Minhas peças" no Início');
  await ir(page, '#/minhas', '.lista .item-cod');
  igual(await page.textContent('#conteudo .res-cab p'), '1 peça salva neste aparelho', 'tela Minhas peças');
  await ir(page, '#/peca/MG001', '.btn-favorito[aria-pressed="true"]');
  await page.click('#conteudo .btn-favorito');
  await page.waitForSelector('#conteudo .btn-favorito[aria-pressed="false"]');
  igual(await page.evaluate(function () { return localStorage.getItem('mg-favoritos'); }), '[]', 'favorito removido');

  console.log('\nCompartilhar');
  await page.click('#conteudo .acoes-peca button:nth-child(2)');
  await page.waitForFunction(function () { return !!window.__copiado; });
  var copiado = await page.evaluate(function () { return window.__copiado; });
  ok(/\/p\/MG001\.html$/.test(copiado), 'link copiado aponta para p/MG001.html (' + copiado + ')');
  igual(await page.textContent('#toast .toast-txt'), 'Link copiado', 'toast "Link copiado"');

  console.log('\nMinha lista');
  /* 5ª aba "Lista" (a barra não passa de 5) e estado vazio explicando como adicionar */
  igual((await page.$$('.abas .aba')).length, 5, 'barra com 5 abas (Início, Placa, Busca, Linhas, Lista)');
  await ir(page, '#/lista', '.vazio');
  var vazioLista = await page.evaluate(function () { return { h2: document.querySelector('#conteudo .vazio h2').textContent, p: document.querySelector('#conteudo .vazio p').textContent, badge: !!document.querySelector('.aba[data-aba="lista"] .aba-badge'), aba: document.querySelector('.aba[data-aba="lista"]').getAttribute('aria-selected') }; });
  ok(vazioLista.h2 === 'Lista vazia' && /Adicionar à lista/.test(vazioLista.p) && /“\+”/.test(vazioLista.p) && !vazioLista.badge && vazioLista.aba === 'true', 'tela Lista vazia explica como adicionar (ficha e "+"), aba Lista selecionada e sem contador');
  /* ficha: adicionar (qtd 1) e somar 1 */
  await ir(page, '#/peca/MG001', '.btn-lista');
  var btnListaBox = await (await page.$('#conteudo .btn-lista')).boundingBox();
  ok(btnListaBox.height >= 44 && (await page.textContent('#conteudo .btn-lista')).trim() === 'Adicionar à lista' && (await page.$$('#conteudo .acoes-peca .btn')).length === 4, 'botão "Adicionar à lista" na ficha, junto de Salvar peça, Compartilhar e Imprimir / PDF, com 44 px');
  await page.click('#conteudo .btn-lista');
  await page.waitForFunction(function () { var t = document.getElementById('toast'); return !t.hidden && /Na lista/.test(t.textContent); });
  igual(await page.textContent('#toast .toast-txt'), 'Na lista', 'toast "Na lista"');
  igual(await page.getAttribute('#toast .toast-acao', 'href'), '#/lista', '"Ver lista" no toast abre #/lista');
  var l1 = await page.evaluate(function () { return JSON.parse(localStorage.getItem('mg-lista')); });
  ok(l1.length === 1 && l1[0].codigo === 'MG001' && l1[0].qtd === 1 && /^\d{4}-\d\d-\d\dT/.test(l1[0].adicionadoEm), 'mg-lista no aparelho: [{ codigo, qtd: 1, adicionadoEm }]');
  await page.click('#conteudo .btn-lista');
  await page.waitForFunction(function () { return /Lista: 2 un\./.test(document.getElementById('toast').textContent); });
  igual(await page.textContent('#toast .toast-txt'), 'Lista: 2 un.', 'segundo toque soma 1: toast "Lista: 2 un."');
  var badges = await page.evaluate(function () { return { botao: document.querySelector('#conteudo .btn-lista .btn-badge').textContent, aba: document.querySelector('.aba[data-aba="lista"] .aba-badge').textContent, nome: document.querySelector('.aba[data-aba="lista"]').getAttribute('aria-label'), qtd: JSON.parse(localStorage.getItem('mg-lista'))[0].qtd }; });
  ok(badges.botao === '2' && badges.aba === '1' && badges.nome === 'Lista, 1 peça' && badges.qtd === 2, 'quantidade 2 no botão da ficha, contador 1 na aba Lista (nome acessível "Lista, 1 peça") e qtd 2 gravada');
  await capturar(page, '10-ficha-adicionar-lista');
  /* "+" discreto por cartão nos resultados por veículo */
  await ir(page, '#/veiculo/Volkswagen/Gol/2010?motor=1.6', '.painel-res .lista .item-lista');
  var mais = await page.evaluate(function () { var b = document.querySelector('#conteudo .painel-res .lista .item-lista'), r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), w: r.width, h: r.height, seta: !!b.parentNode.querySelector('.item-seta'), cod: b.parentNode.querySelector('.item-cod').textContent }; });
  ok(/^Adicionar [A-Z0-9-]+ à lista$/.test(mais.label) && mais.w >= 44 && mais.h >= 44 && !mais.seta, 'cartão do resultado com botão "+" de 44 px ("' + mais.label + '") no lugar da seta');
  await page.click('#conteudo .painel-res .lista .item-lista');
  await page.waitForFunction(function () { return /na lista/.test(document.getElementById('toast').textContent); });
  igual(await page.textContent('#toast .toast-txt'), mais.cod + ' na lista', 'toast do "+" com o código');
  igual(await page.textContent('#conteudo .painel-res .lista .item-lista .item-lista-num'), '1', 'número no "+" mostra 1 na lista');
  var cod2 = mais.cod;
  /* tela da lista: cartões, totais, quantidade (−, número editável, +), texto exato, WhatsApp e copiar */
  await ir(page, '#/lista', '.lista-item');
  igual((await page.$$('#conteudo .lista-item')).length, 2, 'lista com 2 peças');
  igual(await page.textContent('#conteudo .lista-cont'), '2 peças · 3 unidades neste aparelho', 'total de peças e unidades');
  var itemInfo = await page.evaluate(function () { var li = document.querySelector('#conteudo .lista-item'), b = li.querySelectorAll('.qtd-btn'); function r(e) { var x = e.getBoundingClientRect(); return x.width >= 44 && x.height >= 44; } return { cod: li.querySelector('.item-cod').textContent, linha: li.querySelector('.item-apl').textContent, foto: !!li.querySelector('.foto'), val: li.querySelector('.qtd-num').value, toque: r(b[0]) && r(b[1]) && r(li.querySelector('.qtd-num')) && r(li.querySelector('.item-remover')), remover: li.querySelector('.item-remover').getAttribute('aria-label') }; });
  ok(itemInfo.cod === 'MG001' && itemInfo.linha === 'Mangueiras do Filtro de Ar' && itemInfo.foto && itemInfo.val === '2' && itemInfo.toque && itemInfo.remover === 'Remover MG001 da lista', 'cartão com miniatura, código, nome, linha, quantidade 2 e controles de 44 px (' + JSON.stringify(itemInfo) + ')');
  await page.click('#conteudo .lista-item >> nth=0 >> .qtd-btn >> nth=1');
  igual(await page.inputValue('#conteudo .lista-item >> nth=0 >> .qtd-num'), '3', '"+" na lista: 3');
  igual(await page.evaluate(function () { return JSON.parse(localStorage.getItem('mg-lista'))[0].qtd; }), 3, 'qtd 3 gravada');
  igual(await page.textContent('#conteudo .lista-cont'), '2 peças · 4 unidades neste aparelho', 'total atualizado na hora');
  await page.click('#conteudo .lista-item >> nth=0 >> .qtd-btn >> nth=0');
  igual(await page.inputValue('#conteudo .lista-item >> nth=0 >> .qtd-num'), '2', '"−" na lista: 2');
  await page.fill('#conteudo .lista-item >> nth=0 >> .qtd-num', '12'); await page.keyboard.press('Enter');
  igual(await page.evaluate(function () { return JSON.parse(localStorage.getItem('mg-lista'))[0].qtd; }), 12, 'número editado (12 + Enter) gravado');
  await page.fill('#conteudo .lista-item >> nth=0 >> .qtd-num', '0'); await page.keyboard.press('Enter');
  ok((await page.inputValue('#conteudo .lista-item >> nth=0 >> .qtd-num')) === '1' && (await page.evaluate(function () { return document.querySelector('#conteudo .lista-item .qtd-btn').disabled; })), '0 vira 1 (mínimo) e o "−" fica desativado');
  await page.fill('#conteudo .lista-item >> nth=0 >> .qtd-num', '5000'); await page.keyboard.press('Enter');
  igual(await page.inputValue('#conteudo .lista-item >> nth=0 >> .qtd-num'), '999', '5000 vira 999 (máximo)');
  await page.fill('#conteudo .lista-item >> nth=0 >> .qtd-num', '2'); await page.keyboard.press('Enter');
  var hoje = (function () { var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; }; return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear(); })();
  var nome2 = produtosJson.filter(function (p) { return p[0] === cod2; })[0][1];
  var esperado = 'Lista de peças MG · ' + hoje + '\n\n2 un. · MG001 · Mangueira do Filtro de Ar\n1 un. · ' + cod2 + ' · ' + nome2 + '\n\nCatálogo MG Peças Automotivas\nhttps://mgpecasautomotivas.github.io/';
  igual(await page.textContent('#conteudo .lista-texto-pre'), esperado, 'texto gerado exato (cabeçalho com a data, "2 un. · MG001 · nome", rodapé com o catálogo e o link)');
  igual(await page.evaluate(function () { return MG_APP.textoLista(); }), esperado, 'MG_APP.textoLista devolve o mesmo texto');
  var zap = await page.evaluate(function () { var a = document.querySelector('#conteudo .btn-zap'); return { href: a.getAttribute('href'), target: a.target, rel: a.rel }; });
  ok(zap.href === 'https://wa.me/?text=' + encodeURIComponent(esperado) && zap.target === '_blank' && /noopener/.test(zap.rel), '"Enviar pelo WhatsApp" abre wa.me sem número de destino, texto em encodeURIComponent, em nova aba');
  ok(!/pre[çc]o|pedido|R\$|valor|compr/i.test(esperado) && !/pre[çc]o|pedido|R\$|compr/i.test(await page.textContent('#conteudo')), 'tela e texto sem valores e sem "pedido"');
  await page.evaluate(function () { window.__copiado = ''; });
  await page.click('#conteudo .btn-copiar-lista'); await page.waitForFunction(function () { return !!window.__copiado; });
  igual(await page.evaluate(function () { return window.__copiado; }), esperado, '"Copiar texto" copia o mesmo texto');
  igual(await page.textContent('#toast .toast-txt'), 'Texto da lista copiado', 'toast "Texto da lista copiado"');
  ok(!(await page.$('#conteudo .btn-comp-lista')), 'sem Web Share o botão Compartilhar não aparece (Copiar texto resolve no computador)');
  await capturar(page, '11-minha-lista');
  /* remover com "Desfazer" no toast */
  await page.click('#conteudo .lista-item >> nth=0 >> .item-remover');
  await page.waitForFunction(function () { return /removida da lista/.test(document.getElementById('toast').textContent); });
  var depoisRemover = await page.evaluate(function () { var b = document.querySelector('#toast button.toast-acao'); return { n: document.querySelectorAll('#conteudo .lista-item').length, toast: document.querySelector('#toast .toast-txt').textContent, botao: b && b.textContent, foco: document.activeElement.className, cont: document.querySelector('#conteudo .lista-cont').textContent, ls: JSON.parse(localStorage.getItem('mg-lista')).length }; });
  ok(depoisRemover.n === 1 && depoisRemover.toast === 'MG001 removida da lista' && depoisRemover.botao === 'Desfazer' && depoisRemover.foco === 'item-remover' && depoisRemover.cont === '1 peça · 1 unidade neste aparelho' && depoisRemover.ls === 1, 'remover: sai da lista e do aparelho, toast com "Desfazer", foco no × da peça seguinte');
  await page.click('#toast button.toast-acao');
  await page.waitForFunction(function () { return document.querySelectorAll('#conteudo .lista-item').length === 2; });
  var desfeito = await page.evaluate(function () { var l = JSON.parse(localStorage.getItem('mg-lista')); return { cod: l[0].codigo, qtd: l[0].qtd, primeiro: document.querySelector('#conteudo .lista-item .item-cod').textContent, foco: document.activeElement.getAttribute('aria-label') }; });
  ok(desfeito.cod === 'MG001' && desfeito.qtd === 2 && desfeito.primeiro === 'MG001' && desfeito.foco === 'Remover MG001 da lista', '"Desfazer" devolve MG001 na mesma posição com quantidade 2 e foca o ×');
  /* persistência: recarregar */
  await page.reload(); await page.waitForSelector('#conteudo .lista-item');
  igual(await page.textContent('#conteudo .lista-cont'), '2 peças · 3 unidades neste aparelho', 'lista continua depois de recarregar');
  igual(await page.textContent('.aba[data-aba="lista"] .aba-badge'), '2', 'contador 2 na aba ao abrir o app');
  /* Início: entrada "Minha lista" só com itens, entre o veículo e Recentes */
  await ir(page, '#/', '.secao-lista:not([hidden]) .cartao-lista');
  var inicioLista = await page.evaluate(function () { var s = document.querySelector('#conteudo .secao-lista'), rec = document.querySelector('#conteudo .recentes'); return { h2: s.querySelector('h2').textContent, link: s.querySelector('.secao-cab .link').getAttribute('href'), b: s.querySelector('.cartao-lista b').textContent, href: s.querySelector('.cartao-lista').getAttribute('href'), alt: Math.round(s.querySelector('.cartao-lista').getBoundingClientRect().height), antesRecentes: !rec || s.getBoundingClientRect().top < rec.getBoundingClientRect().top, depoisVeic: s.getBoundingClientRect().top > document.querySelector('#conteudo .cartao-compacto').getBoundingClientRect().top }; });
  ok(inicioLista.h2 === 'Minha lista' && inicioLista.link === '#/lista' && inicioLista.b === '2 peças · 3 unidades' && inicioLista.href === '#/lista' && inicioLista.alt >= 44 && inicioLista.antesRecentes && inicioLista.depoisVeic, 'Início: seção "Minha lista" (2 peças · 3 unidades) depois do veículo e antes de Recentes, abrindo #/lista');
  /* limpar com confirmação em linha */
  await ir(page, '#/lista', '.btn-limpar-lista');
  await page.click('#conteudo .btn-limpar-lista');
  ok(!(await page.evaluate(function () { return document.querySelector('#conteudo .confirmar').hidden; })) && (await page.$$('#conteudo .lista-item')).length === 2, '"Limpar lista" pede confirmação em linha sem apagar');
  await page.click('#conteudo .confirmar .btn-neutro');
  ok(await page.evaluate(function () { return document.querySelector('#conteudo .confirmar').hidden && document.activeElement.classList.contains('btn-limpar-lista'); }), 'Cancelar fecha a confirmação e devolve o foco');
  await page.click('#conteudo .btn-limpar-lista'); await page.click('#conteudo .confirmar .btn-primario');
  await page.waitForSelector('#conteudo .vazio');
  var limpo = await page.evaluate(function () { return { ls: localStorage.getItem('mg-lista'), badge: !!document.querySelector('.aba[data-aba="lista"] .aba-badge'), foco: document.activeElement.textContent }; });
  ok(limpo.ls === '[]' && !limpo.badge && limpo.foco === 'Buscar peça', 'Apagar: lista vazia no aparelho, sem contador na aba, foco em "Buscar peça"');
  await ir(page, '#/', '.secao-busca .entrada');
  ok(await page.evaluate(function () { return document.querySelector('#conteudo .secao-lista').hidden; }), 'Início sem a seção "Minha lista" com a lista vazia');

  console.log('\nImprimir / PDF');
  /* folha limpa (#impressao + body.imprimindo) montada só no toque, window.print() direto; preto no branco, igual nos dois temas, sem valores */
  var detalhesJson = JSON.parse(fs.readFileSync(path.join(APP, 'dados', 'detalhes.json'), 'utf8')).itens;
  var PROIBIDO = /pre[çc]o|R\$|pedido|compr|desconto|oferta|frete|promo|barato|whatsapp|@/i;
  await page.evaluate(function () { localStorage.setItem('mg-lista', JSON.stringify([{ codigo: 'MG001', qtd: 2, adicionadoEm: '2026-11-02T15:00:00.000Z' }, { codigo: 'MG076', qtd: 1, adicionadoEm: '2026-11-02T15:01:00.000Z' }, { codigo: 'MG1903', qtd: 4, adicionadoEm: '2026-11-02T15:02:00.000Z' }])); window.__imprimiu = 0; });
  await ir(page, '#/lista', '.lista-acoes .btn-imprimir');
  var btnImp = await page.evaluate(function () { var b = document.querySelector('#conteudo .lista-acoes .btn-imprimir'), r = b.getBoundingClientRect(); return { h: r.height, w: r.width, txt: b.textContent.trim(), svg: !!b.querySelector('svg'), tipo: b.type, folha: !!document.getElementById('impressao'), irmaos: b.parentNode.querySelectorAll('.btn').length }; });
  ok(btnImp.h >= 44 && btnImp.w >= 44 && btnImp.txt === 'Imprimir / PDF' && btnImp.svg && btnImp.tipo === 'button' && btnImp.irmaos === 3 && !btnImp.folha, 'Minha lista: botão "Imprimir / PDF" com ícone e 44 px junto de WhatsApp/Copiar; sem folha antes do toque');
  function lerFolha() {
    return page.evaluate(function () {
      var s = document.getElementById('impressao'); if (!s) return null;
      function tx(sel) { return Array.prototype.map.call(s.querySelectorAll(sel), function (e) { return e.textContent.trim(); }); }
      return { print: window.__imprimiu, classe: document.body.classList.contains('imprimindo'), titulo: s.querySelector('h1').textContent, data: s.querySelector('.imp-data').textContent, logo: s.querySelector('.imp-logo') && s.querySelector('.imp-logo').getAttribute('src'),
        cab: tx('thead th'), linhas: tx('tbody tr').length, l1: tx('tbody tr:first-child td'), cods: tx('tbody td.imp-cod-col'), qr: !!s.querySelector('.imp-qr svg'), rodape: s.querySelector('.imp-rodape').textContent, link: s.querySelector('.imp-link') ? s.querySelector('.imp-link').textContent : '',
        texto: s.textContent, docTitle: document.title, display: getComputedStyle(s).display, html: s.innerHTML, cod: s.querySelector('.imp-cod') ? s.querySelector('.imp-cod').textContent : '', nome: s.querySelector('.imp-nome') ? s.querySelector('.imp-nome').textContent : '', linha: s.querySelector('.imp-linha') ? s.querySelector('.imp-linha').textContent : '', foto: s.querySelector('.imp-foto') ? s.querySelector('.imp-foto').getAttribute('src') : '', oem: s.querySelector('.imp-oem') ? s.querySelector('.imp-oem').textContent : '' };
    });
  }
  await page.click('#conteudo .lista-acoes .btn-imprimir');
  var folhaL = await lerFolha();
  ok(folhaL && folhaL.print === 1 && folhaL.classe, 'toque chama window.print() uma vez com a folha #impressao montada e body.imprimindo');
  ok(folhaL && folhaL.titulo === 'Lista de peças MG' && folhaL.data === '3 peças · 7 unidades · Impresso em ' + hoje && folhaL.logo === 'icones/logo-mg.png', 'cabeçalho: logo original, "Lista de peças MG", totais e data (' + (folhaL && folhaL.data) + ')');
  ok(folhaL && folhaL.cab.join('|') === 'Qtd|Código|Nome|Linha' && folhaL.linhas === 3 && folhaL.l1.join('|') === '2|MG001|Mangueira do Filtro de Ar|Mangueiras do Filtro de Ar', 'tabela qtd/código/nome/linha com as 3 peças (1ª: 2 · MG001 · Mangueira do Filtro de Ar · Mangueiras do Filtro de Ar)');
  ok(folhaL && folhaL.qr && folhaL.rodape.indexOf('Catálogo MG Peças Automotivas · https://mgpecasautomotivas.github.io/') >= 0, 'rodapé com "Catálogo MG Peças Automotivas · link" e QR code (qr.js)');
  ok(folhaL && !PROIBIDO.test(folhaL.texto), 'folha sem valores, sem "pedido", sem palavras de venda e sem contato');
  ok(folhaL && folhaL.docTitle === 'Lista de peças MG · MG Peças' && folhaL.display === 'none', 'título do documento vira o nome do PDF; na tela a folha fica invisível');
  await page.emulateMedia({ media: 'print' });
  function lerImpressao() {
    return page.evaluate(function () { var s = document.getElementById('impressao'), cs = getComputedStyle(s); return { d: cs.display, cor: cs.color, fundo: cs.backgroundColor, body: getComputedStyle(document.body).backgroundColor, abas: getComputedStyle(document.querySelector('.abas')).display, topo: getComputedStyle(document.querySelector('.topo')).display, conteudo: getComputedStyle(document.getElementById('conteudo')).display, toast: getComputedStyle(document.getElementById('toast')).display, faixa: getComputedStyle(document.getElementById('faixa-instalar')).display, fonte: cs.fontFamily, thead: getComputedStyle(s.querySelector('thead')).display, tr: getComputedStyle(s.querySelector('tbody tr')).breakInside, h1: getComputedStyle(s.querySelector('h1')).color }; });
  }
  var impL = await lerImpressao();
  ok(impL.d === 'block' && impL.cor === 'rgb(0, 0, 0)' && impL.fundo === 'rgb(255, 255, 255)' && impL.body === 'rgb(255, 255, 255)' && impL.h1 === 'rgb(0, 0, 0)', 'na impressão a folha aparece em preto no branco');
  ok(impL.abas === 'none' && impL.topo === 'none' && impL.conteudo === 'none' && impL.toast === 'none' && impL.faixa === 'none', 'na impressão somem topo, abas, conteúdo da tela, toast e faixa de instalar');
  ok(/system-ui/.test(impL.fonte) && impL.thead === 'table-header-group' && impL.tr === 'avoid', 'fontes do sistema, thead repetido a cada página e linhas sem cortar (break-inside: avoid)');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(function () { window.dispatchEvent(new Event('afterprint')); });
  ok(await page.evaluate(function () { return !document.getElementById('impressao') && !document.body.classList.contains('imprimindo') && document.title === 'Minha lista · MG Peças'; }), 'afterprint tira a folha e a classe e devolve o título da tela');
  /* tema escuro: a folha sai igual (mesmo HTML, mesmas cores na impressão) */
  await page.emulateMedia({ colorScheme: 'dark' });
  await ir(page, '#/', '.secao-busca .entrada'); await ir(page, '#/lista', '.lista-acoes .btn-imprimir');
  await page.click('#conteudo .lista-acoes .btn-imprimir');
  var folhaE = await lerFolha();
  await page.emulateMedia({ media: 'print' }); var impE = await lerImpressao(); await page.emulateMedia({ media: 'screen' });
  ok(folhaE && folhaE.html === folhaL.html && impE.cor === impL.cor && impE.fundo === impL.fundo && impE.body === impL.body, 'tema escuro: a folha tem o mesmo HTML e sai em preto no branco do mesmo jeito');
  await page.emulateMedia({ colorScheme: 'light' });
  /* trocar de tela tira a folha (se a caixa de impressão não avisou afterprint) */
  await ir(page, '#/peca/MG001', '.acoes-peca .btn-imprimir');
  ok(await page.evaluate(function () { return !document.getElementById('impressao') && !document.body.classList.contains('imprimindo'); }), 'trocar de tela tira a folha pendente');
  /* ficha: 4 botões de 44 px, 2 por linha em 390 */
  var acoes4 = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('#conteudo .acoes-peca .btn'), function (b) { var r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), b.textContent.trim()]; }); });
  ok(acoes4.length === 4 && acoes4.every(function (a) { return a[1] >= 44; }) && acoes4[0][0] === acoes4[1][0] && acoes4[2][0] === acoes4[3][0] && acoes4[2][0] > acoes4[0][0] && acoes4[3][2] === 'Imprimir / PDF', 'ficha: Salvar peça, Compartilhar, Adicionar à lista e Imprimir / PDF com 44 px, 2 por linha (' + JSON.stringify(acoes4) + ')');
  await page.waitForFunction(function () { return !!document.querySelector('#conteudo .detalhe-foto .foto.ok img'); });
  await page.evaluate(function () { window.__imprimiu = 0; });
  await page.click('#conteudo .acoes-peca .btn-imprimir');
  var folhaF = await lerFolha(), dMG001 = detalhesJson.MG001;
  ok(folhaF && folhaF.print === 1 && folhaF.titulo === 'Ficha da peça MG001' && folhaF.data === 'Mangueira do Filtro de Ar · Impresso em ' + hoje && folhaF.cod === 'MG001' && folhaF.nome === 'Mangueira do Filtro de Ar', 'ficha: folha "Ficha da peça MG001" com código, nome e data');
  ok(folhaF && folhaF.linha === 'Linha: Mangueiras do Filtro de Ar · ' + dMG001.m.join(', ') && /^http/.test(folhaF.foto), 'ficha: linha, montadoras e a foto já carregada (' + folhaF.linha + ')');
  ok(folhaF && folhaF.cab.join('|') === 'Veículo|Motor|Anos' && folhaF.linhas === dMG001.a.length && folhaF.l1.join('|') === dMG001.a[0].join('|'), 'ficha: tabela de aplicação completa (' + dMG001.a.length + ' linhas, 1ª ' + dMG001.a[0].join(' · ') + ')');
  ok(folhaF && folhaF.oem === dMG001.o.join('   ') && folhaF.link === 'https://mgpecasautomotivas.github.io/p/MG001.html' && folhaF.qr, 'ficha: números originais, link da prévia p/MG001.html e QR code');
  ok(folhaF && !PROIBIDO.test(folhaF.texto) && folhaF.docTitle === 'Ficha da peça MG001 · MG Peças', 'ficha: folha sem valores nem contato; nome do PDF "Ficha da peça MG001"');
  /* veículo: botão ao lado da ordem (só o ícone no celular), todas as peças na ordem da tela, filtro e ordem respeitados */
  await ir(page, '#/veiculo/Volkswagen/Gol/2010?motor=1.6', '.res-barra .btn-imprimir');
  var btnV = await page.evaluate(function () { var b = document.querySelector('#conteudo .res-barra .btn-imprimir'), r = b.getBoundingClientRect(), s = document.querySelector('#conteudo .res-barra .select-mini').getBoundingClientRect(); return { w: r.width, h: r.height, label: b.getAttribute('aria-label'), txt: getComputedStyle(b.querySelector('.btn-imprimir-txt')).display, mesmaLinha: Math.abs(r.top - s.top) < 4 && r.left > s.right, total: +document.querySelector('#conteudo .res-cont b').textContent, cods: Array.prototype.map.call(document.querySelectorAll('#conteudo .painel-res .item-cod'), function (e) { return e.textContent; }) }; });
  ok(btnV.w >= 44 && btnV.h >= 44 && btnV.label === 'Imprimir / PDF' && btnV.txt === 'none' && btnV.mesmaLinha, 'veículo: botão de 44 px só com o ícone (nome acessível "Imprimir / PDF") ao lado da ordem');
  await page.evaluate(function () { window.__imprimiu = 0; });
  await page.click('#conteudo .res-barra .btn-imprimir');
  var folhaV = await lerFolha();
  ok(folhaV && folhaV.print === 1 && folhaV.titulo === 'Peças MG para Volkswagen Gol 2010 1.6' && folhaV.data === btnV.total + ' peças · Impresso em ' + hoje && folhaV.cab.join('|') === 'Código|Nome|Linha|Aplicação', 'veículo: folha "Peças MG para Volkswagen Gol 2010 1.6" com ' + btnV.total + ' peças e colunas código/nome/linha/aplicação');
  ok(folhaV && folhaV.linhas === btnV.total && btnV.total > 30 && folhaV.cods.join(',') === btnV.cods.join(','), 'veículo: todas as ' + btnV.total + ' peças (não só a 1ª página), na ordem da tela');
  ok(folhaV && folhaV.l1[2] === 'Mangueiras do Filtro de Ar' && /\d{4}/.test(folhaV.l1[3]) && folhaV.qr && folhaV.link === 'https://mgpecasautomotivas.github.io/#/veiculo/Volkswagen/Gol/2010?motor=1.6' && !PROIBIDO.test(folhaV.texto), 'veículo: linha e aplicação (motor/anos) por peça, QR com o link desta busca, sem valores');
  await page.click('#conteudo .filtro-linhas .chip >> nth=1'); /* Mangueiras do Filtro de Ar */
  await page.selectOption('#conteudo .res-barra .select-mini', 'codigo');
  var telaVF = await page.evaluate(function () { return { total: +document.querySelector('#conteudo .res-cont b').textContent, cods: Array.prototype.map.call(document.querySelectorAll('#conteudo .painel-res .item-cod'), function (e) { return e.textContent; }), folha: !!document.getElementById('impressao') }; });
  await page.click('#conteudo .res-barra .btn-imprimir');
  var folhaVF = await lerFolha();
  ok(folhaVF && folhaVF.titulo === 'Peças MG para Volkswagen Gol 2010 1.6 · Mangueiras do Filtro de Ar' && folhaVF.linhas === telaVF.total && folhaVF.cods.join(',') === telaVF.cods.join(',') && folhaVF.link === 'https://mgpecasautomotivas.github.io/#/veiculo/Volkswagen/Gol/2010?motor=1.6&linha=filtro-ar', 'veículo filtrado por linha e em ordem de código: título com a linha, ' + telaVF.total + ' peças na ordem da tela, link com ?linha=');
  await page.selectOption('#conteudo .res-barra .select-mini', 'relevancia');
  /* Ctrl+P (menu Imprimir do navegador): beforeprint monta a folha da tela, afterprint tira */
  await page.evaluate(function () { window.dispatchEvent(new Event('beforeprint')); });
  var ctrlP = await page.evaluate(function () { return !!document.getElementById('impressao') && document.body.classList.contains('imprimindo'); });
  await page.evaluate(function () { window.dispatchEvent(new Event('afterprint')); });
  ok(ctrlP && await page.evaluate(function () { return !document.getElementById('impressao') && !document.body.classList.contains('imprimindo'); }), 'Ctrl+P: beforeprint monta a folha da tela e afterprint tira');
  await page.evaluate(function () { localStorage.removeItem('mg-lista'); });

  console.log('\nLinhas, Instalar, Sobre');
  await ir(page, '#/linhas', '.grade-linhas .linha-card');
  await page.waitForFunction(function () { return !/…/.test(document.querySelector('#conteudo .grade-linhas .cont').textContent); });
  ok((await page.$$('#conteudo .linha-card:not([hidden])')).length >= 13, 'tela Linhas com as linhas de produtos');
  await page.waitForFunction(function () { return document.querySelectorAll('#conteudo .linha-foto.ok img').length >= 13; }, null, { timeout: 10000 });
  ok(true, 'tela Linhas com a foto da peça típica em cada cartão');
  await ir(page, '#/linha/filtro-ar', '.lista .item-cod');
  ok((await page.$$('#conteudo .lista li')).length > 0, 'linha Mangueiras do Filtro de Ar lista peças');
  await ir(page, '#/instalar', '.qr-caixa svg');
  ok(await page.$('#conteudo .qr-caixa svg path'), 'QR code gerado na tela Instalar');
  igual(await page.textContent('#conteudo .qr-url'), 'https://mgpecasautomotivas.github.io/', 'endereço do app no QR');
  await capturar(page, '05-instalar');
  await ir(page, '#/sobre', '.versao b');
  igual(await page.textContent('#conteudo .versao b'), versao, 'Sobre mostra a versão do config.js');
  await page.waitForFunction(function () { return /atualizados em \d/.test(document.querySelector('#conteudo .dados-info').textContent); });
  ok(true, 'datas dos dados no Sobre');
  /* logo do topo e do Sobre com width/height (proporção conhecida antes de carregar, sem pulo) e desenhado na proporção original */
  function medirLogos() { return page.$$eval('.topo-logo, .sobre-logo', function (ls) { return ls.map(function (i) { var r = i.getBoundingClientRect(), cs = getComputedStyle(i), w = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom); return { attr: i.getAttribute('width') + 'x' + i.getAttribute('height'), prop: w / h, natural: i.naturalWidth / i.naturalHeight }; }); }); }
  var logos = await medirLogos(); /* Sobre: .sobre-logo (o topo mostra o botão Voltar) */
  await ir(page, '#/', '.secao-busca .entrada'); logos = logos.concat(await medirLogos()); /* Início: .topo-logo */
  ok(logos.length === 2 && logos.every(function (l) { return /^\d+x\d+$/.test(l.attr) && Math.abs(l.prop - l.natural) < 0.05; }), 'logo do topo e do Sobre com width/height e na proporção original (' + logos.map(function (l) { return l.attr + ' → ' + l.prop.toFixed(2); }).join(', ') + ')');

  console.log('\nEndereços');
  await page.evaluate(function () { location.hash = '#/nao-existe'; });
  await page.waitForFunction(function () { return location.hash === '#/' && !document.getElementById('toast').hidden; });
  igual(await page.textContent('#toast .toast-txt'), 'Endereço não encontrado', 'rota desconhecida: toast e volta ao Início');
  await ir(page, '#/busca?q=%E0%ZZ', '.cartao .busca-linha .entrada');
  ok(true, 'parâmetro mal codificado não derruba a tela');
  await page.goBack(); await page.waitForFunction(function () { return location.hash === '#/'; });
  await page.waitForSelector('#conteudo .secao-busca .entrada');
  ok(true, 'botão voltar do navegador troca a tela');

  console.log('\nToast "App atualizado"');
  function toastAtualizado() { var t = document.getElementById('toast'); return !t.hidden && /App atualizado/.test(t.textContent); }
  await page.evaluate(function () { sessionStorage.setItem('mg-atualizou', '2026.11.02-0'); });
  await page.reload(); await page.waitForSelector('.secao-busca .entrada');
  await page.waitForFunction(toastAtualizado, null, { timeout: 5000 });
  igual(await page.textContent('#toast .toast-txt'), 'App atualizado · versão ' + versao, 'toast depois do Atualizar (versão anterior guardada na sessão)');
  igual(await page.evaluate(function () { return sessionStorage.getItem('mg-atualizou'); }), null, 'marca da sessão apagada ao mostrar o toast');
  await page.reload(); await page.waitForSelector('.secao-busca .entrada'); await page.waitForTimeout(400);
  ok(!(await page.evaluate(toastAtualizado)), 'toast não repete na abertura seguinte');
  await page.evaluate(function (v) { sessionStorage.setItem('mg-atualizou', v); }, versao);
  await page.reload(); await page.waitForSelector('.secao-busca .entrada'); await page.waitForTimeout(400);
  ok(!(await page.evaluate(toastAtualizado)), 'sem toast quando a versão não mudou');

  console.log('\nBusca pelo veículo já na linha da peça (link da ficha)');
  await ir(page, '#/busca?linha=filtro-ar', '.seletor');
  ok(/Mangueiras do Filtro de Ar/.test(await page.textContent('#conteudo .ajuda-linha')), 'aviso da linha acima do seletor');
  await page.waitForSelector('#conteudo .seletor select:not([disabled])');
  await page.selectOption('#conteudo .seletor select >> nth=0', 'Fiat');
  await page.waitForFunction(function () { return !document.querySelectorAll('#conteudo .seletor select')[1].disabled; });
  await page.selectOption('#conteudo .seletor select >> nth=1', 'Palio');
  await page.click('#conteudo .seletor .btn-primario');
  await page.waitForSelector('#conteudo .painel-res[data-filtro="filtro-ar"]', { timeout: 15000 });
  var hashLinha = await page.evaluate(function () { return location.hash; });
  ok(/linha=filtro-ar/.test(hashLinha), 'resultados do Palio abrem na linha da peça (' + hashLinha + ')');
  ok((await page.textContent('#conteudo .res-cont')).indexOf(' de ') > 0, 'contagem "N de total" com "Todas" a um toque');

  console.log('\nLargura 360');
  var p360 = await ctx.newPage(); colher(p360, erros); await p360.setViewportSize({ width: 360, height: 740 });
  await page.evaluate(function () { localStorage.setItem('mg-lista', JSON.stringify([{ codigo: 'MG001', qtd: 2, adicionadoEm: '2026-11-02T15:00:00.000Z' }, { codigo: 'MG076', qtd: 1, adicionadoEm: '2026-11-02T15:01:00.000Z' }])); }); /* lista com itens para as telas 360 e paisagem */
  var telas = [['#/', '.secao-busca .entrada'], ['#/busca?q=mangueira%20gol', '.painel-res .res-cont b'], ['#/veiculo/Volkswagen/Gol/2010?motor=1.6', '.painel-res .res-cont b'], ['#/peca/MG001', 'table.tabela'], ['#/lista', '.lista-item'], ['#/instalar', '.qr-caixa svg'], ['#/sobre', '.versao b']];
  await p360.goto(base + '#/'); await p360.waitForSelector('.secao-busca .entrada');
  for (var k = 0; k < telas.length; k++) {
    if (k) await ir(p360, telas[k][0], telas[k][1]);
    var larg = await p360.evaluate(function () { return [document.documentElement.scrollWidth, document.documentElement.clientWidth]; });
    ok(larg[0] <= larg[1], 'sem rolagem horizontal em ' + telas[k][0] + ' (' + larg.join('/') + ')');
    if (k === 0) await capturar(p360, '06-inicio-360');
  }

  console.log('\nPaisagem 844x390');
  await p360.setViewportSize({ width: 844, height: 390 });
  await ir(p360, '#/peca/MG001', 'table.tabela');
  var topoP = await p360.evaluate(function () {
    var t = document.querySelector('.topo').getBoundingClientRect(), h = document.querySelector('.topo-titulo').getBoundingClientRect(), s = document.querySelector('.topo-sub').getBoundingClientRect();
    return [Math.round(t.height), Math.round(h.height), Math.round(s.top - h.top), Math.round(document.querySelector('.aba').getBoundingClientRect().height)];
  });
  ok(topoP[0] <= 52 && topoP[1] <= 30 && topoP[2] <= 6, 'topo com 52px e título + subtítulo em uma linha (topo/título/desloc.: ' + topoP.join('/') + ')');
  igual(topoP[3], 48, 'abas em 48px na paisagem');
  var largP = await p360.evaluate(function () { return [document.documentElement.scrollWidth, document.documentElement.clientWidth]; });
  ok(largP[0] <= largP[1], 'sem rolagem horizontal na paisagem');
  /* ficha deitada: foto à esquerda e código/nome/ações à direita, com o código à vista sem rolar */
  await p360.evaluate(function () { window.scrollTo(0, 0); });
  var ladoP = await p360.evaluate(function () { var f = document.querySelector('#conteudo .detalhe-foto').getBoundingClientRect(), c = document.querySelector('#conteudo .detalhe-cod').getBoundingClientRect(), a = document.querySelector('#conteudo .acoes-peca').getBoundingClientRect(); return [Math.round(f.right), Math.round(c.left), Math.round(c.top), Math.round(f.bottom), Math.round(a.left), Math.round(f.height)]; });
  ok(ladoP[1] > ladoP[0] && ladoP[2] < ladoP[3] && ladoP[4] > ladoP[0], 'ficha deitada com foto à esquerda e código, nome e ações à direita (foto até x=' + ladoP[0] + ', código em x=' + ladoP[1] + ')');
  ok(ladoP[2] >= 0 && ladoP[2] < 390 && ladoP[5] <= 200, 'código à vista sem rolar e foto com até 200 px de altura (' + ladoP[5] + ' px)');
  await capturar(p360, '08-paisagem-ficha');
  await ir(p360, '#/lista', '.lista-item');
  var ladoLista = await p360.evaluate(function () { var li = document.querySelector('#conteudo .lista-item'), a = li.querySelector('.item').getBoundingClientRect(), q = li.querySelector('.lista-qtd').getBoundingClientRect(), x = li.querySelector('.item-remover').getBoundingClientRect(); return [Math.round(a.right), Math.round(q.left), Math.round(q.right), Math.round(x.left), document.documentElement.scrollWidth <= document.documentElement.clientWidth]; });
  ok(ladoLista[1] >= ladoLista[0] && ladoLista[3] >= ladoLista[2] && ladoLista[4], 'paisagem: cartão da lista em uma linha (peça · quantidade · ×) sem rolagem horizontal');
  await ir(p360, '#/veiculo/Volkswagen/Gol/2010?motor=1.6', '.res-barra .btn-imprimir');
  var btnV844 = await p360.evaluate(function () { var b = document.querySelector('#conteudo .res-barra .btn-imprimir'); return [getComputedStyle(b.querySelector('.btn-imprimir-txt')).display, Math.round(b.getBoundingClientRect().height), b.textContent.trim()]; });
  ok(btnV844[0] !== 'none' && btnV844[1] >= 44 && btnV844[2] === 'Imprimir / PDF', 'a partir de 560 px o botão do veículo mostra "Imprimir / PDF" por extenso (' + btnV844.join(' / ') + ')');
  await ir(p360, '#/peca/MG001', 'table.tabela');
  await p360.emulateMedia({ colorScheme: 'dark' }); await capturar(p360, '09-paisagem-ficha-escuro'); await p360.emulateMedia({ colorScheme: 'light' });
  await p360.setViewportSize({ width: 390, height: 844 });
  await ir(p360, '#/peca/MG046', 'table.tabela');
  var emPe = await p360.evaluate(function () { var f = document.querySelector('#conteudo .detalhe-foto').getBoundingClientRect(), c = document.querySelector('#conteudo .detalhe-cod').getBoundingClientRect(); return [Math.round(f.bottom), Math.round(c.top)]; });
  ok(emPe[1] >= emPe[0] + 12, 'em pé a foto continua acima do código (' + emPe.join(' → ') + ')');
  await p360.evaluate(function () { localStorage.removeItem('mg-lista'); });
  await ctx.close();

  /* ---------- service worker: registro, cache e uso offline ---------- */
  console.log('\nService worker');
  var ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR' });
  var pg = await ctx2.newPage(), erros2 = []; colher(pg, erros2);
  await pg.goto(base + '#/'); await pg.waitForSelector('.secao-busca .entrada');
  var swOk = await pg.evaluate(function () { return navigator.serviceWorker.ready.then(function (r) { return !!r.active; }); });
  ok(swOk, 'service worker registrado e ativo');
  igual(await pg.evaluate(function () { return navigator.serviceWorker.getRegistration().then(function (r) { return r.scope; }); }), base, 'service worker com escopo na raiz');
  var cdp = await ctx2.newCDPSession(pg), instErros = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors;
  ok(!instErros.length, 'Chrome não aponta erro de instalabilidade (manifesto, ícones, service worker)' + (instErros.length ? ': ' + JSON.stringify(instErros) : ''));
  await cdp.detach();
  await pg.reload(); await pg.waitForSelector('.secao-busca .entrada');
  ok(await pg.evaluate(function () { return !!navigator.serviceWorker.controller; }), 'página controlada pelo service worker');
  await ir(pg, '#/peca/MG001', 'table.tabela tbody tr'); /* detalhes.json pedido pela ficha e guardado pelo SW */
  var cacheOk = await pg.evaluate(function (v) {
    var fim = Date.now() + 40000;
    function tenta() {
      return caches.open('mg-dados-' + v).then(function (c) { return Promise.all([c.match('dados/detalhes.json'), c.match('dados/indice.json'), c.match('dados/produtos.json')]); })
        .then(function (r) { if (r.every(Boolean)) return true; if (Date.now() > fim) return false; return new Promise(function (ok) { setTimeout(ok, 300); }).then(tenta); });
    }
    return tenta();
  }, versao);
  ok(cacheOk, 'índice, produtos e detalhes no cache mg-dados-' + versao);
  var caches2 = await pg.evaluate(function () { return caches.keys(); });
  ok(caches2.indexOf('mg-casca-' + versao) >= 0, 'cache da casca mg-casca-' + versao + ' (' + caches2.join(', ') + ')');
  ok(!(await pg.evaluate(function (v) { return caches.open('mg-casca-' + v).then(function (c) { return c.keys(); }).then(function (ks) { return ks.some(function (k) { return /\/teste\//.test(k.url); }); }); }, versao)), 'nada de teste/ no cache');
  await srv.derrubar(); /* "offline" de verdade: o servidor some */
  await pg.goto(base + '#/'); await pg.waitForSelector('.secao-busca .entrada', { timeout: 15000 });
  ok(true, 'Início abre offline (casca do cache)');
  await pg.waitForFunction(function () { return !/…/.test(document.querySelector('.grade-linhas .cont').textContent); });
  await ir(pg, '#/peca/MG001', 'table.tabela tbody tr');
  igual(await pg.textContent('#conteudo .detalhe-cod'), 'MG001', 'ficha MG001 abre offline com a aplicação');
  /* aviso "Sem conexão" (navigator.onLine): aparece ao cair a rede, com a data da última carga, e some ao voltar */
  ok(await pg.evaluate(function () { return document.getElementById('aviso-offline').hidden; }), 'aviso de sem conexão escondido com rede');
  await ctx2.setOffline(true);
  await pg.waitForFunction(function () { return !document.getElementById('aviso-offline').hidden; }, null, { timeout: 5000 });
  ok(/^Sem conexão · dados guardados em \d\d\/\d\d\/\d{4}$/.test(await pg.textContent('#aviso-offline')), 'aviso "Sem conexão · dados guardados em <data>" (' + (await pg.textContent('#aviso-offline')) + ')');
  if (capturas) await capturar(pg, '07-offline');
  await ctx2.setOffline(false);
  await pg.waitForFunction(function () { return document.getElementById('aviso-offline').hidden; }, null, { timeout: 5000 });
  ok(true, 'aviso some ao voltar a conexão');
  await ctx2.close();
  await browser.close();

  console.log('\nConsole');
  ok(!erros.length, 'sem erros de console nas telas' + (erros.length ? ':\n    ' + erros.join('\n    ') : ''));
  ok(!erros2.length, 'sem erros de console com o service worker' + (erros2.length ? ':\n    ' + erros2.join('\n    ') : ''));

  console.log('\n' + (passos - falhas.length) + '/' + passos + ' verificações em ' + Math.round((Date.now() - t0) / 1000) + ' s' + (capturas ? ' · capturas em ' + capturas : ''));
  if (falhas.length) { console.log('FALHOU: ' + falhas.join(' | ')); process.exit(1); }
})().catch(function (e) { console.error('ERRO: ' + (e && e.stack || e)); process.exit(1); });

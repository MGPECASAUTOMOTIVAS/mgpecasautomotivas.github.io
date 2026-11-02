/* Service worker — MG Peças Automotivas (catálogo PWA)
   - Pré-cache enxuto na instalação: casca do app + indice, produtos e imagens (o que a 1ª tela precisa).
     detalhes.json e marcas/*.json entram no cache quando o app pede ({tipo:'aquecer'}, depois do idle) ou quando
     são usados; assim o 1º carregamento baixa menos e o uso offline continua completo logo depois.
   - Os endereços dos dados vêm de config.js (MG_CONFIG.dadosBase / detalhesUrl), os mesmos que o app lê.
   - dados: cache primeiro, atualiza em segundo plano (stale-while-revalidate).
   - Fotos (CDN da loja) e fontes: cache primeiro, com limite de itens.
   - O pré-cache revalida no servidor (cache: 'no-cache'): uma versão nova nunca guarda arquivo velho, mas o que a
     página acabou de baixar volta como 304 (sem baixar duas vezes).
   Ao publicar uma versão nova, mude VERSAO. */
importScripts('config.js');
var CFG = self.MG_CONFIG || {};
var VERSAO = '2026.11.02-25';
var CACHE_CASCA = 'mg-casca-' + VERSAO;
var CACHE_DADOS = 'mg-dados-' + VERSAO;
var CACHE_FOTOS = 'mg-fotos-v1';
var CACHE_FONTES = 'mg-fontes-v1';
var LIMITE_FOTOS = 400;

var CASCA = [
  './', 'index.html', 'config.js', 'app.css', 'app.js', 'qr.js', 'manifest.webmanifest',
  'icones/icone-192.png', 'icones/icone-maskable-192.png', 'icones/apple-touch-icon.png', 'icones/favicon-32.png', 'icones/logo-mg.png'
];
var BASE = CFG.dadosBase || 'dados/';
var DADOS = [BASE + 'indice.json', BASE + 'produtos.json', BASE + 'imagens.json'];
var DETALHES = CFG.detalhesUrl || 'dados/detalhes.json';

function sa(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function slug(s) { return sa(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function semCacheHttp(u) { return new Request(u, { cache: 'no-cache' }); }

self.addEventListener('install', function (e) {
  e.waitUntil(
    Promise.all([
      /* './' e 'index.html' são o mesmo arquivo: baixa uma vez e guarda nas duas chaves (a navegação offline procura as duas) */
      caches.open(CACHE_CASCA).then(function (c) {
        return c.addAll(CASCA.filter(function (a) { return a !== './'; }).map(semCacheHttp)).then(function () { return c.match('index.html'); }).then(function (r) { if (r) return c.put('./', r); });
      }),
      caches.open(CACHE_DADOS).then(function (c) {
        return Promise.all(DADOS.map(function (u) { return c.add(semCacheHttp(u)).catch(function () {}); }));
      })
    ])
  );
});
/* guarda detalhes.json e uma tabela por marca (marcas/<slug>.json) para o uso offline; um por vez, só o que falta */
function aquecer() {
  return caches.open(CACHE_DADOS).then(function (c) {
    function garantir(u) { return c.match(u).then(function (hit) { if (hit) return; return c.add(semCacheHttp(u)).catch(function () {}); }); }
    return garantir(DETALHES).then(function () {
      return c.match(BASE + 'indice.json').then(function (r) { return r ? r.json() : fetch(semCacheHttp(BASE + 'indice.json')).then(function (x) { return x.json(); }); });
    }).then(function (ix) {
      var marcas = Object.keys((ix && ix.marcas) || {});
      return marcas.reduce(function (p, m) { return p.then(function () { return garantir(BASE + 'marcas/' + slug(m) + '.json'); }); }, Promise.resolve());
    }).catch(function () {});
  });
}
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) {
      if (k.indexOf('mg-') === 0 && [CACHE_CASCA, CACHE_DADOS, CACHE_FOTOS, CACHE_FONTES].indexOf(k) < 0) return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (e) {
  if (!e.data) return;
  if (e.data.tipo === 'pular') self.skipWaiting();
  if (e.data.tipo === 'aquecer') { var p = aquecer(); if (e.waitUntil) e.waitUntil(p); }
});

function limitar(nome, max) {
  return caches.open(nome).then(function (c) {
    return c.keys().then(function (ks) { if (ks.length <= max) return; return Promise.all(ks.slice(0, ks.length - max).map(function (k) { return c.delete(k); })); });
  });
}
function cachePrimeiro(req, nome, limite) {
  return caches.open(nome).then(function (c) {
    return c.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) {
        if (r && (r.ok || r.type === 'opaque')) { c.put(req, r.clone()); if (limite) limitar(nome, limite); }
        return r;
      });
    });
  });
}
function cacheDepoisRede(req, nome) {
  return caches.open(nome).then(function (c) {
    return c.match(req).then(function (hit) {
      var rede = fetch(req).then(function (r) { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(function () { return hit || Response.error(); }); /* sem cache e sem rede: erro de rede normal, não "resposta indefinida" */
      return hit || rede;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; /* consulta de placa (POST) vai direto à rede */
  var url = new URL(req.url);

  /* páginas de prévia p/<código>.html (só porta de entrada do link compartilhado): só rede, nunca entram no cache;
     offline, vai direto para a ficha no app */
  var previa = /\/p\/([^\/]+)\.html$/.exec(url.pathname);
  if (previa && url.origin === location.origin) {
    e.respondWith(fetch(req).catch(function () { return Response.redirect(new URL('../#/peca/' + previa[1], req.url).href, 302); }));
    return;
  }
  /* script de teste (teste/): só rede, nunca entra no cache */
  if (url.origin === location.origin && /\/teste\//.test(url.pathname)) return;
  /* navegação: rede primeiro, casca do cache se estiver offline. Só a casca (…/app/ ou index.html) é guardada como
     index.html: outra página do escopo (LEIA-ME.md, p/) nunca toma o lugar dela */
  if (req.mode === 'navigate') {
    var ehCasca = /(\/|\/index\.html)$/.test(url.pathname);
    /* clone() antes de devolver a resposta: depois que a página começa a ler o corpo, clonar lança "body is already used" */
    e.respondWith(fetch(req).then(function (r) { if (r.ok && ehCasca) { var copia = r.clone(); caches.open(CACHE_CASCA).then(function (c) { return c.put('index.html', copia); }).catch(function () {}); } return r; })
      .catch(function () { return caches.match('index.html').then(function (h) { return h || caches.match('./'); }); }));
    return;
  }
  /* fotos da loja */
  if (/mitiendanube\.com|nuvemshop|tiendanube/.test(url.hostname)) { e.respondWith(cachePrimeiro(req, CACHE_FOTOS, LIMITE_FOTOS)); return; }
  /* fontes */
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) { e.respondWith(cachePrimeiro(req, CACHE_FONTES, 40)); return; }
  /* dados do catálogo (locais ou no jsDelivr) */
  if (/\.json$/.test(url.pathname)) { e.respondWith(cacheDepoisRede(req, CACHE_DADOS)); return; }
  /* casca */
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req).then(function (r) { if (r.ok) { var copia = r.clone(); caches.open(CACHE_CASCA).then(function (c) { return c.put(req, copia); }).catch(function () {}); } return r; }); }));
  }
});

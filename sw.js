/* Service worker — MG Peças Automotivas (catálogo PWA)
   - Pré-cache enxuto na instalação: casca do app + indice, produtos e imagens (o que a 1ª tela precisa).
     detalhes.json e marcas/*.json entram no cache quando o app pede ({tipo:'aquecer'}, depois do idle) ou quando
     são usados; assim o 1º carregamento baixa menos e o uso offline continua completo logo depois.
   - Os endereços dos dados vêm de config.js (MG_CONFIG.dadosBase / detalhesUrl), os mesmos que o app lê.
   - dados locais (dados/, mesma origem): cache desta versão primeiro (mudam junto com a versão). O que falta no cache vem
     do servidor sem o cache HTTP do navegador e só entra se o servidor ainda está nesta versão (VERSAO); com versão
     nova publicada, a página recebe 409 e pede o "Atualizar" (nada de juntar arquivos de duas publicações; detalhes.json,
     que vai pelo código da peça e não por posição, vale de qualquer publicação). O app pede os
     dados com ?v=<versão> (sem SW, o cache HTTP fica separado por versão); aqui a chave é o endereço sem o ?v=.
     Dados de fora (jsDelivr): cache primeiro, atualiza em segundo plano (stale-while-revalidate).
   - Fotos (CDN da loja) e fontes: cache primeiro, com limite de itens.
   - O pré-cache revalida no servidor (cache: 'no-cache'): uma versão nova nunca guarda arquivo velho, mas o que a
     página acabou de baixar volta como 304 (sem baixar duas vezes).
   - A casca (index.html, app.js, app.css, config.js…) sai sempre do cache desta versão, inclusive a navegação: a tela
     nunca junta o index.html de uma versão com o app.js de outra, abre sem esperar a rede e, com versão nova publicada,
     a troca é toda de uma vez pelo "Atualizar" (ou na abertura seguinte, quando o SW novo assume).
   Ao publicar uma versão nova, mude VERSAO. */
importScripts('config.js');
var CFG = self.MG_CONFIG || {};
var VERSAO = '2026.11.02-35';
var CACHE_CASCA = 'mg-casca-' + VERSAO;
var CACHE_DADOS = 'mg-dados-' + VERSAO;
var CACHE_FOTOS = 'mg-fotos-v1';
var CACHE_FONTES = 'mg-fontes-v1';
var LIMITE_FOTOS = 400;

var CASCA = [
  './', 'index.html', 'config.js', 'app.css', 'app.js', 'qr.js', 'manifest.webmanifest',
  'icones/icone-192.png', 'icones/logo-mg.png'
];
/* ícones que só o sistema usa (instalação e aba do navegador): entram no cache junto com o aquecimento, depois da
   1ª tela, em vez de disputar a rede com as fotos e os dados na 1ª visita (45 KB) */
var CASCA_DEPOIS = ['icones/icone-maskable-192.png', 'icones/apple-touch-icon.png', 'icones/favicon-32.png'];
var BASE = CFG.dadosBase || 'dados/';
var DADOS = [BASE + 'indice.json', BASE + 'produtos.json', BASE + 'imagens.json'];
var DETALHES = CFG.detalhesUrl || 'dados/detalhes.json';

function sa(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function slug(s) { return sa(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function porCodigo(u) { return new URL(u, self.location.href).pathname === new URL(DETALHES, self.location.href).pathname; }
function semCacheHttp(u) { return new Request(u, { cache: 'no-cache' }); }
function externo(u) { return /^(https?:)?\/\//.test(u); }
/* arquivo de dados local como o app pede, com ?v=<versão>: o pré-cache e o aquecimento revalidam no servidor o mesmo endereço
   que a página já baixou (304, sem baixar duas vezes) */
function comVersao(u) { return externo(u) ? u : u + (u.indexOf('?') < 0 ? '?' : '&') + 'v=' + encodeURIComponent(VERSAO); }
/* versão publicada agora no servidor: a VERSAO do sw.js de lá (revalidado: 304 quando não mudou). É o próprio sw.js, e
   não o config.js, porque o config.js importado aqui pode ter vindo do cache HTTP numa atualização */
function versaoNoServidor() {
  return fetch(new Request('sw.js?versao', { cache: 'no-cache' })).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (t) { var m = /var VERSAO = '([^']+)'/.exec(t); return m ? m[1] : null; });
}
/* arquivo de dados local que falta no cache desta versão: vem do servidor sem o cache HTTP do navegador (que guarda por até
   10 min a cópia de outra publicação) e, ao mesmo tempo, confere que o servidor ainda está nesta versão. Com outra versão
   publicada, o arquivo de lá é de outra geração (marcas/*.json e imagens.json apontam para posições de produtos.json): não
   entra no cache e a página recebe 409 com a versão publicada (X-MG-Versao). guardar: só o que o servidor confirmou */
function buscarDaVersao(u) {
  /* detalhes.json vai pelo código da peça (não por posição): o de outra publicação ainda serve a esta versão (a ficha mostra a
     aplicação em vez de "em revisão" quando a versão nova sai antes de ele estar guardado) */
  if (porCodigo(u)) return fetch(semCacheHttp(u)).then(function (r) { return { r: r, guardar: r.ok }; });
  return Promise.all([fetch(semCacheHttp(u)), versaoNoServidor().catch(function () { return null; })]).then(function (x) {
    var r = x[0], v = x[1];
    if (v && v !== VERSAO) return { r: new Response('', { status: 409, statusText: 'Conflict', headers: { 'X-MG-Versao': v } }), outra: v };
    return { r: r, guardar: r.ok && v === VERSAO };
  });
}
/* espaço: cada foto do CDN é uma resposta "opaca", que o Chrome conta no armazenamento com alguns MB a mais de enchimento
   (133 fotos já marcavam ~920 MB). As fotos nunca tiram o lugar da casca e dos dados: passando da metade da cota, a metade
   mais antiga das fotos sai; e se a casca ou os dados não couberem (QuotaExceededError), as fotos saem todas e a gravação
   tenta de novo (apagando as fotos uma a uma: caches.delete só libera o espaço quando ninguém mais usa o cache). */
function apagarFotos(fracao) {
  return caches.open(CACHE_FOTOS).then(function (c) { return c.keys().then(function (ks) { return Promise.all(ks.slice(0, Math.ceil(ks.length * fracao)).map(function (k) { return c.delete(k); })); }); });
}
function comEspaco(gravar) {
  return gravar().catch(function (e) { if (!e || e.name !== 'QuotaExceededError') throw e; return apagarFotos(1).then(gravar); });
}
function conferirCota() {
  if (!self.navigator || !navigator.storage || !navigator.storage.estimate) return Promise.resolve();
  return navigator.storage.estimate().then(function (est) {
    if (!est.quota || est.usage < est.quota / 2) return;
    return apagarFotos(0.5);
  }).catch(function () {});
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    Promise.all([
      /* './' e 'index.html' são o mesmo arquivo: baixa uma vez e guarda nas duas chaves (a navegação offline procura as duas) */
      caches.open(CACHE_CASCA).then(function (c) {
        return comEspaco(function () { return c.addAll(CASCA.filter(function (a) { return a !== './'; }).map(semCacheHttp)); }).then(function () { return c.match('index.html'); }).then(function (r) { if (r) return comEspaco(function () { return c.put('./', r.clone()); }); });
      }),
      /* dados: baixados no mesmo endereço que a página usa (?v=) e guardados no endereço sem o ?v= (onde a página e o aquecimento procuram) */
      caches.open(CACHE_DADOS).then(function (c) {
        return Promise.all(DADOS.map(function (u) {
          return fetch(semCacheHttp(comVersao(u))).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return comEspaco(function () { return c.put(u, r.clone()); }); }).catch(function () {});
        }));
      })
    ]).then(function () {
      /* outra versão publicada durante a instalação: a casca e os dados recém-baixados podem ser de duas publicações; a
         instalação falha e o navegador tenta de novo, já com o sw.js novo */
      return versaoNoServidor().catch(function () { return null; }).then(function (v) { if (v && v !== VERSAO) throw new Error('versão ' + v + ' publicada durante a instalação'); });
    })
  );
});
/* guarda detalhes.json e uma tabela por marca (marcas/<slug>.json) para o uso offline; um por vez, só o que falta.
   O que falta vem do servidor sem o cache HTTP e só entra no cache depois de uma única conferência, no fim, de que o servidor
   ainda está nesta versão (versaoNoServidor): com outra versão publicada no meio, nada do que veio entra (a próxima versão
   aquece com o SW novo); sem uma conferência por arquivo, o 3G não paga uma ida ao servidor a mais por marca */
function aquecer() {
  var icones = caches.open(CACHE_CASCA).then(function (c) {
    return Promise.all(CASCA_DEPOIS.map(function (u) { return c.match(u).then(function (hit) { if (!hit) return comEspaco(function () { return c.add(semCacheHttp(u)); }); }).catch(function () {}); }));
  });
  return icones.then(function () { return caches.open(CACHE_DADOS); }).then(function (c) {
    var novos = [];
    function buscar(u) {
      return c.match(u).then(function (hit) {
        if (hit) return hit;
        if (externo(u)) return comEspaco(function () { return c.add(semCacheHttp(u)); }).then(function () { return c.match(u); }, function () {});
        return fetch(semCacheHttp(comVersao(u))).then(function (r) { if (r.ok) { novos.push([u, r.clone()]); return r; } }, function () {});
      });
    }
    function emSequencia(lista) { return lista.reduce(function (p, u) { return p.then(function () { return buscar(u); }); }, Promise.resolve()); }
    return emSequencia(DADOS.concat([DETALHES])).then(function () {
      var ixNovo = novos.filter(function (x) { return x[0] === BASE + 'indice.json'; })[0];
      return (ixNovo ? Promise.resolve(ixNovo[1].clone()) : c.match(BASE + 'indice.json')).then(function (r) { return r ? r.json() : null; });
    }).then(function (ix) {
      return emSequencia(Object.keys((ix && ix.marcas) || {}).map(function (m) { return BASE + 'marcas/' + slug(m) + '.json'; }));
    }).then(function () {
      if (!novos.length) return;
      return versaoNoServidor().catch(function () { return null; }).then(function (v) {
        return novos.reduce(function (p, x) {
          if (v !== VERSAO && !porCodigo(x[0])) return p; /* outra publicação (ou sem como conferir): fica para o uso, conferido */
          return p.then(function () { return comEspaco(function () { return c.put(x[0], x[1].clone()); }).catch(function () {}); });
        }, Promise.resolve());
      });
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
        if (r && (r.ok || r.type === 'opaque')) {
          var copia = r.clone();
          if (nome === CACHE_FOTOS) c.put(req, copia).then(function () { return limitar(nome, limite); }).then(conferirCota, conferirCota);
          else comEspaco(function () { return c.put(req, copia.clone()); }).then(function () { if (limite) return limitar(nome, limite); }).catch(function () {});
        }
        return r;
      });
    });
  });
}
/* dado local: a chave do cache é o endereço sem o ?v= que o app acrescenta */
function dadoDaVersao(req, url) {
  var chave = url.origin + url.pathname;
  return caches.open(CACHE_DADOS).then(function (c) {
    return c.match(chave).then(function (hit) {
      if (hit) return hit;
      return buscarDaVersao(req.url).then(function (x) {
        if (x.guardar) { var copia = x.r.clone(); comEspaco(function () { return c.put(chave, copia.clone()); }).catch(function () {}); }
        return x.r;
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
  /* navegação: o app (a raiz do escopo ou index.html, com qualquer ?parâmetro) abre do cache desta versão, o mesmo de app.js e app.css
     (antes era rede primeiro: com versão nova publicada, o index.html novo abria com o app.js antigo do cache e ainda
     ficava guardado no cache da versão antiga); só vai à rede se o cache não tiver a casca. Outra página do escopo
     (LEIA-ME.md, p/) continua rede primeiro e nunca toma o lugar do index.html; offline, abre o app */
  if (req.mode === 'navigate') {
    var raiz = new URL(self.registration.scope).pathname, ehCasca = url.origin === location.origin && (url.pathname === raiz || url.pathname === raiz + 'index.html');
    var doCache = function () { return caches.open(CACHE_CASCA).then(function (c) { return c.match('index.html').then(function (h) { return h || c.match('./'); }); }); };
    if (ehCasca) {
      /* clone() antes de devolver a resposta: depois que a página começa a ler o corpo, clonar lança "body is already used" */
      e.respondWith(doCache().then(function (h) {
        return h || fetch(semCacheHttp('index.html')).then(function (r) { if (r.ok) { var copia = r.clone(); caches.open(CACHE_CASCA).then(function (c) { return c.put('index.html', copia); }).catch(function () {}); } return r; });
      }));
      return;
    }
    e.respondWith(fetch(req).catch(function () { return doCache().then(function (h) { return h || Response.error(); }); }));
    return;
  }
  /* fotos da loja */
  if (/mitiendanube\.com|nuvemshop|tiendanube/.test(url.hostname)) { e.respondWith(cachePrimeiro(req, CACHE_FOTOS, LIMITE_FOTOS)); return; }
  /* fontes */
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) { e.respondWith(cachePrimeiro(req, CACHE_FONTES, 40)); return; }
  /* dados do catálogo. Os locais (dados/, mesma origem) são publicados junto com o app e trocam com a versão: cache desta
     versão primeiro, sem atualizar em segundo plano (atualizar um arquivo e não os outros juntava gerações diferentes, e
     marcas/*.json apontam para posições de produtos.json); o que falta vem conferido (dadoDaVersao). Os de fora (jsDelivr,
     se config.js apontar para lá) mudam sem versão nova: cache primeiro e atualização em segundo plano, como antes */
  if (/\.json$/.test(url.pathname)) { e.respondWith(url.origin === location.origin ? dadoDaVersao(req, url) : cacheDepoisRede(req, CACHE_DADOS)); return; }
  /* casca: só do cache desta versão (o de outra versão, ainda no aparelho durante a troca, nunca entra); o que não está
     no pré-cache (ex.: ícones maiores) vem do servidor sem o cache HTTP e vai para ele no 1º uso, menos endereço com
     ?parâmetro (o cache não cresce sem fim) */
  if (url.origin === location.origin) {
    e.respondWith(caches.open(CACHE_CASCA).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(semCacheHttp(req.url)).then(function (r) { if (r.ok && !url.search) { var copia = r.clone(); comEspaco(function () { return c.put(req, copia.clone()); }).catch(function () {}); } return r; });
      });
    }));
  }
});

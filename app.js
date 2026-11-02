/* MG Peças Automotivas — app de catálogo (PWA)
   Vanilla JS, sem build. Rotas por hash: #/ #/placa #/busca #/busca?q=MG001 #/veiculo/Marca/Modelo/Ano
   #/linhas #/linha/<id> #/peca/<CÓDIGO> #/minhas #/sobre #/instalar (QR code e passo a passo; carrega qr.js só nessa tela)
   Dados: indice.json, produtos.json, imagens.json, marcas/<marca>.json (mesmos do buscador do site) + detalhes.json (gerado para o app).
   Configuração: config.js (window.MG_CONFIG), carregado antes deste arquivo e também pelo service worker. */
(function () {
  'use strict';
  var CFG = window.MG_CONFIG || {};
  var BASE = CFG.dadosBase || 'dados/';
  var LOJA = (CFG.loja || 'https://mgpecasautomotivas.com.br').replace(/\/$/, '');
  var ANO_ATUAL = new Date().getFullYear() + 1;

  /* ---------- utilidades ---------- */
  function sa(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function slug(s) { return sa(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(tag, attrs, filhos) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (filhos || []).forEach(function (f) { if (f != null && f !== false) e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return e;
  }
  function svg(paths, attrs) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    if (attrs) Object.keys(attrs).forEach(function (k) { s.setAttribute(k, attrs[k]); });
    s.innerHTML = paths; return s;
  }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  /* sessionStorage: dura só enquanto a aba/app estiver aberto (usado para a placa digitada; nunca vai para o localStorage) */
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function lsJson(k, v) { if (v === undefined) { try { return JSON.parse(ls(k) || 'null'); } catch (e) { return null; } } ls(k, JSON.stringify(v)); }
  function carregar(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r.json(); }); }
  function plural(n, s, p) { return n + ' ' + (n === 1 ? s : p); }
  function dataBr(d) { return String(d || '').split('-').reverse().join('/'); } /* 2026-11-02 → 02/11/2026 */
  function hojeIso() { var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
  /* script carregado só quando a tela precisa (ex.: qr.js); uma promessa por endereço */
  var scripts = {};
  function carregarScript(url) {
    if (!scripts[url]) scripts[url] = new Promise(function (ok, falha) {
      var sc = el('script', { src: url, async: true }); sc.onload = function () { ok(); }; sc.onerror = function () { delete scripts[url]; sc.remove(); falha(new Error('script ' + url)); };
      document.head.appendChild(sc);
    });
    return scripts[url];
  }
  function baixarArquivo(blob, nome) {
    var u = URL.createObjectURL(blob), a = el('a', { href: u, download: nome, style: 'display:none' });
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(u); }, 3000);
  }

  /* ---------- compartilhar ---------- */
  /* endereço público de uma tela do app (config urlApp; sem ela, o endereço atual) */
  function urlApp(hash) { return (CFG.urlApp || location.href.split('#')[0]) + (hash || ''); }
  function copiarTexto(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt);
    return new Promise(function (ok, falha) {
      var ta = el('textarea', { readonly: 'readonly', 'aria-hidden': 'true', style: 'position:fixed;top:0;left:0;opacity:0' }); ta.value = txt;
      document.body.appendChild(ta); ta.select();
      var feito = false; try { feito = document.execCommand('copy'); } catch (e) {}
      ta.remove(); feito ? ok() : falha(new Error('copiar'));
    });
  }
  /* Web Share quando existe (celular); senão copia o link e avisa */
  function compartilhar(titulo, texto, url) {
    if (navigator.share) {
      return navigator.share({ title: titulo, text: texto, url: url }).catch(function (e) { if (e && e.name !== 'AbortError') copiarLink(url); });
    }
    return copiarLink(url);
  }
  function copiarLink(url) { return copiarTexto(url).then(function () { toast('Link copiado'); }).catch(function () { toast('Não foi possível copiar o link.'); }); }

  /* ---------- favoritos ("Minhas peças"): só os códigos MG, no aparelho ---------- */
  var FAV_MAX = 200;
  function favoritos() { var l = lsJson('mg-favoritos'); return Array.isArray(l) ? l : []; }
  function ehFavorito(cod) { return favoritos().indexOf(String(cod).toUpperCase()) >= 0; }
  function alternarFavorito(cod) {
    cod = String(cod).toUpperCase();
    var lista = favoritos().filter(function (c) { return c !== cod; }), salvo = lista.length === favoritos().length;
    if (salvo) lista.unshift(cod);
    lsJson('mg-favoritos', lista.slice(0, FAV_MAX));
    return salvo;
  }
  var ICONES = {
    busca: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    seta: '<path d="m9 6 6 6-6 6"/>',
    voltar: '<path d="m15 5-7 7 7 7"/>',
    carro: '<path d="M4 15v3h2.5M20 15v3h-2.5"/><path d="M4 15 6 9h12l2 6"/><path d="M3 15h18"/><circle cx="7.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="16.5" r="1.5"/>',
    externo: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    loja: '<path d="M4 9 5.5 4h13L20 9"/><path d="M4 9h16v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-4 0z"/><path d="M5 12v8h14v-8"/><path d="M10 20v-5h4v5"/>',
    compartilhar: '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 11v9h14v-9"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    aviso: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    erro: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    lua: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    foto: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-4-7 7"/>',
    instalar: '<path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M4 18v2h16v-2"/>',
    qr: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><path d="M6.5 6.5h1M16.5 6.5h1M6.5 16.5h1"/><path d="M13.5 13.5h3v3h-3zM19.5 13.5h1M13.5 19.5h1M17.5 17.5h3v3h-3z"/>',
    copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    local: '<path d="M12 21s-6-5.5-6-10.5a6 6 0 0 1 12 0C18 15.5 12 21 12 21z"/><circle cx="12" cy="10.5" r="2"/>',
    fabrica: '<path d="M3 20V9l5 3V9l5 3V9l5 3v8z"/><path d="M3 20h18"/><path d="M15 4h3v8"/>',
    peca: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    placa: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M2.5 9.5h19"/><path d="M7 14.5h10"/>',
    pecas: '<path d="M8 7h8a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H8"/><path d="M4 5h4v4H4z"/><path d="M4 13h4v4H4z"/><path d="M8 7v10"/>',
    coracao: '<path d="M12 20.3S4.5 15.6 4.5 10.2A4.1 4.1 0 0 1 12 7.9a4.1 4.1 0 0 1 7.5 2.3c0 5.4-7.5 10.1-7.5 10.1z"/>',
    fechar: '<path d="m7 7 10 10M17 7 7 17"/>',
    ampliar: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/><path d="M11 8.5v5M8.5 11h5"/>',
    atualizar: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'
  };
  var ICONES_LINHA = {
    'filtro-ar': '<path d="M3 7h4v4H3z"/><path d="M17 13h4v4h-4z"/><path d="M7 9h3a4 4 0 0 1 4 4 2 2 0 0 0 2 2h1"/>',
    'arrefecimento': '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7.5 6v12M12 6v12M16.5 6v12"/><path d="M3 12h18"/>',
    'respiro': '<path d="M3 7h9a4 4 0 0 1 4 4v1"/><circle cx="16" cy="17" r="3"/><path d="M16 12v2"/>',
    'reservatorios': '<path d="M6 9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z"/><path d="M10 3h4v3h-4z"/><path d="M6 14h12"/>',
    'tampas-reservatorio': '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/>',
    'tubos-conexoes': '<path d="M3 9h18v4H3z"/><path d="M10 13h4v8h-4z"/><path d="M3 11H1M21 11h2"/>',
    'tampas-comando': '<rect x="3" y="8" width="18" height="10" rx="2"/><path d="M7 8V6M12 8V5M17 8V6"/><path d="M7 13h10"/>',
    'suspensao': '<path d="M12 3v3"/><path d="M8 6l8 2-8 2 8 2-8 2 8 2"/><path d="M12 18v3"/>',
    'metal-borracha': '<rect x="4" y="9" width="16" height="7" rx="2"/><path d="M8 9V5M16 9V5"/><path d="M8 16v3M16 16v3"/>',
    'coifas': '<path d="M8 4h8"/><path d="M9 4v3l-2 1.5 2 1.5-2 1.5 2 1.5-2 1.5 2 1.5V20"/><path d="M15 4v3l2 1.5-2 1.5 2 1.5-2 1.5 2 1.5-2 1.5V20"/><path d="M9 20h6"/>',
    'direcao': '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M4.3 10.5h5.2M14.5 10.5h5.2M12 14.5V20"/>',
    'combustivel': '<path d="M5 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15"/><path d="M4 20h12"/><path d="M7 7h6v4H7z"/><path d="M15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-2-2"/>',
    'pesada': '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    'outros': ICONES.peca
  };
  ICONES.semRede = '<path d="m3 3 18 18"/><path d="M2.5 9.2A15 15 0 0 1 7 6.7"/><path d="M10.6 5.3A15 15 0 0 1 21.5 9.2"/><path d="M5.6 12.7a10.5 10.5 0 0 1 3.3-2.1"/><path d="M12.6 10a10.5 10.5 0 0 1 5.8 2.7"/><path d="M8.7 16.1a6 6 0 0 1 6.6 0"/><path d="M12 19.5h.01"/>';
  var LINHAS = [
    { id: 'filtro-ar', nome: 'Mangueiras do Filtro de Ar' },
    { id: 'arrefecimento', nome: 'Mangueiras de Arrefecimento' },
    { id: 'respiro', nome: 'Respiro e Rabichos' },
    { id: 'reservatorios', nome: 'Reservatórios de Expansão' },
    { id: 'tampas-reservatorio', nome: 'Tampas de Reservatório' },
    { id: 'tubos-conexoes', nome: 'Tubos, Flanges e Conectores' },
    { id: 'tampas-comando', nome: 'Tampas de Comando de Válvulas' },
    { id: 'suspensao', nome: 'Suspensão' },
    { id: 'metal-borracha', nome: 'Metal-Borracha' },
    { id: 'coifas', nome: 'Coifas' },
    { id: 'direcao', nome: 'Direção Hidráulica' },
    { id: 'combustivel', nome: 'Combustível' },
    { id: 'pesada', nome: 'Diversos e Linha Pesada' },
    { id: 'outros', nome: 'Outras Peças' }
  ];
  var LINHA_POR_ID = {}; LINHAS.forEach(function (l) { LINHA_POR_ID[l.id] = l; });
  /* Foto de cada linha nos cartões do Início e da tela Linhas: uma peça típica da linha (código MG). A foto é a mesma das
     listas (imagens.json: base + nome + sufixo, variante de 320 px). Para trocar, basta pôr aqui outro código publicado e com
     foto da própria linha; com código inexistente, sem foto ou com a foto falhando, o cartão volta ao ícone da linha. */
  var FOTO_LINHA = {
    'filtro-ar': 'MG001',           /* Mangueira do Filtro de Ar · Fiat Palio / Siena */
    'arrefecimento': 'MG076',       /* Mangueira Superior do Radiador · Volkswagen Gol */
    'respiro': 'MG017',             /* Mangueira do Respiro do Motor · Volkswagen Gol / Parati */
    'reservatorios': 'MG1903',      /* Reservatório de Expansão · Fiat Idea */
    'tampas-reservatorio': 'MG571', /* Tampa do Reservatório de Água do Limpador do Para-brisa · Chevrolet Cobalt */
    'tubos-conexoes': 'MG114',      /* Tubo de Circulação d'Água do Motor · Chevrolet Astra / Zafira */
    'tampas-comando': 'MG583',      /* Tampa do Comando de Válvulas · Ford EcoSport / Focus */
    'suspensao': 'MG-G1234',        /* Batente do Amortecedor Dianteiro · Chevrolet Celta / Corsa */
    'metal-borracha': 'MG7517M',    /* Suporte Dianteiro do Motor Lado Direito · Volkswagen Fox (a mesma peça da home do site) */
    'coifas': 'MG401',              /* Coifa da Homocinética Lado Roda · Fiat Fiorino / Palio */
    'direcao': 'MG1335',            /* Mangueira da Direção Hidráulica · Chevrolet Corsa Classic */
    'combustivel': 'MG4064',        /* Mangueira de Combustível · Volkswagen Gol / Parati */
    'pesada': 'MG4025',             /* Mangueira do Filtro de Ar · Iveco Daily */
    'outros': 'MG4095'              /* Anel de Apoio da Válvula do Cânister · Volkswagen Fox / Golf */
  };
  /* buscas no site por linha (soma dos 200 termos mais buscados até 15/10/2026, busca_inteligente/top200_termos.csv:
     códigos MG e números somados à linha da ficha, "reservatório" e "mangueira filtro ar" às suas linhas; "mangueira"
     sozinha e nomes de carro ficam de fora); só desempata a ordem dos chips de linha no cartão do veículo */
  var LINHA_BUSCAS = { 'filtro-ar': 1452, 'tubos-conexoes': 927, 'reservatorios': 741, 'respiro': 628, 'metal-borracha': 229, 'tampas-comando': 180, 'arrefecimento': 145, 'pesada': 25 };

  /* ---------- dados ---------- */
  var indice = null, produtos = null, imagens = null, detalhes = null, detalhesGerado = '', porCodigo = {}, cacheMarcas = {}, pDetalhes = null, indiceBusca = null;
  /* uma única carga em andamento: a tela e o aquecimento do idle pedem ao mesmo tempo no 1º acesso e, sem isso,
     indice/produtos/imagens (~340 KB) desciam duas vezes */
  var pBase = null, pImagens = null, imagensPronto = false;
  function dadosBase() {
    if (indice && produtos) return Promise.resolve();
    if (!pBase) pBase = Promise.all([carregar(BASE + 'indice.json'), carregar(BASE + 'produtos.json')])
      .then(function (r) {
        indice = r[0]; produtos = r[1];
        produtos.forEach(function (p, i) { porCodigo[p[0].toUpperCase()] = i; });
        if (navigator.onLine !== false) ls('mg-dados-em', hojeIso()); /* "dados guardados em …" do aviso de sem conexão */
        pintarOffline();
        dadosImagens(); /* imagens.json (128 KB) só depois: no 3G ele não disputa a banda com produtos.json (contagens do Início mais cedo) */
      }).catch(function (e) { pBase = null; throw e; });
    return pBase;
  }
  /* fotos: enquanto imagens.json não chega, as miniaturas ficam em esqueleto (.foto.aguardando) e repintarFotos as troca
     pela foto (ou por "Foto em breve") quando ele chega; sem rede, segue sem fotos */
  function dadosImagens() {
    if (imagensPronto) return Promise.resolve(imagens);
    if (!pImagens) pImagens = carregar(BASE + 'imagens.json').catch(function () { return null; }).then(function (d) { imagens = d; imagensPronto = true; repintarFotos(); return imagens; });
    return pImagens;
  }
  function repintarFotos() {
    document.querySelectorAll('.foto.aguardando').forEach(function (b) { var a = b._foto || []; b.replaceWith(fotoEl(a[0], a[1], a[2], a[3])); });
  }
  function dadosDetalhes() {
    if (detalhes) return Promise.resolve(detalhes);
    if (!pDetalhes) pDetalhes = carregar(CFG.detalhesUrl || 'dados/detalhes.json').then(function (d) { detalhes = d.itens || d; detalhesGerado = d.gerado || ''; return detalhes; }).catch(function (e) { pDetalhes = null; throw e; });
    return pDetalhes;
  }
  function dadosMarca(marca) {
    if (cacheMarcas[marca]) return Promise.resolve(cacheMarcas[marca]);
    return carregar(BASE + 'marcas/' + slug(marca) + '.json').then(function (d) { cacheMarcas[marca] = d; return d; });
  }
  function fotoDe(idx, tamanho) {
    if (!imagens || !imagens.itens) return null;
    var v = imagens.itens[idx]; if (!v) return null;
    if (/^(https?:)?\/\//.test(v)) return v;
    var suf = imagens.sufixo || '';
    if (tamanho) suf = suf.replace(/-\d+-0\./, '-' + tamanho + '-0.');
    return (imagens.base || '') + v + suf;
  }
  function detalheDe(cod) { return (detalhes && detalhes[cod]) || {}; }
  /* linha da peça: detalhes.json quando já chegou; antes disso, o 5º campo de produtos.json (posição na lista "linhas" de
     indice.json, gerados juntos por gerar_detalhes.py), para o Início, a tela Linhas e os filtros não esperarem os 500 KB */
  function linhaDe(cod) {
    var d = detalhes && detalhes[cod];
    if (d) return LINHA_POR_ID[d.l] || LINHA_POR_ID.outros;
    var i = porCodigo[String(cod || '').toUpperCase()], p = i != null ? produtos[i] : null;
    if (p && p.length > 4 && indice && indice.linhas) return LINHA_POR_ID[indice.linhas[p[4]]] || LINHA_POR_ID.outros;
    return LINHA_POR_ID.outros;
  }
  function linhasNoIndice() { return !!(indice && indice.linhas && produtos && produtos.length && produtos[0].length > 4); }

  /* ---------- componentes ---------- */
  /* fallbackTam: largura da foto menor que entra se a maior falhar (ficha: 640 → 320) */
  function fotoEl(idx, alt, tamanho, fallbackTam) {
    var box = el('span', { class: 'foto' });
    if (!imagensPronto) { box.classList.add('aguardando'); box._foto = [idx, alt, tamanho, fallbackTam]; return box; }
    var src = fotoDe(idx, tamanho), fallback = fallbackTam ? fotoDe(idx, fallbackTam) : null;
    if (!src) { box.classList.add('sem'); box.appendChild(svg(ICONES.foto)); box.appendChild(el('span', { class: 'sem-txt', text: 'Foto em breve' })); return box; }
    /* largura/altura na proporção real das fotos da loja (1600×880 = 20:11); o tamanho visível vem do CSS */
    var larg = tamanho || 320;
    var img = el('img', { src: src, alt: alt || '', loading: 'lazy', decoding: 'async', width: String(larg), height: String(Math.round(larg * 11 / 20)) });
    img.addEventListener('load', function () { img.classList.add('ok'); box.classList.add('ok'); });
    img.addEventListener('error', function () {
      if (fallback && img.src !== fallback) { img.src = fallback; return; }
      img.remove(); box.classList.add('sem'); box.appendChild(svg(ICONES.foto)); box.appendChild(el('span', { class: 'sem-txt', text: 'Sem foto' }));
    });
    box.appendChild(img);
    return box;
  }
  function status(msg, tipo) {
    var ic = { info: ICONES.info, aviso: ICONES.aviso, erro: ICONES.erro, ok: ICONES.ok }[tipo || 'info'];
    return el('div', { class: 'status ' + (tipo || 'info'), role: 'status' }, [svg(ic), el('span', {}, [typeof msg === 'string' ? msg : msg])]);
  }
  /* texto: frase ou lista de sugestões (vira uma lista com marcadores) */
  function vazio(titulo, texto, acoes) {
    var corpo = Array.isArray(texto) ? el('ul', { class: 'sugestoes' }, texto.map(function (t) { return el('li', { text: t }); })) : (texto ? el('p', { text: texto }) : null);
    return el('div', { class: 'vazio cartao' }, [svg(ICONES.busca), el('h2', { text: titulo }), corpo].concat(acoes || []));
  }
  function esqueleto(n) { var d = el('div', { class: 'esqueleto', role: 'status', 'aria-busy': 'true' }, [el('span', { class: 'visualmente-oculto', text: 'Carregando…' })]); for (var i = 0; i < (n || 5); i++) d.appendChild(el('div', { class: 'esq-item', 'aria-hidden': 'true' })); return d; }
  function anoTexto(a) {
    if (!a[1] && a[2] === 9999) return 'todos os anos';
    if (a[2] === 9999) return a[1] + ' em diante';
    if (!a[1]) return 'até ' + a[2];
    return a[1] === a[2] ? String(a[1]) : a[1] + ' a ' + a[2];
  }
  /* remover: função chamada ao tocar no "×" do cartão (lista Minhas peças); o botão fica fora do link */
  function itemPeca(i, apl, chip, remover) {
    var p = produtos[i];
    var corpo = el('span', {}, [
      el('span', { class: 'item-cod', text: p[0] }),
      el('span', { class: 'item-nome', text: p[1] }),
      apl ? el('span', { class: 'item-apl', html: apl }) : null,
      chip ? el('span', { class: 'etiqueta etiqueta-aviso', text: chip }) : null
    ]);
    corpo.style.display = 'flex'; corpo.style.flexDirection = 'column'; corpo.style.minWidth = '0';
    var li = el('li', { class: remover ? 'item-com-acao' : null }, [el('a', { class: 'item', href: '#/peca/' + encodeURIComponent(p[0]) }, [fotoEl(i, ''), corpo, remover ? null : svg(ICONES.seta, { class: 'item-seta' })])]);
    if (remover) {
      var b = el('button', { type: 'button', class: 'item-remover', 'aria-label': 'Remover ' + p[0] + ' de Minhas peças', title: 'Remover' }, [svg(ICONES.fechar)]);
      b.addEventListener('click', function () { remover(p[0], li); });
      li.appendChild(b);
    }
    return li;
  }
  /* códigos salvos que existem no catálogo carregado */
  function favoritosValidos() { return favoritos().filter(function (c) { return porCodigo[c] != null; }); }
  /* lista das peças salvas (reaproveita o cartão da busca); max = quantas mostrar (0 = todas); aoMudar = chamado após remover */
  var ORDENS_MINHAS = [['salvas', 'Mais recentes'], ['nome', 'Nome'], ['linha', 'Linha']], ordemMinhas = 'salvas';
  function ordenarMinhas(cods, ordem) {
    function nome(c) { return produtos[porCodigo[c]][1]; }
    function posLinha(c) { var i = LINHAS.indexOf(linhaDe(c)); return i < 0 ? LINHAS.length : i; }
    if (ordem === 'nome') return cods.slice().sort(function (a, b) { return nome(a).localeCompare(nome(b), 'pt-BR') || a.localeCompare(b, 'pt-BR', { numeric: true }); });
    if (ordem === 'linha') return cods.slice().sort(function (a, b) { return posLinha(a) - posLinha(b) || nome(a).localeCompare(nome(b), 'pt-BR') || a.localeCompare(b, 'pt-BR', { numeric: true }); });
    return cods; /* "salvas": a última salva primeiro (ordem guardada) */
  }
  function listaMinhas(max, aoMudar, ordem) {
    var ul = el('ul', { class: 'lista' }), cods = ordenarMinhas(favoritosValidos(), ordem);
    (max ? cods.slice(0, max) : cods).forEach(function (cod) {
      ul.appendChild(itemPeca(porCodigo[cod], aplicacoesResumo(cod), null, function (c) {
        alternarFavorito(c); toast('Removida de Minhas peças'); aoMudar();
      }));
    });
    return ul;
  }
  function secaoMinhas() {
    var MAX = 6, sec = el('section', { class: 'secao minhas', hidden: true });
    function montar() {
      var n = favoritosValidos().length;
      sec.innerHTML = ''; sec.hidden = !n; if (!n) return;
      sec.appendChild(el('div', { class: 'secao-cab' }, [el('h2', { text: 'Minhas peças' }),
        n > MAX ? el('a', { class: 'link', href: '#/minhas', text: 'Ver todas (' + n + ')' }) : el('small', { class: 'secao-cont', text: plural(n, 'peça salva', 'peças salvas') })]));
      sec.appendChild(listaMinhas(MAX, montar));
    }
    /* só os arquivos pequenos; detalhes.json (500 KB) entra depois, e só se há peças salvas (antes ele descia junto com
       produtos.json no 1º acesso e atrasava as contagens do Início no 3G) */
    dadosBase().then(function () { montar(); if (favoritosValidos().length && !detalhes) dadosDetalhes().then(montar).catch(function () {}); });
    return sec;
  }
  function aplicacoesResumo(cod, max) {
    var d = detalheDe(cod); if (!d.a) return '';
    var vistos = {}, lista = [];
    d.a.forEach(function (a) { var v = a[0]; if (!vistos[v]) { vistos[v] = 1; lista.push(v); } });
    var txt = lista.slice(0, max || 3).join(', ');
    if (lista.length > (max || 3)) txt += ' e mais ' + (lista.length - (max || 3));
    return esc(txt);
  }

  /* ---------- zoom da foto: tela cheia, pinça, toque duplo, arrastar; fecha no X, no Esc, tocando fora ou puxando para baixo ---------- */
  var zoomAberto = null;
  function abrirZoom(srcPequeno, srcGrande, alt, devolverFoco) {
    if (!srcPequeno || zoomAberto) return;
    var img = el('img', { class: 'zoom-img', src: srcPequeno, alt: alt || '', draggable: 'false' });
    var palco = el('div', { class: 'zoom-palco' }, [img]);
    var btnFechar = el('button', { type: 'button', class: 'zoom-fechar', 'aria-label': 'Fechar foto ampliada' }, [svg(ICONES.fechar)]);
    var dica = el('p', { class: 'zoom-dica', text: 'Afaste os dedos ou toque duas vezes para ampliar' });
    var ov = el('div', { class: 'zoom', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Foto ampliada' }, [palco, btnFechar, dica]);
    var MAX = 4, esc = 1, tx = 0, ty = 0, pts = {}, gesto = null, ultimoToque = 0, dicaTimer;
    if (srcGrande && srcGrande !== srcPequeno) { var pre = new Image(); pre.onload = function () { if (zoomAberto === ov) img.src = srcGrande; }; pre.src = srcGrande; }
    function centro() { var r = palco.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }
    function aplicar() {
      var c = centro(), w = img.clientWidth * esc, h = img.clientHeight * esc;
      var mx = Math.max(0, (w - c.w) / 2), my = Math.max(0, (h - c.h) / 2);
      tx = Math.min(mx, Math.max(-mx, tx)); ty = Math.min(my, Math.max(-my, ty));
      img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + esc + ')';
      ov.classList.toggle('ampliado', esc > 1.01);
    }
    /* muda a escala mantendo o ponto (px, py) da tela parado */
    function escalarEm(nova, px, py) {
      nova = Math.min(MAX, Math.max(1, nova));
      var c = centro(), ux = (px - c.x - tx) / esc, uy = (py - c.y - ty) / esc;
      esc = nova; tx = px - c.x - esc * ux; ty = py - c.y - esc * uy;
      if (esc === 1) { tx = 0; ty = 0; }
      aplicar();
    }
    function fechar(viaHistorico) {
      if (zoomAberto !== ov) return;
      zoomAberto = null; ov.remove(); document.documentElement.classList.remove('zoom-aberto');
      document.removeEventListener('keydown', teclas); clearTimeout(dicaTimer);
      if (!viaHistorico && history.state && history.state.mgZoom) history.back();
      if (devolverFoco && devolverFoco.focus) devolverFoco.focus();
    }
    function teclas(e) {
      if (e.key === 'Escape') { e.preventDefault(); fechar(); }
      else if (e.key === '+' || e.key === '=') { var c = centro(); escalarEm(esc * 1.5, c.x, c.y); }
      else if (e.key === '-') { var c2 = centro(); escalarEm(esc / 1.5, c2.x, c2.y); }
    }
    function toqueDuplo(px, py) { if (esc > 1.01) escalarEm(1, px, py); else escalarEm(2.5, px, py); }
    ov.addEventListener('pointerdown', function (e) {
      if (e.target === btnFechar || btnFechar.contains(e.target)) return;
      e.preventDefault();
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { ov.setPointerCapture(e.pointerId); } catch (err) {}
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        var a = pts[ids[0]], b = pts[ids[1]];
        gesto = { tipo: 'pinca', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, esc0: esc, tx0: tx, ty0: ty, mx0: (a.x + b.x) / 2, my0: (a.y + b.y) / 2 };
      } else if (ids.length === 1) {
        gesto = { tipo: 'um', x0: e.clientX, y0: e.clientY, tx0: tx, ty0: ty, moveu: false, alvoImg: e.target === img, t0: Date.now() };
      }
    });
    ov.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId] || !gesto) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts);
      if (gesto.tipo === 'pinca' && ids.length >= 2) {
        var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var nova = Math.min(MAX, Math.max(1, gesto.esc0 * d / gesto.d0)), c = centro();
        var ux = (gesto.mx0 - c.x - gesto.tx0) / gesto.esc0, uy = (gesto.my0 - c.y - gesto.ty0) / gesto.esc0;
        esc = nova; tx = mx - c.x - esc * ux; ty = my - c.y - esc * uy; aplicar();
      } else if (gesto.tipo === 'um') {
        var dx = e.clientX - gesto.x0, dy = e.clientY - gesto.y0;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) gesto.moveu = true;
        if (esc > 1.01) { tx = gesto.tx0 + dx; ty = gesto.ty0 + dy; aplicar(); }
        else if (gesto.moveu) { var k = Math.max(0, dy); palco.style.transform = 'translateY(' + k + 'px)'; ov.style.opacity = String(Math.max(.35, 1 - k / 400)); }
      }
    });
    function soltar(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      var ids = Object.keys(pts), g = gesto;
      if (!g) return;
      if (g.tipo === 'pinca') {
        if (ids.length === 1) { var r = pts[ids[0]]; gesto = { tipo: 'um', x0: r.x, y0: r.y, tx0: tx, ty0: ty, moveu: true, alvoImg: true, t0: 0 }; }
        else gesto = null;
        if (esc < 1.05) { esc = 1; tx = 0; ty = 0; aplicar(); }
        return;
      }
      gesto = null;
      if (esc <= 1.01) {
        var dy = e.clientY - g.y0;
        palco.style.transform = ''; ov.style.opacity = '';
        if (g.moveu && dy > 90 && e.type !== 'pointercancel') { fechar(); return; }
      }
      if (g.moveu || e.type === 'pointercancel') return;
      var agora = Date.now();
      if (agora - ultimoToque < 320) { ultimoToque = 0; toqueDuplo(e.clientX, e.clientY); return; }
      ultimoToque = agora;
      if (!g.alvoImg) setTimeout(function () { if (ultimoToque === agora) fechar(); }, 330);
    }
    ov.addEventListener('pointerup', soltar);
    ov.addEventListener('pointercancel', soltar);
    ov.addEventListener('wheel', function (e) { e.preventDefault(); escalarEm(esc * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
    ov.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    btnFechar.addEventListener('click', function () { fechar(); });
    zoomAberto = ov;
    document.body.appendChild(ov); document.documentElement.classList.add('zoom-aberto');
    document.addEventListener('keydown', teclas);
    try { history.pushState({ mgZoom: 1 }, ''); } catch (err) {}
    btnFechar.focus();
    dicaTimer = setTimeout(function () { dica.classList.add('some'); }, 3500);
    ov.fecharZoom = fechar;
  }
  window.addEventListener('popstate', function () { if (zoomAberto) zoomAberto.fecharZoom(true); });

  /* ---------- seletor de veículo ---------- */
  function opcoesSelect(sel, lista, ph) { sel.innerHTML = ''; sel.appendChild(el('option', { value: '', text: ph })); lista.forEach(function (o) { sel.appendChild(el('option', { value: o, text: o })); }); }
  /* faixa de anos das aplicações: [primeiro, último] (9999 = em diante → ano atual + 1) */
  function faixaAnos(apls) {
    var y1 = 9999, y2 = 0;
    apls.forEach(function (a) { if (a[1]) y1 = Math.min(y1, a[1]); y2 = Math.max(y2, a[2] === 9999 ? ANO_ATUAL : a[2]); });
    if (y1 === 9999) y1 = 1960; if (y2 < y1) y2 = ANO_ATUAL;
    return [y1, y2];
  }
  /* motores das aplicações, só as do ano informado (0 = todos): primeiro as cilindradas (1.0, 1.6…), que é como o
     mecânico fala do motor; depois as descrições completas da tabela */
  function motoresDe(apls, ano) {
    var motores = {}, cils = {};
    apls.forEach(function (a) { if (ano && !((a[1] || 0) <= ano && ano <= a[2])) return; if (a[3]) motores[a[3]] = 1; });
    var ms = Object.keys(motores).sort();
    ms.forEach(function (m) { cilsDe(m).forEach(function (c) { cils[c.toFixed(1)] = 1; }); });
    return { cils: Object.keys(cils).sort(), completos: ms.filter(function (m) { return !cils[m]; }), todos: ms };
  }
  function preencherMotores(sel, mt) {
    opcoesSelect(sel, [], 'Todos');
    if (mt.cils.length && mt.completos.length) {
      sel.appendChild(el('optgroup', { label: 'Cilindrada' }, mt.cils.map(function (c) { return el('option', { value: c, text: c }); })));
      sel.appendChild(el('optgroup', { label: 'Motor completo' }, mt.completos.map(function (m) { return el('option', { value: m, text: m }); })));
    } else opcoesSelect(sel, mt.todos, 'Todos');
    sel.disabled = mt.todos.length === 0;
  }
  /* marcas com muitos modelos em código (Scania G360…S560, BMW 116i…X6): o <select> de
     modelos sai em grupos por série, montados na hora (o dado não muda). Série = letras iniciais (1 a 3) seguidas de
     número, sozinhas ou seguidas de uma letra (NTG G), juntas pela 1ª letra (G360 → G; O500, OF, OH1621, OM904LA → O;
     DS3/DS4/DS5 → DS); só
     número → "Modelos numéricos"; nomes (Actros, Sprinter, Classe A) → "Outros modelos". Só agrupa com 24+ modelos e
     pelo menos 60% deles em alguma série; senão a lista continua plana (Chevrolet, Fiat, Volkswagen). */
  /* Mercedes-Benz: cada modelo entra em um grupo só quando o dado confirma o tipo do veículo (conferido modelo a modelo;
     quem não tem confirmação fica em "Outros modelos", nunca é classificado por palpite):
     - Caminhões: os 14 modelos da aplicação da MG4228, cuja ficha se chama "… Mercedes-Benz Caminhões 1218 a 2418";
     - Ônibus: os 6 modelos da aplicação da MG4196, ficha "Mangueira Inferior do Radiador Mercedes-Benz Ônibus …";
     - Vans e carros: Sprinter (MG642, MG666, MG4200 e MG4300 estão na categoria "Vans" do site) e Classe A (MG1572:
       catálogo "Mangueiras do Filtro de Ar", fora da Linha Pesada e das Vans, versões Classic/Elegance/Avantgarde/Spirit);
     - Linha pesada (demais modelos): modelos cujas peças estão na categoria "Linha Pesada > Mercedes-Benz" do site ou
       com "Linha Pesada" no nome da ficha (MG1103), sem o cadastro dizer se é caminhão ou ônibus;
     - Outros modelos: o que sobra (311, 313, 314, 415, 416, 515 e 516 da MG4020 vêm só como número no catálogo). */
  var MB_GRUPOS = [
    ['Vans e carros', ['Sprinter', 'Classe A']],
    ['Caminhões', ['1218', '1315', '1318', '1319', '1418', '1420', '1618', '1620', '1621', '1718', '1720', '1721', '2318', '2418']],
    ['Ônibus', ['OHL1518SB', 'OHL1618SB', 'OHL1718SB', 'O500U', 'OH1621', 'OH1721']],
    ['Linha pesada (demais modelos)', ['1214', '1214K', '1215', '1215 C', '1215C', '1414', '1414K', '1518', '1630', '1632', '1714', '1714K', '1715', '1725', '1728', '1830', '1935', '710', '712C', '914C',
      'Accelo', 'Actros', 'Atego', 'Atron', 'Axor', 'L1218R', 'L1318', 'L1418R', 'LP', 'LS', 'O371R', 'O400R', 'O500', 'O500R', 'OF', 'OM904LA', 'OM906LA']]
  ];
  function gruposDeModelos(modelos, marca) {
    if (marca === 'Mercedes-Benz') {
      var mb = MB_GRUPOS.map(function (g) { return { rotulo: g[0], modelos: [], chaves: g[1].map(sa) }; }), outros = [];
      modelos.forEach(function (m) {
        var k = sa(m), g = null;
        mb.forEach(function (x) { if (!g && x.chaves.indexOf(k) >= 0) g = x; });
        (g ? g.modelos : outros).push(m);
      });
      return mb.filter(function (g) { return g.modelos.length; }).map(function (g) { return { rotulo: g.rotulo, modelos: g.modelos }; })
        .concat(outros.length ? [{ rotulo: 'Outros modelos', modelos: outros }] : []);
    }
    /* Volkswagen: os caminhões (modelos em número, como 14.200, 31.260 e 8-150, e as séries Constellation, Delivery e
       Worker) ficam em um grupo "Caminhões", separados dos carros; só na hora de montar a lista, o dado não muda */
    if (marca === 'Volkswagen') {
      var cam = [], carros = [], onibus = [];
      modelos.forEach(function (m) {
        if (/^\d/.test(m) || /^(Constellation|Delivery|Worker)$/.test(m)) cam.push(m);
        else if (/^[oô]nibus$/i.test(m)) onibus.push(m);
        else carros.push(m);
      });
      if (cam.length) return [{ rotulo: 'Carros e utilitários', modelos: carros }, { rotulo: 'Caminhões', modelos: cam }].concat(onibus.length ? [{ rotulo: 'Ônibus', modelos: onibus }] : []);
    }
    if (modelos.length < 24) return null;
    var por = {}, cobertos = 0;
    modelos.forEach(function (m) {
      var k = /^([a-z]{1,3})(?=\d|$| [a-z]$)/.exec(sa(m)), chave = /^\d/.test(m) ? '#' : (k ? k[1][0] : '');
      if (chave) cobertos++;
      var g = por[chave] = por[chave] || { modelos: [], codigos: [] };
      g.modelos.push(m); if (k && chave !== '#') g.codigos.push(k[1]);
    });
    if (cobertos < modelos.length * 0.6) return null;
    function prefixoComum(cs) { var p = cs[0] || ''; cs.forEach(function (c) { while (c.indexOf(p) !== 0) p = p.slice(0, -1); }); return p; }
    /* rótulo do grupo só com o que o dado confirma: quando todos os modelos começam pelo mesmo código (Z4, Z4 Coupe
       3.0si, Z4 Roadster 3.0si, Z4 sDrive30i), o grupo se chama por ele ("Z4", não "Série Z"); quando a sigla tem 2+
       letras (Scania "NTG G/P/R/S": é assim que o cadastro chama a geração), o grupo leva a sigla ("NTG"); senão fica
       "Série" + letra (Scania G/L/P/R/S, BMW X), que é a parte comum dos códigos — nunca um tipo de veículo por palpite */
    function rotuloSerie(g) {
      var ks = g.modelos.map(sa), m = /^([a-z]{1,3}\d+)(?= |$)/.exec(prefixoComum(ks) + ' ');
      /* o código tem que ser um modelo inteiro ("Z4", "Z4 Coupe"), não só o começo comum de vários (L320 e L360 → "L3") */
      if (m && ks.some(function (k) { return k === m[1] || k.indexOf(m[1] + ' ') === 0; })) return m[1].toUpperCase();
      var p = prefixoComum(g.codigos).toUpperCase();
      return p.length > 1 ? p : 'Série ' + p;
    }
    var chaves = Object.keys(por).filter(function (c) { return c && c !== '#'; }).sort();
    var grupos = [];
    if (por['#']) grupos.push({ rotulo: 'Modelos numéricos', modelos: por['#'].modelos });
    chaves.forEach(function (c) { grupos.push({ rotulo: rotuloSerie(por[c]), modelos: por[c].modelos }); });
    if (por['']) grupos.push({ rotulo: 'Outros modelos', modelos: por[''].modelos });
    return grupos;
  }
  function seletorVeiculo(opts) {
    opts = opts || {};
    var selMarca = el('select', { class: 'select', 'aria-label': 'Marca' }), selModelo = el('select', { class: 'select', disabled: true, 'aria-label': 'Modelo' });
    var selAno = el('select', { class: 'select', disabled: true, 'aria-label': 'Ano' }), selMotor = el('select', { class: 'select', disabled: true, 'aria-label': 'Motor' });
    var btn = el('button', { type: 'button', class: 'btn btn-primario' }, [svg(ICONES.busca), 'Buscar peças']);
    var aviso = el('div', { class: 'aviso-form' });
    var opcoes = opcoesSelect, aplsModelo = [];
    opcoes(selMarca, [], 'Carregando…'); selMarca.disabled = true;
    opcoes(selModelo, [], 'Escolha a marca primeiro'); opcoes(selAno, [], 'Todos'); opcoes(selMotor, [], 'Todos');
    var wrap = el('div', { class: 'seletor' }, [
      el('label', { class: 'campo' }, [el('span', { class: 'rotulo', text: 'Marca' }), el('div', { class: 'select-wrap' }, [selMarca])]),
      el('label', { class: 'campo' }, [el('span', { class: 'rotulo', text: 'Modelo' }), el('div', { class: 'select-wrap' }, [selModelo])]),
      el('div', { class: 'grade-2 campo' }, [
        el('label', { class: 'campo' }, [el('span', { class: 'rotulo', text: 'Ano (opcional)' }), el('div', { class: 'select-wrap' }, [selAno])]),
        el('label', { class: 'campo' }, [el('span', { class: 'rotulo', text: 'Motor (opcional)' }), el('div', { class: 'select-wrap' }, [selMotor])])
      ]),
      aviso,
      el('div', { class: 'campo' }, [btn])
    ]);
    dadosBase().then(function () {
      var marcas = Object.keys(indice.marcas).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
      opcoes(selMarca, marcas, 'Escolha a marca'); selMarca.disabled = false;
      if (opts.marca && indice.marcas[opts.marca]) { selMarca.value = opts.marca; selMarca.dispatchEvent(new Event('change')); }
    }).catch(function () { aviso.innerHTML = ''; aviso.appendChild(status('Não foi possível carregar a lista de veículos. Verifique a conexão e tente de novo.', 'erro')); });
    selMarca.addEventListener('change', function () {
      var m = selMarca.value; aviso.innerHTML = '';
      selAno.disabled = selMotor.disabled = true; opcoes(selAno, [], 'Todos'); opcoes(selMotor, [], 'Todos');
      if (!m) { opcoes(selModelo, [], 'Escolha a marca primeiro'); selModelo.disabled = true; return; }
      var modelos = indice.marcas[m].slice().sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); }), grupos = gruposDeModelos(modelos, m);
      if (grupos) { opcoes(selModelo, [], 'Escolha o modelo'); grupos.forEach(function (g) { selModelo.appendChild(el('optgroup', { label: g.rotulo }, g.modelos.map(function (o) { return el('option', { value: o, text: o }); }))); }); }
      else opcoes(selModelo, modelos, 'Escolha o modelo');
      selModelo.disabled = false;
      dadosMarca(m).catch(function () {}); /* só aquece o cache; a falha aparece ao escolher o modelo */
    });
    selModelo.addEventListener('change', function () {
      var m = selMarca.value, mo = selModelo.value; aviso.innerHTML = '';
      if (!mo) { selAno.disabled = selMotor.disabled = true; return; }
      dadosMarca(m).then(function (d) {
        if (selMarca.value !== m || selModelo.value !== mo) return;
        aplsModelo = d[mo] || [];
        var f = faixaAnos(aplsModelo), anos = []; for (var y = f[1]; y >= f[0]; y--) anos.push(String(y));
        opcoes(selAno, anos, 'Todos'); selAno.disabled = false;
        montarMotores();
      }).catch(function () { aviso.innerHTML = ''; aviso.appendChild(status('Não foi possível carregar os veículos desta marca. Verifique a conexão e tente de novo.', 'erro')); });
    });
    /* a lista de motores acompanha o ano escolhido: só os motores das aplicações daquele ano (sem ano = todos) */
    function montarMotores() {
      var atual = selMotor.value, mt = motoresDe(aplsModelo, +selAno.value || 0);
      preencherMotores(selMotor, mt);
      if (atual && mt.todos.concat(mt.cils).indexOf(atual) >= 0) selMotor.value = atual;
    }
    selAno.addEventListener('change', montarMotores);
    btn.addEventListener('click', function () {
      aviso.innerHTML = '';
      if (!selMarca.value) { aviso.appendChild(status('Escolha a marca do veículo.', 'aviso')); selMarca.focus(); return; }
      if (!selModelo.value) { aviso.appendChild(status('Escolha o modelo.', 'aviso')); selModelo.focus(); return; }
      irVeiculo(selMarca.value, selModelo.value, selAno.value, selMotor.value, opts.linha ? { linha: opts.linha } : null);
    });
    return wrap;
  }
  /* extra (via, descr, cil): parâmetros a mais da consulta pela placa; o endereço base é o mesmo de hashVeiculo */
  function irVeiculo(marca, modelo, ano, motor, extra) {
    var h = hashVeiculo({ marca: marca, modelo: modelo, ano: ano, motor: motor }), q = [];
    if (extra) Object.keys(extra).forEach(function (k) { if (extra[k]) q.push(k + '=' + encodeURIComponent(extra[k])); });
    location.hash = h + (q.length ? (h.indexOf('?') >= 0 ? '&' : '?') + q.join('&') : '');
  }

  /* ---------- busca por veículo (mesma regra do buscador do site) ---------- */
  function cilDe(txt) { var m = /(\d)[\.,](\d)/.exec(txt || ''); return m ? (+m[1] + +m[2] / 10) : 0; }
  function cilsDe(txt) { return (String(txt || '').match(/\d[\.,]\d/g) || []).map(function (x) { return +x.replace(',', '.'); }); }
  function motorCompat(motorApl, filtroMotor, cil) {
    if (filtroMotor) {
      if (motorApl === filtroMotor) return 2;
      if (!motorApl) return 1;
      /* o filtro "1.6" também vale para aplicações "1.0 / 1.6" ou "AP 1.6 / 1.8": compara as cilindradas;
         aplicação sem cilindrada no texto (ex.: "AP") pede confirmação */
      var cf = cilsDe(filtroMotor), ca = cilsDe(motorApl);
      if (!cf.length) return 0;
      if (!ca.length) return 1;
      return cf.some(function (c) { return ca.some(function (d) { return Math.abs(c - d) < 0.051; }); }) ? 2 : 0;
    }
    if (!cil) return 2;
    if (!motorApl) return 1;
    var cils = cilsDe(motorApl);
    if (!cils.length) return 1;
    return cils.some(function (c) { return Math.abs(c - cil) < 0.051; }) ? 2 : 0;
  }
  function buscarVeiculo(f) {
    return dadosBase().then(function () {
      /* marca fora do índice (link antigo ou digitado errado): lista vazia, sem pedir marcas/<x>.json (404) nem avisar "verifique a conexão" */
      if (!indice.marcas[f.marca]) return [{}, null];
      /* semDetalhes: o cartão do veículo na busca por texto não espera detalhes.json (a tabela marcas/<marca>.json já traz as aplicações) */
      return Promise.all([dadosMarca(f.marca), f.semDetalhes || detalhes ? null : dadosDetalhes().catch(function () { return null; })]);
    }).then(function (r) {
      var d = r[0], apls = d[f.modelo] || [], porProduto = {};
      apls.forEach(function (a) {
        if (f.ano && !((a[1] || 0) <= f.ano && f.ano <= a[2])) return;
        var mc = motorCompat(a[3], f.motor, f.cil); if (mc === 0) return;
        var p = produtos[a[0]]; if (!p || !p[3]) return;
        var cur = porProduto[a[0]];
        if (!cur || mc > cur.mc) porProduto[a[0]] = { i: a[0], p: p, a: a, mc: mc };
      });
      var itens = Object.keys(porProduto).map(function (k) { return porProduto[k]; });
      itens.sort(function (x, y) { return y.mc - x.mc || x.p[1].localeCompare(y.p[1], 'pt-BR') || x.p[0].localeCompare(y.p[0], 'pt-BR', { numeric: true }); });
      return itens;
    });
  }
  /* item(it) devolve o <li> de cada peça; a ordem dentro de cada linha é a ordem recebida */
  function listaAgrupada(itens, item) {
    var frag = document.createDocumentFragment(), grupos = {}, ordem = [];
    itens.forEach(function (it) {
      var l = linhaDe(it.p[0]).id;
      if (!grupos[l]) { grupos[l] = []; ordem.push(l); }
      grupos[l].push(it);
    });
    ordem.sort(function (a, b) { return LINHAS.findIndex(function (l) { return l.id === a; }) - LINHAS.findIndex(function (l) { return l.id === b; }); });
    ordem.forEach(function (l) {
      frag.appendChild(el('div', { class: 'grupo-cab' }, [el('h3', { text: LINHA_POR_ID[l].nome }), el('small', { text: plural(grupos[l].length, 'peça', 'peças') })]));
      var ul = el('ul', { class: 'lista' });
      grupos[l].forEach(function (it) { ul.appendChild(item(it)); });
      frag.appendChild(ul);
    });
    return frag;
  }

  /* ---------- painel de resultados: filtro por linha (com contagem), ordem e total ----------
     itens: [{ i, p, … }] já na ordem de relevância; item(it) devolve o <li>; agrupar: separa por linha enquanto não há filtro.
     O filtro vale só para a tela aberta; a ordem escolhida fica lembrada enquanto o app estiver aberto. */
  var ORDENS = [['relevancia', 'Relevância'], ['codigo', 'Código'], ['nome', 'Nome']];
  var ordemAtual = 'relevancia';
  function ordenar(itens, ordem) {
    if (ordem === 'codigo') return itens.slice().sort(function (a, b) { return a.p[0].localeCompare(b.p[0], 'pt-BR', { numeric: true }); });
    if (ordem === 'nome') return itens.slice().sort(function (a, b) { return a.p[1].localeCompare(b.p[1], 'pt-BR') || a.p[0].localeCompare(b.p[0], 'pt-BR', { numeric: true }); });
    return itens;
  }
  /* chips roláveis: envolve a fila e liga o degradê da borda direita (CSS .rolar-wrap.tem-mais) enquanto houver chips escondidos;
     o degradê some no fim da rolagem. wrap.conferir() refaz a conta depois de trocar os chips. */
  function rolavel(chips) {
    var wrap = el('div', { class: 'rolar-wrap' }, [chips]);
    function conferir() {
      wrap.classList.toggle('tem-mais', chips.scrollLeft + chips.clientWidth < chips.scrollWidth - 4);
      wrap.classList.toggle('tem-antes', chips.scrollLeft > 4); /* já rolou: há chips escondidos à esquerda */
    }
    chips.addEventListener('scroll', conferir, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(conferir).observe(chips); else setTimeout(conferir, 0);
    wrap.conferir = conferir;
    return wrap;
  }
  function painelResultados(itens, item, agrupar, filtroInicial, paginasIniciais) {
    /* paginasIniciais: páginas do "Mostrar mais" que já estavam abertas (a busca por texto refaz a lista quando detalhes.json
       chega e reabre as mesmas); vale só na 1ª montagem — trocar o filtro ou a ordem volta à 1ª página */
    var porLinha = {}, POR = 30, filtro = '', abrir = Math.max(1, +paginasIniciais || 1);
    itens.forEach(function (it) { var id = linhaDe(it.p[0]).id; porLinha[id] = (porLinha[id] || 0) + 1; });
    if (filtroInicial && porLinha[filtroInicial]) filtro = filtroInicial; /* já abre filtrado; "Todas" é o 1º chip */
    var linhas = LINHAS.filter(function (l) { return porLinha[l.id]; });
    var chips = null, botoes = {};
    if (linhas.length > 1) {
      chips = el('div', { class: 'chips rolar filtro-linhas', role: 'group', 'aria-label': 'Filtrar por linha de produto' });
      [{ id: '', nome: 'Todas', n: itens.length }].concat(linhas.map(function (l) { return { id: l.id, nome: l.nome, n: porLinha[l.id] }; })).forEach(function (f) {
        var b = el('button', { type: 'button', class: 'chip', text: f.nome + ' (' + f.n + ')' });
        b.addEventListener('click', function () { filtro = f.id; montar(); });
        botoes[f.id] = b; chips.appendChild(b);
      });
    }
    var cont = el('p', { class: 'res-cont' });
    var sel = el('select', { class: 'select select-mini', 'aria-label': 'Ordenar por' }, ORDENS.map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    sel.value = ordemAtual;
    sel.addEventListener('change', function () { ordemAtual = sel.value; montar(); });
    var corpo = el('div');
    var wrap = el('div', { class: 'painel-res' }, [chips && rolavel(chips), el('div', { class: 'res-barra' }, [cont, el('div', { class: 'select-wrap select-mini-wrap' }, [sel])]), corpo]);
    function montar() {
      wrap.setAttribute('data-filtro', filtro); /* a busca por texto lê o filtro (e data-paginas) ao refazer a lista quando detalhes.json chega */
      Object.keys(botoes).forEach(function (id) { var on = id === filtro; botoes[id].classList.toggle('ativo', on); botoes[id].setAttribute('aria-pressed', on ? 'true' : 'false'); });
      var vis = ordenar(filtro ? itens.filter(function (it) { return linhaDe(it.p[0]).id === filtro; }) : itens, ordemAtual);
      cont.innerHTML = ''; cont.appendChild(el('b', { text: String(vis.length) }));
      cont.appendChild(document.createTextNode((filtro ? ' de ' + itens.length : '') + ' ' + (vis.length === 1 && !filtro ? 'peça' : 'peças')));
      /* filtrado (pelo chip ou já ao abrir): "Todas" fica a um toque também aqui, mesmo com o chip rolado para fora */
      if (filtro && chips) { var tudo = el('button', { type: 'button', class: 'link-acao res-todas', text: 'Todas' }); tudo.addEventListener('click', function () { filtro = ''; montar(); chips.scrollLeft = 0; }); cont.appendChild(document.createTextNode(' · ')); cont.appendChild(tudo); }
      anunciar(plural(vis.length, 'peça encontrada', 'peças encontradas') + (filtro ? ' em ' + LINHA_POR_ID[filtro].nome : ''));
      corpo.innerHTML = '';
      if (agrupar && !filtro) { corpo.appendChild(listaAgrupada(vis, item)); return; }
      var ul = el('ul', { class: 'lista' }), pagina = 0;
      var mais = el('div', { class: 'mais' }, [el('button', { type: 'button', class: 'btn btn-neutro', text: 'Mostrar mais' })]);
      function maisItens() { vis.slice(pagina * POR, (pagina + 1) * POR).forEach(function (it) { ul.appendChild(item(it)); }); pagina++; mais.hidden = pagina * POR >= vis.length; wrap.setAttribute('data-paginas', String(pagina)); }
      mais.querySelector('button').addEventListener('click', maisItens);
      corpo.appendChild(ul); corpo.appendChild(mais);
      do { maisItens(); } while (pagina < abrir && !mais.hidden);
      abrir = 1;
    }
    montar();
    /* abriu já filtrado: o chip ativo entra na área visível, rolando o mínimo (sem rolar quando já aparece inteiro) */
    if (filtro && chips) requestAnimationFrame(function () { var a = chips.querySelector('.ativo'); if (a && a.offsetLeft + a.offsetWidth > chips.clientWidth) chips.scrollLeft = Math.max(0, a.offsetLeft + a.offsetWidth - chips.clientWidth + 28); }); /* +28: fora do degradê da borda */
    return wrap;
  }

  /* ---------- busca por texto (código, número original, nome, veículo) ----------
     Tolera erros de digitação (distância 1 em palavras com 5+ letras), prefixos ("estabiliz"), sinônimos
     (mangote = mangueira do filtro de ar), palavras coladas ("mangueirafiltroar"), acento opcional,
     número original com ou sem pontos/traços e ano dentro da aplicação ("gol 2010"). */
  var PARAR = { de: 1, do: 1, da: 1, dos: 1, das: 1, o: 1, a: 1, os: 1, as: 1, e: 1, para: 1, pra: 1, pro: 1, no: 1, na: 1, em: 1, um: 1, uma: 1, com: 1, ao: 1, mg: 1, peca: 1, pecas: 1 };
  /* sinônimos e erros comuns (do banco de palavras do site): token → alternativas separadas por "|"; cada alternativa pode ter mais de uma palavra */
  var SINONIMOS = {
    gm: 'chevrolet', generalmotors: 'chevrolet', xevrolet: 'chevrolet', chevy: 'chevrolet', vw: 'volkswagen', volks: 'volkswagen', fort: 'ford',
    reno: 'renault', renol: 'renault', renolt: 'renault', hernault: 'renault', hiunday: 'hyundai', rundai: 'hyundai', onda: 'honda', ondha: 'honda',
    citrom: 'citroen', pejo: 'peugeot', peujo: 'peugeot', jep: 'jeep', jipe: 'jeep', mb: 'mercedes', audy: 'audi', kya: 'kia', caoa: 'chery',
    corsinha: 'corsa', mile: 'mille', gool: 'gol', gowl: 'gol', corrola: 'corolla', ilux: 'hilux', mangera: 'mangueira', rabixo: 'rabicho', buxa: 'bucha', coxin: 'coxim',
    mangote: 'mangueira filtro ar', sanfona: 'mangueira|coifa', duto: 'duto|mangueira filtro', calco: 'coxim', bota: 'coifa', guarda: 'coifa',
    suporte: 'suporte|coxim', vaso: 'reservatorio', deposito: 'reservatorio', esguicho: 'limpador', cavalete: 'flange|carcaca',
    engate: 'conector|conexao', conexao: 'conexao|conector', conector: 'conector|conexao', cano: 'tubo|cano', balanca: 'bandeja', braco: 'braco|bandeja',
    termostato: 'termostato|termostatica', termostatica: 'termostatica|termostato', agua: 'agua|radiador|arrefecimento', dagua: 'agua',
    gasolina: 'combustivel', alimentacao: 'alimentacao|combustivel|tanque', turbo: 'turbo|intercooler', pressurizacao: 'intercooler',
    tirante: 'tirante|limitador', limitador: 'limitador|tirante', semi: 'homocinetica', eixo: 'eixo|homocinetica', borracha: 'borracha|guarnicao',
    dizel: 'diesel', disel: 'diesel', bicombustivel: 'flex', flexfuel: 'flex', totalflex: 'flex', mil: '1.0', '1000': '1.0', oleo: 'oleo|respiro'
  };
  /* desempate por linha: palavra da busca que não está no nome mas descreve a linha da peça (só conta quando outra
     palavra da busca casou com o veículo; "mangueira radiador corsa" traz também as mangueiras de arrefecimento do
     Corsa que não têm "radiador" no nome, depois das que têm). Nunca vale sozinha. */
  var LINHA_DE_TERMO = { radiador: 'arrefecimento' };
  var vocab = null, vocabFreq = null;
  function tokens(s) { return (sa(s).replace(/'/g, ' ').replace(/,(?=\d)/g, '.').match(/[a-z0-9]+(?:\.[0-9]+)?/g) || []); }
  function compacto(s) { return sa(s).replace(/[^a-z0-9]/g, ''); }
  function anosDe(txt) { /* "1996 a 2000", "2010 em diante", "até 2005", "2008" → [[ini, fim]] */
    var r = [];
    String(txt || '').split(/\s+e\s+/).forEach(function (t) {
      var n = (t.match(/\d{4}/g) || []).map(Number); if (!n.length) return;
      if (/diante/.test(t)) r.push([n[0], 9999]); else if (/at[eé]/.test(t)) r.push([1900, n[0]]); else r.push([n[0], n[n.length - 1]]);
    });
    return r;
  }
  function chaveCodigo(cod) {
    var m = /^MG[\s\-]*([A-Z]{0,2})[\s\-]*0*(\d+)([A-Z]*)$/i.exec(String(cod).trim());
    return m ? (m[1] + m[2] + m[3]).toLowerCase() : sa(cod).replace(/[^a-z0-9]/g, '');
  }
  var indiceBuscaComDetalhes = false;
  function montarIndiceBusca() {
    /* montado sem detalhes.json (busca parcial, cartão do veículo, 1º uso offline, falha de rede): a parte que vem de
       produtos.json (código, nome e linha) é montada uma vez só; quando as aplicações e os números originais chegam,
       as mesmas entradas ganham esses campos e só o vocabulário é recontado (CPU 4x: 45 ms a parte do nome, ~280 ms o
       resto; antes a lista inteira era refeita do zero, 323 ms) */
    if (indiceBusca && (indiceBuscaComDetalhes || !detalhes)) return indiceBusca;
    indiceBuscaComDetalhes = !!detalhes;
    vocabFreq = {};
    function conta(t) { vocabFreq[t] = (vocabFreq[t] || 0) + 1; }
    if (!indiceBusca) indiceBusca = produtos.map(function (p, i) {
      var tn = {}, cab = '', ntn = 0;
      tokens(p[1]).forEach(function (t) { if (!tn[t]) tn[t] = 1; if (!PARAR[t]) { ntn++; if (!cab) cab = t; } });
      var mr = /^MG[\s\-]*([A-Z]{0,2})[\s\-]*(\d+)([A-Z]*)$/i.exec(p[0].trim());
      return { i: i, pub: !!p[3], cod: p[0].toLowerCase(), chave: chaveCodigo(p[0]), bruto: mr ? (mr[1] + mr[2] + mr[3]).toLowerCase() : '',
        nome: sa(p[1]), tn: tn, ntn: ntn, cab: cab, tv: {}, lin: linhaDe(p[0]).id, comp: compacto(p[1]), vcomp: '', oems: [], anos: [] };
    });
    indiceBusca.forEach(function (e) {
      var p = produtos[e.i], d = detalheDe(p[0]), tv = {}, oems = [], anos = [], vtxt = [];
      Object.keys(e.tn).forEach(conta);
      (d.a || []).forEach(function (a) {
        vtxt.push(a[0]); if (a[1]) vtxt.push(a[1]);
        tokens(a[0] + ' ' + (a[1] || '')).forEach(function (t) { if (!tv[t]) { tv[t] = 1; conta(t); } });
        anosDe(a[2]).forEach(function (x) { anos.push(x); });
      });
      (d.m || []).forEach(function (m) { tokens(m).forEach(function (t) { if (!tv[t]) { tv[t] = 1; conta(t); } }); });
      (d.o || []).forEach(function (o) { oems.push(compacto(o)); });
      e.tv = tv; e.oems = oems; e.anos = anos; e.vcomp = compacto(vtxt.join(' ')); e.lin = d.l || e.lin;
    });
    vocab = Object.keys(vocabFreq).sort(function (a, b) { return vocabFreq[b] - vocabFreq[a]; });
    return indiceBusca;
  }
  /* distância de Damerau-Levenshtein ≤ 1 (troca, inserção, remoção ou transposição de letras vizinhas) */
  function dist1(a, b) {
    var la = a.length, lb = b.length, i = 0, j, k;
    if (la === lb) {
      for (; i < la && a[i] === b[i]; i++) {}
      if (i === la) return true;
      if (a.slice(i + 1) === b.slice(i + 1)) return true;
      return i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
    }
    if (Math.abs(la - lb) !== 1) return false;
    if (la > lb) { k = a; a = b; b = k; }
    for (; i < a.length && a[i] === b[i]; i++) {}
    for (j = i; j < a.length; j++) if (a[j] !== b[j + 1]) return false;
    return true;
  }
  /* palavras coladas ("mangueirafiltroar") → partes do vocabulário; no máximo 4 partes */
  function segmentar(t) {
    function rec(resto, n) {
      if (!resto) return [];
      if (n >= 4) return null;
      for (var len = Math.min(resto.length, 14); len >= 2; len--) {
        var w = resto.slice(0, len);
        if (vocabFreq[w] || (len <= 2 && PARAR[w])) { var r = rec(resto.slice(len), n + 1); if (r) return [w].concat(r); }
      }
      return null;
    }
    var r = rec(t, 0);
    return r && r.length > 1 ? r.filter(function (w) { return !PARAR[w]; }) : null;
  }
  /* para cada palavra da busca: { token → pontos } no vocabulário (3 exato, 2 prefixo, 1 parecido) */
  function casarVocab(t) {
    var m = {}, exato = !!vocabFreq[t], curto = t.length <= 2;
    if (exato) m[t] = 3;
    if (curto) return m;
    for (var i = 0; i < vocab.length; i++) {
      var v = vocab[i];
      if (v === t) continue;
      if (v.indexOf(t) === 0 && v.length <= t.length + 10) m[v] = 2;
      else if (!exato && t.length >= 5 && v.length >= 4 && /^[a-z]/.test(t) && dist1(t, v)) m[v] = 1;
    }
    return m;
  }
  function prepararTermos(toks) { /* lista de termos; cada termo tem alternativas (OU) de listas de tokens (E) */
    var termos = [], entendido = [], mudou = false;
    toks.forEach(function (t) {
      if (PARAR[t]) return;
      var alts;
      if (SINONIMOS[t]) { alts = SINONIMOS[t].split('|').map(function (a) { return a.split(' '); }); if (alts[0].join(' ') !== t) mudou = true; }
      else if (!vocabFreq[t] && t.length >= 7 && segmentar(t)) { alts = [segmentar(t)]; mudou = true; }
      else alts = [[t]];
      var cas = {};
      alts.forEach(function (a) { a.forEach(function (x) { if (!cas[x]) cas[x] = casarVocab(x); }); });
      /* palavra parecida (sem igual no vocabulário): mostra a correção ao usuário */
      alts[0].forEach(function (x) {
        if (vocabFreq[x]) { entendido.push(x); return; }
        var melhor = null; Object.keys(cas[x]).forEach(function (v) { if (cas[x][v] === 1 && (!melhor || vocabFreq[v] > vocabFreq[melhor])) melhor = v; });
        if (melhor) { entendido.push(melhor); mudou = true; } else entendido.push(x);
      });
      termos.push({ orig: t, alts: alts, cas: cas, ano: /^(19[5-9]\d|20[0-3]\d)$/.test(t) ? +t : 0, comp: t.replace(/[^a-z0-9]/g, '') });
    });
    return { termos: termos, entendido: mudou ? entendido.join(' ') : '' };
  }
  function pontosToken(e, x, cas, termo) {
    var best = 0, m = cas[x], ks = Object.keys(m), k;
    for (k = 0; k < ks.length; k++) {
      var v = ks[k], s = m[v];
      if (e.tn[v]) best = Math.max(best, s * 2 + (s === 3 ? 1 : 0) + (v === e.cab ? (termo.primeiro ? 4 : 1.5) : 0)); /* palavra principal do nome vale mais, ainda mais quando é a 1ª da busca ("mangueira radiador corsa" → mangueiras antes de conectores) */
      if (e.tv[v]) best = Math.max(best, s * 1.5);
    }
    if (best) return best;
    if (termo.ano && e.anos.some(function (a) { return termo.ano >= a[0] && termo.ano <= a[1]; })) return 4;
    var tc = termo.comp;
    if (tc.length >= 4 && /\d/.test(tc)) {
      if (tc === e.chave || (e.bruto && e.bruto.indexOf(tc) === 0)) return 6;
      for (k = 0; k < e.oems.length; k++) { if (e.oems[k] === tc) return 6; if (tc.length >= 5 && e.oems[k].indexOf(tc) >= 0) return 4; }
    }
    if (x.length >= 4 && (e.comp.indexOf(x) >= 0 || e.vcomp.indexOf(x) >= 0)) return 2;
    return 0;
  }
  function pontosTermo(e, termo) {
    var best = 0;
    for (var a = 0; a < termo.alts.length; a++) {
      var alt = termo.alts[a], soma = 0, ok = true;
      for (var j = 0; j < alt.length; j++) { var p = pontosToken(e, alt[j], termo.cas, termo); if (!p) { ok = false; break; } soma += p; }
      if (ok) best = Math.max(best, a === 0 ? soma : soma * 0.8);
    }
    return best;
  }
  /* alguma outra palavra da busca (além de "fora") casa com o veículo/montadora da peça? */
  function casaVeiculo(e, termos, fora) {
    return termos.some(function (t) {
      if (t === fora) return false;
      return Object.keys(t.cas).some(function (x) { return Object.keys(t.cas[x]).some(function (v) { return e.tv[v]; }); });
    });
  }
  /* quanto esperar por detalhes.json antes de responder só com o índice parcial: na rede boa ele chega nesse tempo e a
     lista já sai completa (sem repintar); no 3G (~8 s) a resposta parcial sai logo */
  var ESPERA_DETALHES = 400;
  function buscarTexto(q) {
    /* responde com o que já está no aparelho (indice/produtos: código MG, nome e linha) sem esperar detalhes.json
       (500 KB, ~8 s no 3G depois do índice): res.parcial = true avisa que número original e aplicação ainda não
       entraram, e a tela refaz a busca quando ele chega (montarIndiceBusca é refeito com as aplicações). */
    return dadosBase().then(function () {
      if (detalhes) return null;
      return Promise.race([dadosDetalhes().catch(function () { return null; }), new Promise(function (ok) { setTimeout(ok, ESPERA_DETALHES); })]);
    }).then(function () {
      var ix = montarIndiceBusca(), qs = sa(q), res = [];
      res.parcial = !detalhes;
      if (!qs) return res;
      var mCod = /^(?:mg)?[\s\-]*([a-z]{0,2})[\s\-]*(\d{1,5})\s*([a-z]{0,2})$/.exec(qs);
      var chave = mCod ? (mCod[1] + mCod[2].replace(/^0+/, '') + mCod[3]) : null;
      var bruto = mCod ? (mCod[1] + mCod[2] + mCod[3]) : null;
      var qn = qs.replace(/[^a-z0-9]/g, '');
      var prep = prepararTermos(tokens(qs)), termos = prep.termos, qcomp = compacto(qs);
      if (termos.length) termos[0].primeiro = true;
      ix.forEach(function (e) {
        if (!e.pub) return;
        var pts = 0, motivo = '';
        if (chave && e.chave === chave) { pts = 100; motivo = 'Código MG'; }
        else if (qn.length >= 4 && e.oems.some(function (o) { return o === qn; })) { pts = 95; motivo = 'Número original'; }
        else if (bruto && e.bruto && e.bruto.indexOf(bruto) === 0) { pts = 80; motivo = 'Código MG'; }
        else if (qn.length >= 5 && e.oems.some(function (o) { return o.indexOf(qn) >= 0; })) { pts = 70; motivo = 'Número original'; }
        else if (qn.length >= 3 && e.cod.replace(/[^a-z0-9]/g, '').indexOf(qn) >= 0) { pts = 55; motivo = 'Código MG'; }
        else if (termos.length) {
          var soma = 0, falhou = null;
          for (var k = 0; k < termos.length; k++) {
            var p = pontosTermo(e, termos[k]);
            if (p) { soma += p; continue; }
            /* no máximo uma palavra pode falhar, e só se ela descrever a linha da peça (desempate, 1 ponto) */
            if (falhou || LINHA_DE_TERMO[termos[k].orig] !== e.lin) { soma = 0; break; }
            falhou = termos[k];
          }
          if (soma && falhou && !casaVeiculo(e, termos, falhou)) soma = 0;
          if (soma && falhou) soma += 1;
          if (soma) pts = 20 + soma + (e.comp.indexOf(qcomp) === 0 ? 6 : 0) - e.ntn * 0.4; /* nomes mais curtos (mais genéricos) primeiro */
        }
        if (pts) res.push({ i: e.i, p: produtos[e.i], pts: pts, motivo: motivo });
      });
      /* número original digitado com um dígito errado, trocado, a mais ou a menos (ex.: 93378101 → 93378100, "O" no
         lugar de "0"): sem nenhum resultado, mostra os números parecidos e avisa para conferir na peça */
      if (!res.length && qn.length >= 7 && (qn.replace(/\D/g, '').length >= qn.length - 1)) {
        ix.forEach(function (e) {
          if (!e.pub) return;
          for (var k = 0; k < e.oems.length; k++) {
            if (Math.abs(e.oems[k].length - qn.length) <= 1 && dist1(qn, e.oems[k])) { res.push({ i: e.i, p: produtos[e.i], pts: 40, motivo: 'Número original parecido' }); break; }
          }
        });
        if (res.length) res.parecido = true;
      }
      res.sort(function (a, b) { return b.pts - a.pts || a.p[0].localeCompare(b.p[0], 'pt-BR', { numeric: true }); });
      res.entendido = prep.entendido && prep.entendido !== qs ? prep.entendido : '';
      return res;
    });
  }

  /* ---------- veículo reconhecido na busca por texto ---------- */
  /* "uno mille 1.0 2005", "vw fox 2012 1.6", "corsa mangueira radiador": acha marca/modelo (e ano/motor) da tabela de
     veículos no texto, com a mesma tolerância da busca (acento opcional, sinônimos vw/gm/mb, 1 letra diferente em
     palavras de 5+ letras — ou de 4 letras contra um nome curto de veículo — que não sejam nome de peça: "ponto" não vira
     Punto nem "tampa" vira Pampa, mas "gool" vira Gol e "uno mile" vira Uno Mille). Sem a marca,
     o modelo precisa ter letra, 3+ caracteres e existir em uma marca só ("Ônibus" existe em duas); número puro
     ("500", "147") só com a marca na frente. Só usa a tabela de veículos: nunca inventa aplicação. */
  var vocabVeic = null;
  function montarVocabVeic() {
    if (vocabVeic) return vocabVeic;
    var marcas = {}, modelos = [], nomes = {}, porModelo = {};
    Object.keys(indice.marcas).forEach(function (m) {
      var ts = tokens(m); marcas[ts.join(' ')] = m; if (ts.length > 1) marcas[ts[0]] = m;
      indice.marcas[m].forEach(function (mo) { var x = { marca: m, modelo: mo, toks: tokens(mo) }; modelos.push(x); (porModelo[mo] = porModelo[mo] || []).push(x); });
    });
    Object.keys(MARCA_MAP).forEach(function (k) { if (indice.marcas[MARCA_MAP[k]]) marcas[tokens(k).join(' ')] = MARCA_MAP[k]; });
    Object.keys(SINONIMOS).forEach(function (k) { var v = SINONIMOS[k].split('|')[0]; if (marcas[v] && !marcas[k]) marcas[k] = marcas[v]; });
    /* apelidos da placa ("mille" → Uno Mille, "weekend" → Palio Weekend, "crv" → CR-V) valem também aqui */
    Object.keys(MODELO_ALIAS).forEach(function (k) {
      var ts = tokens(k);
      (porModelo[MODELO_ALIAS[k]] || []).forEach(function (x) { if (x.toks.join(' ') !== ts.join(' ')) modelos.push({ marca: x.marca, modelo: x.modelo, toks: ts, alias: true }); });
    });
    produtos.forEach(function (p) { tokens(p[1]).forEach(function (t) { nomes[t] = 1; }); });
    vocabVeic = { marcas: marcas, modelos: modelos, nomes: nomes };
    return vocabVeic;
  }
  function reconhecerVeiculo(q) {
    var V = montarVocabVeic(), toks = tokens(sa(q)), usados = {}, i, j, n;
    /* 1 letra diferente: palavras de 5+ letras, ou de 4 letras contra um nome curto de veículo (3 a 5 letras: "gool"
       e "gowl" viram Gol, "mile" vira Mille); nunca para palavra que também é nome de peça ("tubo", "mola") */
    function casa(t, alvo) {
      if (t === alvo) return true;
      if (!/^[a-z]/.test(t) || V.nomes[t]) return false;
      if (t.length >= 5) return alvo.length >= 5 && dist1(t, alvo);
      return t.length === 4 && alvo.length >= 3 && alvo.length <= 5 && dist1(t, alvo);
    }
    /* marca: 2 palavras ("new holland", "mercedes benz") ou 1 (nome, sigla ou 1 letra diferente) */
    var marca = null;
    for (n = 2; n >= 1 && !marca; n--) for (i = 0; i + n <= toks.length && !marca; i++) {
      var cand = toks.slice(i, i + n).join(' '), m = V.marcas[cand] || null;
      if (!m && n === 1) Object.keys(V.marcas).some(function (k) { if (k.indexOf(' ') < 0 && casa(cand, k)) { m = V.marcas[k]; return true; } return false; });
      if (m) { marca = m; for (j = i; j < i + n; j++) usados[j] = 1; }
    }
    /* modelo: a sequência mais longa de palavras que casa com um modelo (da marca, se houver); exata vale mais que
       parecida; empate entre modelos de marcas diferentes sem a marca no texto = não dá para saber, sem cartão */
    var melhor = null;
    V.modelos.forEach(function (x) {
      if (marca && x.marca !== marca) return;
      var mt = x.toks, L = mt.length;
      if (!L || (!marca && L === 1 && (mt[0].length < 3 || !/[a-z]/.test(mt[0])))) return;
      for (var i = 0; i + L <= toks.length; i++) {
        var exatos = 0, ok = true;
        for (var j = 0; j < L && ok; j++) { if (usados[i + j]) ok = false; else if (toks[i + j] === mt[j]) exatos++; else if (!casa(toks[i + j], mt[j])) ok = false; }
        if (!ok) continue;
        var pts = L * 10 + exatos * 2 + (x.alias ? 0 : 1);
        if (!melhor || pts > melhor.pts) melhor = { marca: x.marca, modelo: x.modelo, pts: pts, ini: i, fim: i + L, ambiguo: false };
        else if (pts === melhor.pts && (x.marca !== melhor.marca || x.modelo !== melhor.modelo)) melhor.ambiguo = true;
      }
    });
    if (melhor && melhor.ambiguo) melhor = null;
    if (!marca && !melhor) return null;
    var ano = 0, motor = '', resto = [];
    toks.forEach(function (t, k) {
      if (usados[k] || (melhor && k >= melhor.ini && k < melhor.fim)) return;
      if (!ano && /^(19[5-9]\d|20[0-3]\d)$/.test(t)) ano = +t;
      else if (!motor && /^\d\.\d$/.test(t)) motor = t;
      else if (!motor && (t === 'mil' || t === '1000')) motor = '1.0';
      else if (!PARAR[t]) resto.push(t); /* o que sobrou é a peça ("mangueira radiador") */
    });
    return { marca: marca || melhor.marca, modelo: melhor ? melhor.modelo : '', ano: melhor ? ano : 0, motor: melhor ? motor : '', resto: resto };
  }
  /* cartão "Ver peças para Fiat Uno Mille 2005 1.0" acima dos resultados por texto. Conta as peças com os filtros
     reconhecidos; sem nenhuma com o motor (ou o ano), tira esse filtro, para o cartão nunca abrir uma tela vazia.
     Só a marca ("mangueira fiat"): abre a busca pelo veículo com a marca escolhida.
     Quando a busca também tem o nome da peça ("corsa mangueira radiador"), o cartão abre a tela do veículo já
     filtrada na linha em que essas palavras mais casam (Mangueiras de Arrefecimento), com "Todas" a um toque. */
  function linhaDoResto(resto, itens) {
    if (!resto.length || itens.length < 2) return '';
    var ix = montarIndiceBusca(), termos = prepararTermos(resto).termos, melhor = 0, porLinha = {}, linhas = {};
    if (!termos.length) return '';
    itens.forEach(function (it) {
      var e = ix[it.i]; if (!e) return;
      linhas[e.lin] = 1;
      var n = 0;
      termos.forEach(function (t) {
        var ok = LINHA_DE_TERMO[t.orig] === e.lin || t.alts.some(function (alt) {
          return alt.every(function (x) { return Object.keys(t.cas[x]).some(function (v) { return e.tn[v]; }); });
        });
        if (ok) n++;
      });
      if (!n) return;
      if (n > melhor) { melhor = n; porLinha = {}; }
      if (n === melhor) porLinha[e.lin] = (porLinha[e.lin] || 0) + 1;
    });
    if (!melhor || Object.keys(linhas).length < 2) return [];
    /* linhas em ordem de peças casando (até 3); a 2ª e a 3ª só entram quando empatam ou chegam perto da 1ª (pelo menos
       1/4 dela e 2 peças), para "corsa mangueira" (Respiro 24, Filtro de Ar 8, Arrefecimento 7) sugerir as três como
       chips e "corsa mangueira radiador" (só Arrefecimento casa as duas palavras) ficar com uma linha, já filtrada */
    var ls = Object.keys(porLinha).filter(function (l) { return LINHA_POR_ID[l]; }).sort(function (a, b) { return porLinha[b] - porLinha[a] || LINHA_POR_ID[a].nome.localeCompare(LINHA_POR_ID[b].nome, 'pt-BR'); });
    /* desempate: contagens próximas (diferença de 1 peça ou pelo menos 90% da maior do bloco) formam um bloco, e
       dentro dele vem primeiro a linha mais buscada no site (LINHA_BUSCAS); "golf mangueira" (Filtro de Ar 6,
       Arrefecimento 6, Respiro 5) sai Filtro de Ar, Respiro, Arrefecimento; "gol mangueira" (Respiro 23,
       Arrefecimento 16, Filtro de Ar 12) segue pela contagem, porque 12 está longe de 16 */
    var ordem = [], bloco = [];
    function perto(a, b) { return b - a <= 1 || a * 10 >= b * 9; }
    function fecharBloco() { bloco.sort(function (a, b) { return (LINHA_BUSCAS[b] || 0) - (LINHA_BUSCAS[a] || 0) || porLinha[b] - porLinha[a] || LINHA_POR_ID[a].nome.localeCompare(LINHA_POR_ID[b].nome, 'pt-BR'); }); ordem = ordem.concat(bloco); bloco = []; }
    ls.forEach(function (l) { if (bloco.length && !perto(porLinha[l], porLinha[bloco[0]])) fecharBloco(); bloco.push(l); });
    fecharBloco();
    return ordem.filter(function (l, i) { return i < 3 && porLinha[l] >= 2 && porLinha[l] * 4 >= porLinha[ordem[0]]; });
  }
  function cartaoVeiculoBusca(q) {
    var v = reconhecerVeiculo(q);
    if (!v) return Promise.resolve(null);
    function cartao(titulo, sub, href, chips) {
      var corpo = [
        el('span', { class: 'cv-icone' }, [svg(ICONES.carro)]),
        el('span', { class: 'cv-txt' }, [el('b', { text: titulo }), el('small', { text: sub })]),
        svg(ICONES.seta, { class: 'cv-seta' })
      ];
      if (!chips || !chips.length) return el('a', { class: 'cartao cartao-veic', href: href }, corpo);
      /* duas ou três linhas casam com as palavras da busca ("corsa mangueira"): a parte de cima abre o veículo inteiro
         e cada chip abre a tela já filtrada naquela linha, com a contagem de peças */
      return el('div', { class: 'cartao cartao-veic cartao-veic-linhas' }, [
        el('a', { class: 'cv-principal', href: href }, corpo),
        el('div', { class: 'chips cv-chips', role: 'group', 'aria-label': 'Ver só uma linha de produto' }, chips)
      ]);
    }
    if (!v.modelo) return Promise.resolve(cartao('Ver os modelos ' + v.marca, 'Escolha o modelo na busca pelo veículo', '#/busca?marca=' + encodeURIComponent(v.marca)));
    var tent = [], vistos = {};
    [[v.ano, v.motor], [v.ano, ''], [0, v.motor], [0, '']].forEach(function (t) { var k = t[0] + '|' + t[1]; if (!vistos[k]) { vistos[k] = 1; tent.push(t); } });
    function tentar(k) {
      if (k >= tent.length) return Promise.resolve(null);
      var t = tent[k];
      return buscarVeiculo({ marca: v.marca, modelo: v.modelo, ano: t[0], motor: t[1], semDetalhes: true }).then(function (itens) { return itens.length ? { ano: t[0], motor: t[1], itens: itens } : tentar(k + 1); });
    }
    return tentar(0).then(function (r) {
      if (!r) return null;
      var titulo = v.marca + ' ' + v.modelo + (r.ano ? ' ' + r.ano : '') + (r.motor ? ' ' + r.motor : '');
      var lins = linhaDoResto(v.resto || [], r.itens), n = r.itens.length, sub, chips = null;
      function naLinha(l) { return r.itens.filter(function (it) { return linhaDe(it.p[0]).id === l; }).length; }
      function href(l) { return hashVeiculo({ marca: v.marca, modelo: v.modelo, ano: r.ano, motor: r.motor, linha: l }); }
      if (lins.length === 1) sub = naLinha(lins[0]) + ' de ' + plural(n, 'peça', 'peças') + ' · ' + LINHA_POR_ID[lins[0]].nome;
      else if (lins.length) {
        sub = plural(n, 'peça', 'peças') + ' · toque em uma linha ou veja todas';
        chips = lins.map(function (l) { return el('a', { class: 'chip', href: href(l), text: LINHA_POR_ID[l].nome + ' (' + naLinha(l) + ')' }); });
      } else sub = plural(n, 'peça', 'peças') + ' na busca pelo veículo';
      return cartao('Ver peças para ' + titulo, sub, href(lins.length === 1 ? lins[0] : ''), chips);
    }).catch(function () { return null; });
  }

  /* ---------- placa ---------- */
  var MARCA_MAP = { 'vw': 'Volkswagen', 'volkswagen': 'Volkswagen', 'gm': 'Chevrolet', 'chevrolet': 'Chevrolet', 'chev': 'Chevrolet', 'chevr': 'Chevrolet', 'chevy': 'Chevrolet', 'gm chevrolet': 'Chevrolet', 'fiat': 'Fiat', 'ford': 'Ford', 'renault': 'Renault', 'peugeot': 'Peugeot', 'citroen': 'Citroën', 'toyota': 'Toyota', 'honda': 'Honda', 'hyundai': 'Hyundai', 'jeep': 'Jeep', 'nissan': 'Nissan', 'mercedes-benz': 'Mercedes-Benz', 'mercedes': 'Mercedes-Benz', 'm.benz': 'Mercedes-Benz', 'mbenz': 'Mercedes-Benz', 'iveco': 'Iveco', 'volvo': 'Volvo', 'scania': 'Scania', 'audi': 'Audi', 'seat': 'Seat', 'mitsubishi': 'Mitsubishi', 'mmc': 'Mitsubishi', 'kia': 'Kia', 'chery': 'Chery', 'caoa chery': 'Chery', 'bmw': 'BMW', 'mini': 'Mini', 'troller': 'Troller', 'dodge': 'Dodge', 'chrysler': 'Chrysler', 'ram': 'Ram', 'land rover': 'Land Rover', 'alfa romeo': 'Alfa Romeo', 'agrale': 'Agrale', 'lifan': 'Lifan', 'new holland': 'New Holland', 'case': 'Case', 'mack': 'Mack' };
  var MODELO_ALIAS = { 'palio weekend': 'Palio Weekend', 'weekend': 'Palio Weekend', 'corsa classic': 'Corsa Classic', 'classic': 'Corsa Classic', 'grand siena': 'Grand Siena', 'siena': 'Siena', 'novo uno': 'Uno', 'uno mille': 'Uno Mille', 'mille': 'Uno Mille', 'uno mile': 'Uno Mille', 'mile': 'Uno Mille', 'gool': 'Gol', 'gowl': 'Gol', 'uno': 'Uno', 'nova fiorino': 'Fiorino', 'nova strada': 'Strada', 'novo ka': 'Ka', 'ka+': 'Ka', 'new fiesta': 'Fiesta', 'new civic': 'Civic', 'novo fusca': 'Fusca', 'fusca': 'Fusca', 'new beetle': 'New Beetle', 'spacefox': 'SpaceFox', 'space fox': 'SpaceFox', 'crossfox': 'CrossFox', 'cross fox': 'CrossFox', 't-cross': 'T-Cross', 'tcross': 'T-Cross', 'ecosport': 'EcoSport', 'eco sport': 'EcoSport', 'hb20': 'HB20', 'hb20s': 'HB20', 'hb20x': 'HB20', 'ix35': 'ix35', 'cr-v': 'CR-V', 'crv': 'CR-V', 'hr-v': 'HR-V', 'hrv': 'HR-V', 'wr-v': 'WR-V', 'wrv': 'WR-V', 'santa fe': 'Santa Fe', 'l200 triton': 'L200 Triton', 'l200': 'L200', 'xsara picasso': 'Xsara Picasso', 'c3 aircross': 'C3 Aircross', 'aircross': 'C3 Aircross', 'c4 lounge': 'C4', 'c4 pallas': 'C4', 'grand cherokee': 'Grand Cherokee', 'cherokee': 'Cherokee', 'doblo': 'Doblò', 'premio': 'Prêmio', 'brasilia': 'Brasília', 'cordoba': 'Córdoba', 'up': 'up!', 'up!': 'up!', 's10': 'S10', 's-10': 'S10', 'f1000': 'F-1000', 'f-1000': 'F-1000', 'f250': 'F-250', 'f-250': 'F-250', 'f350': 'F-350', 'f-350': 'F-350', 'f4000': 'F-4000', 'f-4000': 'F-4000', 'd20': 'D-20', 'd-20': 'D-20', 'c20': 'C-20', 'a20': 'A-20', 'megane': 'Mégane', 'scenic': 'Scénic', 'grand scenic': 'Scénic', 'sandero stepway': 'Sandero', 'stepway': 'Sandero', 'logan': 'Logan', 'polo sedan': 'Polo Sedan', 'polo classic': 'Polo Classic', 'passat cc': 'Passat CC', 'corolla cross': 'Corolla Cross', 'sw4': 'SW4', 'hilux sw4': 'SW4', 'tornado': 'Tornado 250', 'cg 250 tornado': 'Tornado 250' };
  var GERACAO = /^(g[2-7]|i{1,3}|iv|v|vi|[0-9]{4}|\d\.\d.*|2p|4p|hatch|sedan|sw|cs|cd|cab|cabine|dupla|simples|flex|total|totalflex|mi|mpi|mpfi|efi|fire|evo|vhc|vhce|spe|8v|12v|16v|20v|tsi|tdi|tfsi|at|ap|turbo|diesel|4x2|4x4|gl|gls|ls|lt|ltz|lx|ex|elx|edx|xr|xrs|gt|gti|gsi|highline|comfortline|trendline|sportline|attractive|premium|limited|longitude|sport|automatico|automatica|manual|cvt|dualogic|economy|essence|dynamique|expression|authentique|privilege|way|adventure|trekking|freedom|titanium|sel|se|s|xl|xls|xlt|plus|life|evolution|hgt|drive|precision|connect|move|spirit|style|pack|rs|sv|sl|sr|xei|gli|seg|altis|exl|exr|lxr|lxl|elite|turbodiesel|td|tb|tce|sce|cel|1\.0|1\.3|1\.4|1\.5|1\.6|1\.8|2\.0|2\.4|2\.8|3\.0|3\.2|.*\d+cv)$/i;
  function normalizarPlaca(p) { return (p || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function placaValida(p) { return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p); }
  function casarVeiculo(info) {
    var marcaRaw = sa(info.brand || '').replace(/^(i|imp|imp\.)\//, '').replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
    var marca = null;
    Object.keys(MARCA_MAP).sort(function (a, b) { return b.length - a.length; }).some(function (k) {
      if (marcaRaw === k || marcaRaw.indexOf(k + ' ') === 0 || marcaRaw.indexOf(k + '/') === 0) { marca = MARCA_MAP[k]; return true; } return false;
    });
    var modeloRaw = sa((info.model || '') + ' ' + (info.version || '')).replace(/[\/,]/g, ' ').replace(/\s+/g, ' ').trim();
    Object.keys(MARCA_MAP).forEach(function (k) { if (modeloRaw.indexOf(k + ' ') === 0) modeloRaw = modeloRaw.slice(k.length + 1); });
    var toks = modeloRaw.split(' ').filter(Boolean);
    var modelos = marca && indice.marcas[marca] ? indice.marcas[marca] : [];
    var porChave = {}; modelos.forEach(function (m) { porChave[sa(m)] = m; });
    Object.keys(MODELO_ALIAS).forEach(function (k) { if (porChave[sa(MODELO_ALIAS[k])]) porChave[k] = porChave[sa(MODELO_ALIAS[k])]; });
    var modelo = null, usados = 0, ini = 0;
    while (ini < toks.length && /^(novo|nova|new|novos)$/.test(toks[ini])) ini++;
    for (var n = 3; n >= 1 && !modelo; n--) {
      var cand = toks.slice(ini, ini + n).join(' ');
      if (cand && porChave[cand]) { modelo = porChave[cand]; usados = ini + n; }
      if (!modelo && cand && porChave[toks.slice(0, ini + n).join(' ')]) { modelo = porChave[toks.slice(0, ini + n).join(' ')]; usados = ini + n; }
    }
    if (!modelo && toks.length) {
      var t0 = toks[ini];
      modelos.some(function (m) { var km = sa(m).split(' '); if (km[0] !== t0 || GERACAO.test(t0)) return false; if (km.length > 1 && toks.indexOf(km[1]) < 0) return false; modelo = m; usados = ini + 1; return true; });
    }
    var cil = cilDe(toks.slice(usados).join(' ')) || cilDe(info.version) || (info.engine_cc ? Math.round(info.engine_cc / 100) / 10 : 0);
    var ano = +(info.model_year || info.year || 0) || 0;
    return { marca: marca, modelo: modelo, ano: ano, cil: cil };
  }
  function consultarPlaca(placa) {
    if (!CFG.placaUrl) return Promise.reject(Object.assign(new Error('sem serviço'), { codigo: 0 }));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 15000);
    return fetch(CFG.placaUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ placa: placa }), signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        /* o corpo pode não ser JSON (erro do Cloudflare, página de bloqueio): nunca derruba a leitura do status */
        return r.text().then(function (t) {
          var j = null; try { j = JSON.parse(t); } catch (e) {}
          if (!r.ok) throw Object.assign(new Error((j && j.erro) || ('HTTP ' + r.status)), { codigo: r.status });
          if (!j || typeof j !== 'object') throw Object.assign(new Error('resposta inválida'), { codigo: 502 });
          return j;
        });
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }
  /* Por que a consulta falhou (sem a placa em nenhuma mensagem nem no console):
     'bloqueada'  — o Worker ainda não libera a origem do app (CORS: o fetch cai em TypeError com internet) ou respondeu 403;
                    assim que a origem entrar na lista do Worker, a mesma chamada passa a funcionar sem mudar o app.
     'offline', 'demorou', 'nao-encontrada' (404), 'limite' (429), 'servico' (5xx) e 'outro'. */
  function motivoFalhaPlaca(e) {
    if (!navigator.onLine) return 'offline';
    if (e && e.name === 'AbortError') return 'demorou';
    if (e && (e.codigo === 403 || (!e.codigo && e instanceof TypeError))) return 'bloqueada';
    if (e && (e.codigo === 404 || /n[aã]o encontrad/i.test(e.message || ''))) return 'nao-encontrada';
    if (e && e.codigo === 429) return 'limite';
    if (e && e.codigo >= 500) return 'servico';
    return 'outro';
  }
  var MSG_PLACA = {
    bloqueada: 'A busca pela placa ainda está sendo liberada para o app. Enquanto isso, busque pelo veículo ou pelo código.',
    offline: 'Sem conexão. A busca pela placa precisa de internet; você pode buscar escolhendo marca, modelo e ano.',
    demorou: 'A consulta demorou demais. Tente de novo ou busque pelo veículo.',
    'nao-encontrada': 'Não encontramos o veículo desta placa. Confira os caracteres ou busque pelo veículo.',
    limite: 'Muitas consultas em pouco tempo. Aguarde um minuto e tente de novo.',
    servico: 'O serviço de consulta de placa está fora do ar no momento. Busque pelo veículo enquanto isso.',
    outro: 'Não conseguimos consultar a placa agora. Você pode buscar escolhendo marca, modelo e ano.'
  };
  function campoPlaca(valorInicial) {
    /* a última placa digitada fica só na sessão (sessionStorage): ao voltar da lista o campo já vem preenchido;
       some ao fechar o app e nunca vai para o localStorage, para o endereço nem para o console */
    var inp = el('input', { type: 'text', class: 'entrada-placa', maxlength: '8', placeholder: 'Digite a placa', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text', 'aria-label': 'Placa do veículo', value: valorInicial || ss('mg-placa-sessao') || '' });
    inp.addEventListener('input', function () { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); ss('mg-placa-sessao', inp.value || null); });
    var wrap = el('div', { class: 'placa-wrap' }, [
      el('div', { class: 'placa-topo', 'aria-hidden': 'true' }, [el('span', { class: 'bandeira' }), el('span', { text: 'BRASIL' }), el('span', { text: 'BR' })]),
      inp
    ]);
    return { wrap: wrap, input: inp };
  }
  function executarPlaca(placaDigitada, btn, area) {
    var placa = normalizarPlaca(placaDigitada);
    area.innerHTML = '';
    if (!placaValida(placa)) { area.appendChild(status('Digite uma placa válida, por exemplo ABC1D23 ou ABC1234.', 'aviso')); return; }
    btn.disabled = true; btn.classList.add('carregando');
    area.appendChild(status('Consultando a placa ' + placa + '…', 'info'));
    dadosBase().then(function () { return consultarPlaca(placa); }).then(function (j) {
      var v = j.veiculo || j, c = casarVeiculo(v);
      var descr = [v.brand, v.model, v.version, (v.model_year || v.year)].filter(Boolean).join(' ');
      if (!c.marca || !indice.marcas[c.marca]) {
        area.innerHTML = ''; area.appendChild(status(descr + ' — a MG ainda não tem peças cadastradas para a marca ' + (v.brand || 'informada') + '.', 'aviso')); return;
      }
      /* a placa fica só na memória desta sessão (não vai para o endereço nem para o localStorage) */
      placaAtual = placa; ss('mg-placa-sessao', placa);
      if (!c.modelo) {
        location.hash = '#/busca?marca=' + encodeURIComponent(c.marca) + '&descr=' + encodeURIComponent(descr) + '&via=placa'; return;
      }
      irVeiculo(c.marca, c.modelo, c.ano, '', { via: 'placa', descr: descr, cil: c.cil ? c.cil.toFixed(1) : '' });
    }).catch(function (e) {
      var motivo = motivoFalhaPlaca(e);
      area.innerHTML = '';
      /* liberação pendente não é falha do usuário: aviso informativo; placa inexistente e limite: atenção; o resto: erro */
      area.appendChild(status(MSG_PLACA[motivo], motivo === 'bloqueada' ? 'info' : (motivo === 'nao-encontrada' || motivo === 'limite' ? 'aviso' : 'erro')));
      area.appendChild(el('div', { class: 'campo' }, [el('a', { class: 'btn btn-contorno', href: '#/busca' }, [svg(ICONES.carro), 'Buscar pelo veículo'])]));
      if (motivo === 'bloqueada' || motivo === 'nao-encontrada') area.appendChild(el('div', { class: 'campo' }, [el('a', { class: 'btn btn-neutro', href: '#/busca' }, [svg(ICONES.busca), 'Buscar por código ou nome'])]));
      anunciar(MSG_PLACA[motivo]);
      /* no console vai só o tipo da falha (nunca a placa) */
      if (window.console) console.warn('placa: ' + motivo + ' (' + ((e && e.name) || '') + (e && e.codigo ? ' ' + e.codigo : '') + ')');
    }).then(function () { btn.disabled = false; btn.classList.remove('carregando'); });
  }

  /* ---------- recentes: últimos veículos (só marca, modelo, ano e motor; a placa e a descrição da consulta nunca são gravadas)
     e últimas buscas por texto, guardados no aparelho ---------- */
  var placaAtual = null, REC_VEIC = 5, REC_BUSCA = 8;
  function recentesVeiculos() { var l = lsJson('mg-recentes'); return Array.isArray(l) ? l.filter(function (x) { return x && x.marca && x.modelo; }) : []; }
  function recentesBuscas() { var l = lsJson('mg-buscas'); return Array.isArray(l) ? l.filter(function (x) { return typeof x === 'string' && x; }) : []; }
  function guardarRecente(r) {
    var novo = { marca: r.marca, modelo: r.modelo, ano: r.ano || 0, motor: r.motor || '' };
    var lista = recentesVeiculos().filter(function (x) { return !(x.marca === novo.marca && x.modelo === novo.modelo && (x.ano || 0) === novo.ano && (x.motor || '') === novo.motor); });
    lista.unshift(novo); lsJson('mg-recentes', lista.slice(0, REC_VEIC));
  }
  function guardarBusca(q) {
    q = String(q || '').trim().slice(0, 60); if (!q) return;
    var lista = recentesBuscas().filter(function (x) { return sa(x) !== sa(q); });
    lista.unshift(q); lsJson('mg-buscas', lista.slice(0, REC_BUSCA));
  }
  function limparRecentes() { ls('mg-recentes', null); ls('mg-buscas', null); }
  function hashVeiculo(r) {
    var q = []; if (r.motor) q.push('motor=' + encodeURIComponent(r.motor)); if (r.linha) q.push('linha=' + encodeURIComponent(r.linha));
    return '#/veiculo/' + encodeURIComponent(r.marca) + '/' + encodeURIComponent(r.modelo) + '/' + (r.ano || '') + (q.length ? '?' + q.join('&') : '');
  }
  /* seção "Recentes" (Início e Busca): chips que refazem a busca por veículo ou por texto, e "Limpar" */
  function chipsRecentes() {
    var veics = recentesVeiculos(), buscas = recentesBuscas();
    if (!veics.length && !buscas.length) return null;
    var limpar = el('button', { type: 'button', class: 'link-acao', 'aria-label': 'Limpar recentes', text: 'Limpar' });
    var chips = veics.map(function (r) {
      var txt = r.marca + ' ' + r.modelo + (r.ano ? ' ' + r.ano : '') + (r.motor ? ' · ' + r.motor : '');
      return el('a', { class: 'chip', href: hashVeiculo(r), title: 'Peças para ' + txt }, [svg(ICONES.carro), el('span', { class: 'chip-txt', text: txt })]);
    }).concat(buscas.map(function (q) {
      return el('a', { class: 'chip', href: '#/busca?q=' + encodeURIComponent(q), title: 'Buscar “' + q + '”' }, [svg(ICONES.busca), el('span', { class: 'chip-txt', text: q })]);
    }));
    var sec = el('section', { class: 'secao recentes' }, [
      el('div', { class: 'secao-cab' }, [el('h2', { text: 'Recentes' }), limpar]),
      el('div', { class: 'chips' }, chips)
    ]);
    limpar.addEventListener('click', function () { limparRecentes(); sec.remove(); toast('Recentes apagados'); });
    return sec;
  }

  /* ---------- topo / navegação ---------- */
  var topo = document.getElementById('topo'), tela = document.getElementById('conteudo');
  function temaEscuro() {
    var t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function botaoTema() {
    var atual = temaEscuro() ? 'dark' : 'light';
    var b = el('button', { type: 'button', class: 'btn-icone', 'aria-label': atual === 'dark' ? 'Usar tema claro' : 'Usar tema escuro', title: 'Tema' }, [svg(atual === 'dark' ? ICONES.sol : ICONES.lua)]);
    b.addEventListener('click', function () { aplicarTema(atual === 'dark' ? 'light' : 'dark'); renderizar(); var nb = topo.querySelector('.btn-icone[title="Tema"]'); if (nb) nb.focus(); });
    return b;
  }
  /* cor da barra de status/endereço (Android, Chrome): acompanha o tema escolhido, não só o do sistema */
  function corDoTema() {
    var cor = temaEscuro() ? '#141c2b' : '#0b4ea2';
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', cor); });
  }
  function aplicarTema(t) {
    if (t === 'auto' || !t) { document.documentElement.removeAttribute('data-theme'); ls('mg-tema', null); }
    else { document.documentElement.setAttribute('data-theme', t); ls('mg-tema', t); }
    corDoTema();
  }
  /* só o logo original da MG; no tema escuro ele aparece sobre um chip branco (CSS --logo-chip) */
  function logoSrc() { return 'icones/logo-mg.png'; }
  function setTopo(o) {
    topo.innerHTML = '';
    if (o.inicio) {
      topo.appendChild(el('a', { class: 'topo-logo-link', href: '#/', 'aria-label': 'MG Peças Automotivas – início' }, [el('img', { class: 'topo-logo', src: logoSrc(), alt: 'MG Peças Automotivas', width: '708', height: '267' })]));
      topo.appendChild(botaoTema());
      topo.appendChild(el('a', { class: 'btn-icone', href: '#/sobre', 'aria-label': 'Sobre a MG' }, [svg(ICONES.info)]));
    } else {
      var voltar = el('button', { type: 'button', class: 'btn-icone voltar', 'aria-label': 'Voltar' }, [svg(ICONES.voltar)]);
      voltar.addEventListener('click', function () { if (history.length > 1) history.back(); else location.hash = o.voltarPara || '#/'; });
      topo.appendChild(voltar);
      topo.appendChild(el('h1', { class: 'topo-titulo' }, [o.titulo || '', o.sub ? el('span', { class: 'topo-sub', text: o.sub }) : null]));
      if (o.acao) topo.appendChild(o.acao);
    }
    document.title = (o.inicio ? 'MG Peças Automotivas' : (o.titulo || '') + ' · MG Peças');
  }
  /* abas inferiores: aria-selected e tabindex "rotativo" (só a aba ativa entra na sequência do Tab; as setas trocam o foco) */
  var abas = Array.prototype.slice.call(document.querySelectorAll('.aba'));
  function setAba(nome) {
    var temAtiva = abas.some(function (a) { return a.getAttribute('data-aba') === nome; });
    abas.forEach(function (a, i) {
      var on = a.getAttribute('data-aba') === nome;
      a.classList.toggle('ativa', on); a.setAttribute('aria-selected', on ? 'true' : 'false');
      a.setAttribute('tabindex', on || (!temAtiva && i === 0) ? '0' : '-1');
    });
  }
  document.querySelector('.abas').addEventListener('keydown', function (e) {
    var i = abas.indexOf(document.activeElement); if (i < 0) return;
    var j = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % abas.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + abas.length) % abas.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = abas.length - 1;
    else if (e.key === ' ') { e.preventDefault(); abas[i].click(); return; }
    else return;
    e.preventDefault();
    abas.forEach(function (a, k) { a.setAttribute('tabindex', k === j ? '0' : '-1'); });
    abas[j].focus();
  });
  /* "Ir para o conteúdo": o app usa #/rotas no hash, então o link não pode mudar o hash; só move o foco */
  document.querySelector('.pular').addEventListener('click', function (e) { e.preventDefault(); tela.focus(); });
  /* anúncio para leitores de tela (região viva, polida): troca de tela, contagem de resultados, avisos */
  var anuncio = document.getElementById('anuncio'), anuncioTimer = null;
  function anunciar(msg) {
    clearTimeout(anuncioTimer);
    anuncio.textContent = '';
    anuncioTimer = setTimeout(function () { anuncio.textContent = msg; }, 60);
  }
  function rota() {
    var h = location.hash.replace(/^#\/?/, ''), q = {};
    var i = h.indexOf('?');
    /* trecho mal codificado ("%E0") fica como veio: um link quebrado não pode derrubar a tela inteira */
    function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
    if (i >= 0) { h.slice(i + 1).split('&').forEach(function (par) { var kv = par.split('='); q[dec(kv[0])] = dec((kv[1] || '').replace(/\+/g, ' ')); }); h = h.slice(0, i); }
    var partes = h.split('/').map(dec);
    return { nome: partes[0] || '', partes: partes, q: q };
  }
  /* a tela recebe a classe .entrada-tela; o espaçamento entre os blocos dela é `.entrada-tela > * + *` no CSS,
     por isso quem chama passa um <div> com os blocos (um cartão sozinho vai dentro de um div) */
  var primeiraTela = true;
  function mostrar(node) {
    tela.innerHTML = ''; node.classList.add('entrada-tela'); tela.appendChild(node); restaurarRolagem();
    /* ao trocar de tela, o foco vai para o conteúdo (leitor de tela e teclado começam do início da tela nova);
       na 1ª abertura fica onde está. As telas Placa e Busca levam o foco para o campo logo depois. */
    if (!primeiraTela) { try { tela.focus({ preventScroll: true }); } catch (e) { tela.focus(); } anunciar(document.title.replace(' · MG Peças', '')); }
    primeiraTela = false;
  }

  /* ---------- rolagem por tela ----------
     Cada entrada do histórico ganha um id (history.state.mgTela). Ao sair de uma tela, a posição de rolagem fica guardada
     por esse id; ao voltar pelo histórico (Início → Placa → voltar), a tela abre onde estava, em vez de pular para o topo.
     Uma tela nova abre no topo. Trocar o tema no topo (renderizar na mesma entrada) também mantém a posição. As telas que
     montam a lista depois (ficha, resultados) voltam a aplicar a posição por até 1,5 s, enquanto a página cresce; o
     usuário rolando (toque ou roda do mouse) cancela. O navegador não restaura sozinho (scrollRestoration manual),
     senão ele e o app brigariam pela posição. */
  var rolagens = {}, idTela = null, rolagemAlvo = 0, rolagemQuadro = 0, contadorTela = 0;
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
  function idDaEntrada() {
    var st = history.state, id = st && st.mgTela;
    if (!id) { id = 't' + Date.now().toString(36) + '-' + (++contadorTela); try { history.replaceState(Object.assign({}, st || {}, { mgTela: id }), ''); } catch (e) {} }
    return id;
  }
  function lembrarRolagem() { if (idTela) rolagens[idTela] = window.scrollY; }
  function pararRestauro() { cancelAnimationFrame(rolagemQuadro); window.removeEventListener('touchstart', pararRestauro); window.removeEventListener('wheel', pararRestauro); }
  function restaurarRolagem() {
    pararRestauro();
    var y = rolagemAlvo, quadros = 0, fim = Date.now() + 1500;
    window.scrollTo(0, y);
    if (!y) return;
    window.addEventListener('touchstart', pararRestauro, { passive: true }); window.addEventListener('wheel', pararRestauro, { passive: true });
    (function tenta() {
      window.scrollTo(0, y); quadros++;
      var cabe = document.documentElement.scrollHeight - window.innerHeight >= y - 1;
      if ((cabe && quadros >= 2) || Date.now() > fim) { pararRestauro(); return; }
      rolagemQuadro = requestAnimationFrame(tenta);
    })();
  }

  /* ---------- telas ---------- */
  function telaInicio() {
    setTopo({ inicio: true }); setAba('inicio');
    /* pedido do Filipe: a maioria procura pelo código, número original ou nome, então o campo de texto vem primeiro, em uma
       linha só (campo + botão), depois o veículo em cartão compacto; a placa fica num cartão discreto perto do fim (a aba
       Placa continua na barra). A tela não tem mais o cartão azul grande nem a chamada longa. */
    var secBusca = el('section', { class: 'secao secao-busca' }, [
      el('h1', { class: 'visualmente-oculto', text: 'Catálogo MG Peças Automotivas' }),
      campoBusca('')
    ]);
    var secVeic = el('section', { class: 'secao' }, [
      el('div', { class: 'cartao cartao-compacto' }, [
        el('h2', { class: 'titulo-cartao', text: 'Buscar pelo veículo' }),
        seletorVeiculo()
      ])
    ]);
    var grade = el('div', { class: 'grade-linhas' });
    var secLinhas = el('section', { class: 'secao' }, [
      el('div', { class: 'secao-cab' }, [el('h2', { text: 'Linhas de produtos' }), el('a', { class: 'link', href: '#/linhas', text: 'Ver todas' })]),
      grade
    ]);
    preencherLinhas(grade, 6);
    /* cartão discreto da placa: uma linha com seta, abre a tela Placa (a explicação de privacidade fica lá) */
    var cartaoPlaca = el('a', { class: 'cartao cartao-link cartao-placa', href: '#/placa' }, [
      el('span', { class: 'cartao-link-ic' }, [svg(ICONES.placa)]),
      el('span', { class: 'cartao-link-txt' }, [el('b', { text: 'Tem a placa?' }), el('span', { text: 'Buscar pela placa' })]),
      el('span', { class: 'cartao-link-seta' }, [svg(ICONES.seta)])
    ]);
    var instalar = cartaoInstalar();
    var node = el('div', { class: 'inicio' }, [secBusca, secVeic, secaoMinhas(), chipsRecentes(), secLinhas, cartaoPlaca, instalar,
      el('p', { class: 'nota-legal', text: 'MG Peças Automotivas · Diadema-SP · Fabricante nacional de mangueiras, peças de arrefecimento, suspensão e plásticas.' })
    ]);
    mostrar(node);
  }
  /* campo "Código, nº original ou nome" com o botão Buscar na mesma linha (Início e tela Busca); o botão vira só o ícone
     quando a linha é estreita (CSS, consulta de contêiner). Enter ou o botão abrem #/busca?q=; com o campo vazio, só foca. */
  function campoBusca(termo) {
    var inp = el('input', { type: 'search', class: 'entrada', placeholder: 'Código, nº original ou nome', value: termo || '', 'aria-label': 'Buscar peça por código, número original ou nome', autocomplete: 'off', enterkeyhint: 'search' });
    /* um × só: o do app (o nativo do type=search fica escondido no CSS, senão apareciam dois lado a lado); some com o campo
       vazio; nos resultados, limpar volta para a tela Busca vazia; no Início só esvazia o campo e mantém o foco */
    var limpar = el('button', { type: 'button', class: 'limpar', 'aria-label': 'Limpar', text: '×', hidden: !termo, tabindex: '-1' }); /* fora do Tab: do campo o Tab vai direto ao Buscar (Esc no campo já limpa); o × continua para o toque e o mouse */
    limpar.addEventListener('click', function () { inp.value = ''; limpar.hidden = true; if (termo) location.hash = '#/busca'; else inp.focus(); });
    inp.addEventListener('input', function () { limpar.hidden = !inp.value; });
    function enviar() { var v = inp.value.trim(); if (v) location.hash = '#/busca?q=' + encodeURIComponent(v); else inp.focus(); }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') enviar(); });
    var btn = el('button', { type: 'button', class: 'btn btn-primario btn-buscar', 'aria-label': 'Buscar' }, [svg(ICONES.busca), el('span', { text: 'Buscar' })]);
    btn.addEventListener('click', enviar);
    var wrap = el('div', { class: 'busca-linha' }, [el('div', { class: 'entrada-wrap' }, [svg(ICONES.busca), inp, limpar]), btn]);
    wrap.input = inp;
    return wrap;
  }
  function preencherLinhas(grade, max) {
    grade.innerHTML = '';
    var alvo = max ? LINHAS.slice(0, max) : LINHAS;
    alvo.forEach(function (l) {
      grade.appendChild(el('a', { class: 'linha-card', href: '#/linha/' + l.id }, [
        /* caixa da foto: esqueleto até a foto chegar; o ícone da linha fica dentro e só aparece se não houver foto */
        el('span', { class: 'linha-foto aguardando' }, [svg(ICONES_LINHA[l.id])]),
        el('span', { class: 'linha-txt' }, [el('b', { text: l.nome }), el('small', { class: 'cont', text: '…' })])
      ]));
    });
    var cards = grade.querySelectorAll('.linha-card');
    /* fotos das linhas: precisam de produtos.json (posição da peça) e imagens.json; sem rede no 1º acesso, ficam os ícones */
    dadosBase().then(dadosImagens).catch(function () { return null; }).then(function () {
      cards.forEach(function (a, i) { fotoLinha(a.querySelector('.linha-foto'), alvo[i]); });
    });
    /* com a linha em produtos.json as contagens saem dos arquivos pequenos (3G: ~6 s em vez de ~28 s); sem ela, espera detalhes.json */
    dadosBase().then(function () { return linhasNoIndice() ? null : dadosDetalhes().catch(function () { return null; }); }).then(function () {
      var cont = {}; produtos.forEach(function (p) { if (p[3]) { var id = linhaDe(p[0]).id; cont[id] = (cont[id] || 0) + 1; } });
      cards.forEach(function (a, i) { var n = cont[alvo[i].id] || 0; a.querySelector('.cont').textContent = plural(n, 'peça', 'peças'); if (!n && !max) a.hidden = true; });
    });
  }
  /* troca o esqueleto da caixa pela foto da peça típica da linha (FOTO_LINHA, 320 px, carregamento preguiçoso); sem
     imagens.json, sem código publicado com foto ou com a foto falhando (CDN fora do ar, offline), mostra o ícone da linha */
  function fotoLinha(box, l) {
    var cod = FOTO_LINHA[l.id], i = cod && produtos ? porCodigo[cod.toUpperCase()] : null, p = i != null ? produtos[i] : null;
    var src = p && p[3] ? fotoDe(i, 320) : null;
    function icone() { box.classList.remove('aguardando'); box.classList.add('icone'); }
    function pronto() { box.classList.remove('aguardando'); box.classList.add('ok'); }
    if (!src) { icone(); return; }
    /* alt vazio: a foto é ilustrativa e o nome do link é o da linha (com o nome da peça no alt, o leitor de tela anunciava
       "Mangueira do Filtro de Ar (MG001) Mangueiras do Filtro de Ar", como se o cartão abrisse a peça) */
    var img = el('img', { src: src, alt: '', loading: 'lazy', decoding: 'async', width: '320', height: '176' });
    img.addEventListener('load', pronto);
    img.addEventListener('error', function () { img.remove(); icone(); });
    box.appendChild(img);
    if (img.complete && img.naturalWidth) pronto();
  }
  function telaPlaca(q) {
    setTopo({ titulo: 'Busca pela placa', voltarPara: '#/' }); setAba('placa');
    var placa = campoPlaca(q.placa || ''), area = el('div', { class: 'campo' });
    var btn = el('button', { type: 'button', class: 'btn btn-amarelo' }, [svg(ICONES.placa), 'Buscar pela placa']);
    btn.addEventListener('click', function () { executarPlaca(placa.input.value, btn, area); });
    placa.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
    var node = el('div', {}, [
      el('section', { class: 'cartao' }, [
        el('h2', { text: 'Digite a placa' }),
        el('p', { class: 'chamada', text: 'Placa antiga (ABC1234) ou Mercosul (ABC1D23). Identificamos o veículo e mostramos as peças MG compatíveis.' }),
        el('div', { class: 'campo' }, [placa.wrap]),
        el('div', { class: 'campo' }, [btn]),
        area
      ]),
      el('section', { class: 'cartao' }, [
        el('h2', { text: 'Como funciona' }),
        el('ul', { class: 'lista-sobre' }, [
          el('li', {}, [svg(ICONES.ok), el('span', { text: 'A placa é usada só para identificar marca, modelo, ano e motor.' })]),
          el('li', {}, [svg(ICONES.ok), el('span', { text: 'Nenhum dado do proprietário é consultado. A placa fica só enquanto o app está aberto (para você não digitar de novo ao voltar) e não é registrada: em Recentes guardamos só marca, modelo e ano.' })]),
          el('li', {}, [svg(ICONES.ok), el('span', { text: 'Se a consulta falhar ou ainda não estiver liberada, escolha marca, modelo e ano na aba Busca.' })])
        ])
      ])
    ]);
    mostrar(node);
    if (q.placa) btn.click(); else setTimeout(function () { placa.input.focus(); }, 50);
  }
  function telaBusca(q) {
    setAba('busca');
    var termo = q.q || '';
    setTopo({ titulo: termo ? 'Resultados' : 'Buscar peça', sub: termo ? '“' + termo + '”' : null, voltarPara: '#/' });
    var linha = campoBusca(termo), inp = linha.input;
    var res = el('div', { class: 'secao' });
    var cartaoTexto = el('section', { class: 'cartao cartao-compacto' }, [
      linha,
      termo ? null : el('p', { class: 'ajuda', text: 'Aceita código MG (MG001, mg 008), número original da montadora ou nome da peça com o carro (ex.: mangueira filtro de ar palio).' })
    ]);
    var avisoVeic = null;
    if (q.descr) { var placaTxt = q.via === 'placa' && placaAtual ? 'Placa ' + placaAtual + ': ' : ''; placaAtual = null; avisoVeic = status(placaTxt + q.descr + ' — identificamos a marca, mas não achamos o modelo na nossa tabela. Escolha o modelo abaixo.', 'aviso'); }
    /* ?linha=<id> (link "Buscar esta peça para outro veículo" da ficha): os resultados por veículo abrem já filtrados nessa linha */
    var linhaBusca = q.linha && LINHA_POR_ID[q.linha] ? q.linha : '';
    var secVeic = el('section', { class: 'secao' }, [
      el('div', { class: 'secao-cab' }, [el('h2', { text: 'Buscar pelo veículo' })]),
      avisoVeic,
      el('div', { class: 'cartao' }, [
        linhaBusca ? el('p', { class: 'ajuda ajuda-linha', style: 'margin:0 0 12px', text: 'Os resultados abrem só na linha ' + LINHA_POR_ID[linhaBusca].nome + '; toque em “Todas” para ver as outras linhas.' }) : null,
        seletorVeiculo({ marca: q.marca, linha: linhaBusca })
      ])
    ]);
    var node = el('div', {}, termo ? [cartaoTexto, res] : [cartaoTexto, secVeic, chipsRecentes()]);
    mostrar(node);
    if (!termo) {
      /* veio da ficha pela linha: o foco vai para a marca (o campo de texto não é o caminho aqui) */
      if (linhaBusca) dadosBase().then(function () { var s = secVeic.querySelector('select'); if (s && node.isConnected) s.focus({ preventScroll: true }); }).catch(function () {});
      else if (!q.marca) setTimeout(function () { inp.focus(); }, 50);
      return;
    }
    var corpo = el('div'), guardou = false, pediuCartao = false;
    res.appendChild(corpo); corpo.appendChild(esqueleto(4));
    /* a busca cita um veículo da tabela ("uno mille 1.0 2005"): cartão que abre a busca pelo veículo, acima dos
       resultados por texto (ou do estado vazio); pedido uma vez só (a lista parcial é refeita depois) */
    function pedirCartao() { if (pediuCartao) return; pediuCartao = true; cartaoVeiculoBusca(termo).then(function (c) { if (c && res.isConnected) res.insertBefore(c, res.firstChild); }); }
    function estadoVazio() {
      return vazio('Nada encontrado para “' + termo + '”', [
        'Confira o código MG ou o número original: só os números já bastam (ex.: 46445723).',
        'Tente o nome da peça com o modelo do carro (ex.: mangueira radiador gol).',
        'Escolha marca, modelo e ano na busca pelo veículo.',
        'Veja as linhas de produtos para encontrar a peça pela família.'
      ], [
        el('a', { class: 'btn btn-contorno', href: '#/busca', text: 'Buscar pelo veículo' }),
        el('a', { class: 'btn btn-neutro', href: '#/linhas', text: 'Ver linhas de produtos' })
      ]);
    }
    /* lista parcial (sem detalhes.json): aviso em cima; sem nenhum resultado parcial, espera em vez de dizer "nada encontrado",
       porque a palavra pode ser um veículo ou um número original, que só existem em detalhes.json.
       falhou: detalhes.json não veio (sem rede): fica o que há, com aviso honesto */
    function avisoParcial(falhou) {
      if (falhou) return status('Não foi possível carregar as aplicações e os números originais. Verifique a conexão.', 'aviso');
      return el('div', { class: 'status info aviso-parcial', role: 'status' }, [el('span', { class: 'abrindo-giro', 'aria-hidden': 'true' }), el('span', { text: 'Carregando aplicações e números originais…' })]);
    }
    /* refazendo: a lista já estava na tela (parcial) e detalhes.json chegou — troca de uma vez, mantendo a rolagem e o filtro de linha */
    function pintar(lista, refazendo, falhou) {
      var novo = el('div'), filtroAntes = '', paginasAntes = 0;
      if (refazendo) { var pa = corpo.querySelector('.painel-res'); filtroAntes = pa ? pa.getAttribute('data-filtro') || '' : ''; paginasAntes = pa ? +pa.getAttribute('data-paginas') || 0 : 0; }
      if (lista.parcial) novo.appendChild(avisoParcial(falhou));
      if (!lista.length) { if (lista.parcial && !falhou) novo.appendChild(esqueleto(4)); else novo.appendChild(estadoVazio()); }
      else {
        if (!guardou) { guardou = true; guardarBusca(termo); }
        if (lista.entendido) novo.appendChild(el('div', { class: 'res-cab' }, [el('p', { text: 'Buscamos também por “' + lista.entendido + '”.' })]));
        if (lista.parecido) novo.appendChild(status('Nenhum número original igual a “' + termo + '”. Estes têm um dígito diferente: confira o número gravado na peça.', 'aviso'));
        novo.appendChild(painelResultados(lista, function (it) { return itemPeca(it.i, aplicacoesResumo(it.p[0])); }, false, filtroAntes, paginasAntes));
      }
      var y = window.scrollY;
      corpo.innerHTML = ''; corpo.appendChild(novo);
      if (refazendo) window.scrollTo(0, y);
    }
    /* o cartão do veículo só precisa do índice e de marcas/<marca>.json: entra assim que eles chegam, acima do esqueleto
       (no 3G, bem antes de detalhes.json e da lista); pedirCartao é idempotente */
    dadosBase().then(pedirCartao).catch(function () {});
    buscarTexto(termo).then(function (lista) {
      pedirCartao();
      pintar(lista, false);
      if (!lista.parcial) return;
      dadosDetalhes().then(function () {
        if (!res.isConnected) return;
        return buscarTexto(termo).then(function (l2) { pintar(l2, true); });
      }).catch(function () {
        if (!res.isConnected) return;
        /* detalhes.json falhou: a própria busca pede de novo (espera até 400 ms); se essa 2ª tentativa chegar depois,
           a lista é refeita uma vez (sem o aviso de falha preso na tela), e não há 3ª tentativa */
        buscarTexto(termo).then(function (l2) {
          pintar(l2, true, true);
          if (l2.parcial && pDetalhes) pDetalhes.then(function () { if (res.isConnected) return buscarTexto(termo).then(function (l3) { pintar(l3, true); }); }).catch(function () {});
        }).catch(function () {});
      });
    }).catch(function (e) { corpo.innerHTML = ''; corpo.appendChild(status('Não foi possível buscar agora. Tente novamente.', 'erro')); console.error(e); });
  }
  function telaVeiculo(partes, q) {
    var marca = partes[1] || '', modelo = partes[2] || '', ano = +(partes[3] || 0) || 0, motor = q.motor || '', cil = +(q.cil || 0) || 0;
    var linha = q.linha && LINHA_POR_ID[q.linha] ? q.linha : ''; /* filtro de linha já aberto (vem do cartão da busca por texto) */
    var titulo = marca + ' ' + modelo + (ano ? ' ' + ano : '');
    var viaPlaca = q.via === 'placa', placa = viaPlaca ? placaAtual : null; placaAtual = null;
    setTopo({ titulo: titulo, sub: motor || null, voltarPara: '#/busca' }); setAba(viaPlaca ? 'placa' : 'busca');
    var res = el('div'), filtros = el('div', { class: 'filtros-veic' });
    /* o título do veículo já está no topo: o espaço fica para os chips de ano e motor (trocam o filtro sem voltar) */
    var cab = el('div', { class: 'res-cab' }, [
      el('h2', { class: 'visualmente-oculto', text: 'Peças MG para ' + titulo }),
      /* a linha "Motor 1.6 / Todos os motores" virou os chips; fica só o que veio da placa (etiqueta e descrição) */
      placa || q.descr ? el('p', {}, [placa ? el('span', { class: 'placa-tag', text: placa }) : null, q.descr ? (q.descr + (cil ? ' · motor ' + cil.toFixed(1) : '')) : (motor ? 'Motor ' + motor : 'Todos os motores')]) : null,
      filtros
    ]);
    var node = el('div', {}, [cab, res]);
    mostrar(node);
    res.appendChild(esqueleto(5));
    dadosBase().then(function () { return dadosMarca(marca); }).then(function (d) {
      if (!node.isConnected) return;
      filtros.appendChild(chipsVeiculo({ marca: marca, modelo: modelo, ano: ano, motor: motor, cil: cil, linha: linha }, d[modelo] || []));
    }).catch(function () {});
    buscarVeiculo({ marca: marca, modelo: modelo, ano: ano, motor: motor, cil: cil }).then(function (itens) {
      res.innerHTML = '';
      /* em Recentes vai só marca, modelo, ano e motor (nunca a placa nem a descrição da consulta) */
      if (indice.marcas[marca] && indice.marcas[marca].indexOf(modelo) >= 0) guardarRecente({ marca: marca, modelo: modelo, ano: ano, motor: motor });
      if (!itens.length) {
        var semFiltro = hashVeiculo({ marca: marca, modelo: modelo }), acoesVazio = [];
        if (ano || motor) acoesVazio.push(el('a', { class: 'btn btn-contorno', href: semFiltro, text: ano && motor ? 'Ver todos os anos e motores' : (ano ? 'Ver todos os anos' : 'Ver todos os motores') }));
        acoesVazio.push(el('a', { class: 'btn btn-neutro', href: '#/linhas', text: 'Ver linhas de produtos' }));
        acoesVazio.push(el('a', { class: 'btn btn-neutro', href: '#/busca', text: 'Buscar por código ou nome' }));
        res.appendChild(vazio('Nenhuma peça cadastrada para ' + titulo, [
          ano || motor ? 'Tente outro ano ou sem o motor: a aplicação pode estar cadastrada por faixa de anos.' : 'Tente um modelo próximo, como a geração anterior ou a versão com outro nome.',
          'Veja as linhas de produtos: a peça pode estar cadastrada para outro veículo da mesma família.',
          'Busque pelo código MG ou pelo número original da montadora.'
        ], acoesVazio));
        return;
      }
      /* link da busca sem a placa nem a descrição: só marca, modelo, ano e motor */
      var hashBusca = hashVeiculo({ marca: marca, modelo: modelo, ano: ano, motor: motor }) + (cil ? (motor ? '&' : '?') + 'cil=' + cil.toFixed(1) : '');
      var btnComp = el('button', { type: 'button', class: 'link-acao' }, [svg(ICONES.compartilhar), 'Compartilhar esta busca']);
      btnComp.addEventListener('click', function () { compartilhar('Peças MG para ' + titulo, 'Peças MG para ' + titulo + (motor ? ' ' + motor : ''), urlApp(hashBusca)); });
      cab.appendChild(el('div', { class: 'res-acoes' }, [btnComp]));
      res.appendChild(painelResultados(itens, function (it) {
        return itemPeca(it.i, '<b>' + esc(marca + ' ' + modelo) + '</b> ' + (it.a[3] ? esc(it.a[3]) + ' · ' : '') + esc(anoTexto(it.a)), it.mc === 1 && (cil || motor) ? 'Confirme o motor' : null);
      }, true, linha));
    }).catch(function (e) { res.innerHTML = ''; res.appendChild(status('Não foi possível carregar as peças deste veículo. Verifique a conexão.', 'erro')); console.error(e); });
  }
  /* chips de ano e de motor nos resultados por veículo; cada chip é um link da mesma busca com o filtro trocado.
     Ano: as listas são longas (Gol: 49 anos), então aparecem só ±6 anos ao redor do escolhido (ou do ano mediano das
     aplicações, sem ano), com um chip "mais" em cada ponta que abre o resto daquele lado.
     Motor: chips das cilindradas do ano (1.0, 1.6…); as descrições completas da tabela ("1.0 8V/16V MI") ficam no
     seletor "Motor completo", em vez de virar um chip comprido. */
  function chipsVeiculo(f, apls) {
    function chip(texto, ativo, r) { if (f.linha) r.linha = f.linha; return el('a', { class: 'chip' + (ativo ? ' ativo' : ''), 'aria-current': ativo ? 'true' : null, href: hashVeiculo(r), text: texto }); }
    function linha(rotulo, chips, centrar) {
      var c = el('div', { class: 'chips rolar', role: 'group', 'aria-label': rotulo }, chips), w = rolavel(c);
      /* o chip ativo entra na área visível (as listas de ano são longas); se já aparece inteiro, a linha não rola (o "Todos" fica à vista) */
      requestAnimationFrame(function () {
        var a = c.querySelector('.ativo');
        if (a && centrar !== false && a.offsetLeft + a.offsetWidth > c.clientWidth) c.scrollLeft = Math.max(0, a.offsetLeft - c.clientWidth / 2 + a.offsetWidth / 2);
        if (w.conferir) w.conferir();
      });
      return el('div', { class: 'filtro-veic' }, [el('span', { class: 'filtro-rotulo', 'aria-hidden': 'true', text: rotulo }), w]);
    }
    var fx = faixaAnos(apls), anos = []; for (var y = fx[1]; y >= fx[0]; y--) anos.push(y);
    var motorAtivo = f.motor || (f.cil ? f.cil.toFixed(1) : '');
    var JANELA = 6, maisRecentes = false, maisAntigos = false, linhaAno = null;
    /* sem ano escolhido, a janela fica em volta do ano "mediano" das aplicações do modelo (metade das aplicações-ano
       antes dele, metade depois), e não nos 13 anos mais recentes: Uno Mille abre em 1999–2011 (e não 2027–2015),
       Gol em 2002–2014, Corsa em 1999–2011; "mais" nas pontas continua abrindo o resto */
    function anoCentral() {
      var peso = {}, total = 0, y;
      apls.forEach(function (a) {
        if (!a[1] && a[2] === 9999) return; /* "Todos os anos" não diz nada sobre a época do modelo */
        var y1 = Math.max(a[1] || fx[0], fx[0]), y2 = Math.min(a[2] === 9999 ? ANO_ATUAL : a[2], fx[1]);
        for (y = y1; y <= y2; y++) { peso[y] = (peso[y] || 0) + 1; total++; }
      });
      if (!total) return fx[1]; /* só aplicações sem ano (Scania R440): os mais recentes, como antes */
      var acum = 0;
      for (y = fx[0]; y <= fx[1]; y++) { acum += peso[y] || 0; if (acum * 2 >= total) return y; }
      return fx[1];
    }
    function listaAnos() {
      if (anos.length <= 2 * JANELA + 3) return anos; /* lista curta: tudo de uma vez */
      var centro = f.ano || anoCentral(), hi = Math.min(fx[1], centro + JANELA), lo = Math.max(fx[0], centro - JANELA);
      if (!f.ano) { if (hi === fx[1]) lo = Math.max(fx[0], hi - 2 * JANELA); else if (lo === fx[0]) hi = Math.min(fx[1], lo + 2 * JANELA); } /* encostou na ponta: completa os 13 do outro lado */
      if (maisRecentes) hi = fx[1]; if (maisAntigos) lo = fx[0];
      var l = anos.filter(function (a) { return a >= lo && a <= hi; });
      return l.length ? l : anos;
    }
    function chipMais(lado) {
      var b = el('button', { type: 'button', class: 'chip chip-mais', 'aria-label': lado === 'recentes' ? 'Mostrar anos mais recentes' : 'Mostrar anos mais antigos', text: 'mais' });
      b.addEventListener('click', function () {
        var antes = listaAnos();
        if (lado === 'recentes') maisRecentes = true; else maisAntigos = true;
        var nova = linha('Ano', chipsAno(), false); linhaAno.replaceWith(nova); linhaAno = nova;
        /* a rolagem fica onde o usuário estava: os anos novos entram no lugar do "mais", e o foco vai para o 1º deles */
        requestAnimationFrame(function () {
          var c = nova.querySelector('.chips'), alvo = lado === 'recentes' ? antes[0] + 1 : antes[antes.length - 1] - 1, novo = null;
          c.querySelectorAll('a.chip').forEach(function (a) { if (+a.textContent === alvo) novo = a; });
          if (!novo) return;
          c.scrollLeft = lado === 'recentes' ? 0 : Math.max(0, novo.offsetLeft - 8);
          novo.focus({ preventScroll: true });
          if (nova.querySelector('.rolar-wrap').conferir) nova.querySelector('.rolar-wrap').conferir();
        });
      });
      return b;
    }
    function chipsAno() {
      var lista = listaAnos(), cs = [chip('Todos', !f.ano, { marca: f.marca, modelo: f.modelo, motor: motorAtivo })];
      if (lista[0] < fx[1]) cs.push(chipMais('recentes'));
      lista.forEach(function (a) { cs.push(chip(String(a), a === f.ano, { marca: f.marca, modelo: f.modelo, ano: a, motor: motorAtivo })); });
      if (lista[lista.length - 1] > fx[0]) cs.push(chipMais('antigos'));
      return cs;
    }
    var mt = motoresDe(apls, f.ano), motores = mt.cils.length ? mt.cils : mt.todos;
    var completos = mt.cils.length && mt.completos.length ? mt.completos.slice() : null;
    /* o motor ativo é uma descrição completa (veio do seletor da Busca): fica marcado no seletor, não vira chip */
    var motorCompleto = completos && motorAtivo && motores.indexOf(motorAtivo) < 0 ? motorAtivo : '';
    if (motorCompleto && completos.indexOf(motorCompleto) < 0) completos.unshift(motorCompleto);
    if (motorAtivo && !motorCompleto && motores.indexOf(motorAtivo) < 0) motores = [motorAtivo].concat(motores);
    var chipsMotor = [chip('Todos', !motorAtivo, { marca: f.marca, modelo: f.modelo, ano: f.ano })].concat(motores.map(function (m) { return chip(m, m === motorAtivo, { marca: f.marca, modelo: f.modelo, ano: f.ano, motor: m }); }));
    var selCompleto = null;
    if (completos) {
      selCompleto = el('select', { class: 'select select-mini select-motor', 'aria-label': 'Motor completo' }, [el('option', { value: '', text: 'Motor completo (todos)' })].concat(completos.map(function (m) { return el('option', { value: m, text: m }); })));
      selCompleto.value = motorCompleto;
      selCompleto.addEventListener('change', function () { location.hash = hashVeiculo({ marca: f.marca, modelo: f.modelo, ano: f.ano, motor: selCompleto.value, linha: f.linha }); });
    }
    linhaAno = linha('Ano', chipsAno());
    return el('div', {}, [
      linhaAno,
      motores.length ? linha('Motor', chipsMotor) : null,
      selCompleto ? el('div', { class: 'filtro-veic filtro-completo' }, [el('span', { class: 'filtro-rotulo', 'aria-hidden': 'true' }), el('div', { class: 'filtro-col' }, [
        el('div', { class: 'select-wrap select-mini-wrap' }, [selCompleto]),
        /* a caixa fechada corta as descrições longas; a escolhida aparece inteira aqui */
        motorCompleto ? el('p', { class: 'motor-escolhido' }, [el('b', { text: 'Motor: ' }), motorCompleto]) : null
      ])]) : null
    ]);
  }
  function telaLinhas() {
    setTopo({ titulo: 'Linhas de produtos', voltarPara: '#/' }); setAba('linhas');
    var grade = el('div', { class: 'grade-linhas' });
    preencherLinhas(grade, 0);
    mostrar(el('div', {}, [el('p', { class: 'chamada', text: 'Toque em uma linha para ver todas as peças MG.' }), grade]));
  }
  function telaLinha(id, q) {
    var l = LINHA_POR_ID[id]; if (!l) { toast('Linha não encontrada'); location.hash = '#/linhas'; return; }
    setTopo({ titulo: l.nome, voltarPara: '#/linhas' }); setAba('linhas');
    var res = el('div'), filtros = el('div', { class: 'chips rolar' }), rolagem = rolavel(filtros), node = el('div', {}, [rolagem, res]);
    mostrar(node); res.appendChild(esqueleto(6));
    Promise.all([dadosBase(), dadosDetalhes()]).then(function () {
      var itens = [], marcas = {};
      produtos.forEach(function (p, i) {
        if (!p[3] || linhaDe(p[0]).id !== id) return;
        var d = detalheDe(p[0]); (d.m || []).forEach(function (m) { marcas[m] = (marcas[m] || 0) + 1; });
        itens.push({ i: i, p: p, m: d.m || [] });
      });
      itens.sort(function (a, b) { return a.p[1].localeCompare(b.p[1], 'pt-BR') || a.p[0].localeCompare(b.p[0], 'pt-BR', { numeric: true }); });
      var ms = Object.keys(marcas).sort(function (a, b) { return marcas[b] - marcas[a] || a.localeCompare(b); });
      var filtro = q.montadora || '';
      filtros.innerHTML = '';
      filtros.setAttribute('role', 'group'); filtros.setAttribute('aria-label', 'Filtrar por montadora');
      filtros.appendChild(el('a', { class: 'chip chip-pequeno' + (filtro ? '' : ' ativo'), 'aria-current': filtro ? null : 'true', href: '#/linha/' + id, text: 'Todas (' + itens.length + ')' }));
      ms.forEach(function (m) { filtros.appendChild(el('a', { class: 'chip chip-pequeno' + (filtro === m ? ' ativo' : ''), 'aria-current': filtro === m ? 'true' : null, href: '#/linha/' + id + '?montadora=' + encodeURIComponent(m), text: m + ' (' + marcas[m] + ')' })); });
      rolagem.conferir();
      var vis = filtro ? itens.filter(function (it) { return it.m.indexOf(filtro) >= 0; }) : itens;
      res.innerHTML = '';
      /* "Linha Pesada" não reúne as peças de caminhão: cada uma fica na linha do tipo (arrefecimento, filtro de ar…).
         Quem procura Scania/Volvo aqui ganha o atalho para a busca por veículo (só montadoras que existem no índice). */
      if (id === 'pesada' && !filtro) {
        var pesadas = ['Scania', 'Volvo', 'Mercedes-Benz', 'Iveco'].filter(function (m) { return indice.marcas[m]; });
        if (pesadas.length) res.appendChild(el('div', { class: 'cartao nota-pesada' }, [
          el('p', { text: 'Peças de caminhão ficam na linha de cada tipo de peça (arrefecimento, filtro de ar…). Para ver todas de uma montadora, busque pelo veículo:' }),
          el('div', { class: 'chips' }, pesadas.map(function (m) { return el('a', { class: 'chip', href: '#/busca?marca=' + encodeURIComponent(m), text: m }); }))
        ]));
      }
      if (!vis.length) { res.appendChild(vazio('Nenhuma peça nesta linha', '')); return; }
      res.appendChild(el('div', { class: 'res-cab' }, [el('p', { text: plural(vis.length, 'peça', 'peças') + (filtro ? ' para ' + filtro : '') })]));
      anunciar(plural(vis.length, 'peça', 'peças') + (filtro ? ' para ' + filtro : '') + ' em ' + l.nome);
      var ul = el('ul', { class: 'lista' }), pagina = 0, POR = 30;
      var mais = el('div', { class: 'mais' }, [el('button', { type: 'button', class: 'btn btn-neutro', text: 'Mostrar mais' })]);
      function maisItens() { vis.slice(pagina * POR, (pagina + 1) * POR).forEach(function (it) { ul.appendChild(itemPeca(it.i, aplicacoesResumo(it.p[0]))); }); pagina++; mais.hidden = pagina * POR >= vis.length; }
      mais.querySelector('button').addEventListener('click', maisItens);
      res.appendChild(ul); res.appendChild(mais); maisItens();
      if ('IntersectionObserver' in window) { var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting && !mais.hidden) maisItens(); }, { rootMargin: '400px' }); io.observe(mais); }
    }).catch(function (e) { res.innerHTML = ''; res.appendChild(status('Não foi possível carregar a linha. Verifique a conexão.', 'erro')); console.error(e); });
  }
  function urlMercadoLivre(cod, tipo) {
    /* mesmo padrão do botão do site (regras_filipe.md 27/10): nome encurtado, sem o trecho entre parênteses */
    tipo = String(tipo || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    var termo = cod + ' ' + tipo + ' ' + (CFG.mlSufixo || 'MG Mangueiras - MG Peças Automotivas');
    var caminho = sa(termo).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return 'https://lista.mercadolivre.com.br/' + caminho + (CFG.mlMarcaId ? '_BRAND_' + CFG.mlMarcaId : '');
  }
  function telaPeca(cod) {
    cod = String(cod || '').toUpperCase();
    setTopo({ titulo: cod, voltarPara: '#/' }); setAba('');
    /* o esqueleto da foto usa a mesma caixa (.detalhe-foto, proporção real 20:11) da foto que vem depois: nada pula ao carregar */
    var node = el('div', {}, [el('div', { class: 'detalhe-topo' }, [el('div', { class: 'detalhe-foto esq-bloco', 'aria-hidden': 'true' }), esqueleto(2)])]);
    mostrar(node);
    Promise.all([dadosBase(), dadosDetalhes().catch(function () { return null; })]).then(function () {
      var i = porCodigo[cod];
      if (i == null) { mostrar(el('div', {}, [vazio('Peça ' + cod + ' não encontrada', 'Confira o código ou use a busca.', [el('a', { class: 'btn btn-contorno', href: '#/busca?q=' + encodeURIComponent(cod), text: 'Buscar “' + cod + '”' })])])); return; }
      var p = produtos[i], d = detalheDe(p[0]), l = linhaDe(p[0]);
      setTopo({ titulo: p[0], sub: p[1], voltarPara: '#/' });
      var foto = el('div', { class: 'detalhe-foto' }, [fotoEl(i, p[1] + ' ' + p[0], 640, 320)]);
      /* o botão de ampliar entra quando imagens.json já está no aparelho (na 1ª abertura em 3G ele chega depois da ficha,
         e repintarFotos troca o esqueleto pela foto); só abre quando a foto carregou, e a versão maior entra quando chega */
      function prepararZoom() {
        var fotoBox = foto.querySelector('.foto');
        if (!fotoBox || !fotoDe(i) || foto.querySelector('.btn-ampliar')) return;
        var btnZoom = el('button', { type: 'button', class: 'btn-icone btn-ampliar', 'aria-label': 'Ampliar foto', title: 'Ampliar foto' }, [svg(ICONES.ampliar)]);
        function ampliar() { var im = fotoBox.querySelector('img'); if (!im || !fotoBox.classList.contains('ok')) return; abrirZoom(im.currentSrc || im.src, fotoDe(i, 1024), p[1] + ' ' + p[0], btnZoom); }
        btnZoom.addEventListener('click', ampliar);
        fotoBox.addEventListener('click', ampliar);
        fotoBox.classList.add('pode-ampliar');
        foto.appendChild(btnZoom);
      }
      if (imagensPronto) prepararZoom(); else dadosImagens().then(prepararZoom);
      var meta = el('div', { class: 'detalhe-meta' }, [el('a', { class: 'chip chip-pequeno', href: '#/linha/' + l.id, text: l.nome })].concat((d.m || []).map(function (m) { return el('a', { class: 'chip chip-pequeno', href: '#/linha/' + l.id + '?montadora=' + encodeURIComponent(m), text: m }); })));
      /* salvar em "Minhas peças" (só no aparelho) e compartilhar o link da peça */
      var btnFav = el('button', { type: 'button', class: 'btn btn-neutro btn-acao btn-favorito' }, [svg(ICONES.coracao), el('span')]);
      function pintarFav() { var on = ehFavorito(p[0]); btnFav.setAttribute('aria-pressed', on ? 'true' : 'false'); btnFav.querySelector('span').textContent = on ? 'Peça salva' : 'Salvar peça'; }
      btnFav.addEventListener('click', function () { if (alternarFavorito(p[0])) toast('Salva em Minhas peças', { texto: 'Ver', href: '#/minhas' }); else toast('Removida de Minhas peças'); pintarFav(); });
      pintarFav();
      var btnComp = el('button', { type: 'button', class: 'btn btn-neutro btn-acao' }, [svg(ICONES.compartilhar), 'Compartilhar']);
      /* o link vai pela página estática p/<código>.html (prévia com nome e foto da peça nos aplicativos de mensagem), que abre o app na ficha */
      btnComp.addEventListener('click', function () { compartilhar(p[1] + ' ' + p[0], p[1] + ' MG ' + p[0], urlApp('p/' + encodeURIComponent(p[0]) + '.html')); });
      var acoesPeca = el('div', { class: 'linha-btn acoes-peca' }, [btnFav, btnComp]);
      var cab = el('section', {}, [el('div', { class: 'detalhe-cod', text: p[0] }), el('div', { class: 'detalhe-nome', text: p[1] }), meta, d.e ? el('p', { class: 'ajuda', text: 'Embalagem: ' + d.e }) : null, acoesPeca]);
      var apl;
      if (d.a && d.a.length) {
        var tb = el('table', { class: 'tabela' }, [el('thead', {}, [el('tr', {}, [el('th', { text: 'Veículo' }), el('th', { text: 'Motor' }), el('th', { text: 'Anos' })])])]);
        var tbody = el('tbody'); d.a.forEach(function (a) { tbody.appendChild(el('tr', {}, [el('td', { text: a[0] }), el('td', { text: a[1] || '—', class: a[1] ? '' : 'silencio' }), el('td', { text: a[2] || '—', class: a[2] ? '' : 'silencio' })])); });
        tb.appendChild(tbody);
        /* quem chega pelo link compartilhado e quer a mesma peça para outro carro: a busca pelo veículo abre já na linha desta peça */
        var outroVeic = el('a', { class: 'link-acao link-outro-veic', href: '#/busca?linha=' + l.id }, [svg(ICONES.carro), 'Buscar esta peça para outro veículo']);
        apl = el('section', { class: 'cartao' }, [el('h2', { text: 'Aplicação' }), el('div', { style: 'margin-top:10px' }, [tb]), el('p', { class: 'ajuda', text: 'Confira sempre o motor e o ano do veículo antes de instalar.' }), outroVeic]);
      } else apl = el('section', { class: 'cartao' }, [el('h2', { text: 'Aplicação' }), el('p', { class: 'ajuda', text: 'Aplicação em revisão. Consulte a página da peça no site.' })]);
      var oem = null;
      if (d.o && d.o.length) {
        /* no balcão (computador) a lista vai para o orçamento: um botão copia os números em uma linha, separados por vírgula */
        var btnOem = el('button', { type: 'button', class: 'btn btn-neutro btn-mini oem-copiar' }, [svg(ICONES.copiar), 'Copiar números']);
        btnOem.addEventListener('click', function () { copiarTexto(d.o.join(', ')).then(function () { toast(d.o.length === 1 ? 'Número copiado' : 'Números copiados'); }).catch(function () { toast('Não foi possível copiar.'); }); });
        var oemLista = el('div', { class: 'oem', style: 'margin-top:10px' }, d.o.map(function (o) { return el('code', { text: o }); }));
        prenderSelecao(oemLista);
        oem = el('section', { class: 'cartao' }, [el('div', { class: 'oem-cab' }, [el('h2', { text: 'Números originais' }), btnOem]), oemLista, el('p', { class: 'ajuda', text: 'Números de referência da montadora que esta peça MG substitui.' })]);
      }
      /* peça com flag de publicação 0: a página do site responde 404, então o link "Ver no site" não aparece */
      var acoes = el('section', { class: 'acoes-fixas' }, [
        p[3] ? el('a', { class: 'btn btn-primario', href: LOJA + '/produtos/' + p[2] + '/', target: '_blank', rel: 'noopener' }, [svg(ICONES.externo), 'Ver no site'])
             : status('Esta peça não está publicada no site da MG no momento.', 'aviso'),
        el('a', { class: 'btn btn-contorno', href: urlMercadoLivre(p[0], p[1]), target: '_blank', rel: 'noopener' }, [svg(ICONES.loja), 'Encontre em lojas parceiras online']),
        el('p', { class: 'nota-legal', text: 'Você será direcionado a revendedores independentes.' })
      ]);
      var relacionados = el('section', { class: 'secao' });
      /* .detalhe-topo: foto e cabeçalho (código, nome, linha, ações) — em pé um abaixo do outro; no celular deitado lado a lado */
      mostrar(el('div', {}, [el('div', { class: 'detalhe-topo' }, [foto, cab]), apl, oem, acoes, relacionados]));
      montarRelacionados(relacionados, i, d);
    }).catch(function (e) { mostrar(el('div', {}, [status('Não foi possível abrir a peça. Verifique a conexão.', 'erro')])); console.error(e); });
  }
  /* no computador, arrastar o mouse a partir de um número original não deve selecionar o resto da página: o CSS
     user-select: contain faz isso onde existe; nos navegadores sem ele (Chromium atual), a seleção fica presa à caixa
     enquanto o botão do mouse estiver pressionado (toque e teclado não passam por aqui) */
  function prenderSelecao(caixa) {
    if (window.CSS && CSS.supports && CSS.supports('user-select', 'contain')) return;
    caixa.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      function prender() {
        var sel = document.getSelection();
        if (!sel || !sel.rangeCount || !sel.anchorNode || !caixa.contains(sel.anchorNode) || !sel.focusNode || caixa.contains(sel.focusNode) || !sel.extend) return;
        var depois = sel.focusNode.compareDocumentPosition(caixa) & Node.DOCUMENT_POSITION_PRECEDING; /* a caixa vem antes do foco: o mouse passou do fim */
        var cods = caixa.querySelectorAll('code'), alvo = cods[depois ? cods.length - 1 : 0], txt = alvo && alvo.firstChild;
        if (txt && txt.nodeType === 3 && sel.setBaseAndExtent) sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset, txt, depois ? txt.length : 0);
        else sel.extend(caixa, depois ? caixa.childNodes.length : 0);
      }
      function soltar() { document.removeEventListener('selectionchange', prender); document.removeEventListener('mouseup', soltar); window.removeEventListener('blur', soltar); prender(); }
      document.addEventListener('selectionchange', prender);
      document.addEventListener('mouseup', soltar);
      window.addEventListener('blur', soltar); /* mouse solto fora da janela: o mouseup não chega; o blur limpa os ouvintes na hora */
    });
  }
  function montarRelacionados(sec, idx, d) {
    /* só dados reais da tabela de aplicação: primeiro peças da mesma linha para os mesmos veículos desta ficha,
       depois da mesma linha e da mesma montadora; no máximo 6, com link para a linha inteira.
       (o catálogo não guarda relação "peças que vão junto"; quando esse dado existir, é aqui que entra) */
    var p = produtos[idx], l = linhaDe(p[0]), veics = {}, monts = {}, MAX = 6;
    (d.a || []).forEach(function (a) { veics[sa(a[0])] = 1; });
    (d.m || []).forEach(function (m) { monts[sa(m)] = 1; });
    var mesmoCarro = [], mesmaMontadora = [], nLinha = 0;
    produtos.forEach(function (q, j) {
      if (j === idx || !q[3] || linhaDe(q[0]).id !== l.id) return;
      nLinha++;
      var dq = detalheDe(q[0]), n = 0;
      (dq.a || []).forEach(function (a) { if (veics[sa(a[0])]) n++; });
      if (n) mesmoCarro.push({ j: j, n: n });
      else if ((dq.m || []).some(function (m) { return monts[sa(m)]; })) mesmaMontadora.push({ j: j, n: 0 });
    });
    function porCod(a, b) { return produtos[a.j][0].localeCompare(produtos[b.j][0], 'pt-BR', { numeric: true }); }
    mesmoCarro.sort(function (a, b) { return b.n - a.n || porCod(a, b); });
    mesmaMontadora.sort(porCod);
    var lista = mesmoCarro.slice(0, MAX);
    if (lista.length < MAX) lista = lista.concat(mesmaMontadora.slice(0, MAX - lista.length));
    if (!nLinha) return;
    var mont = (d.m || [])[0];
    var hrefLinha = '#/linha/' + l.id + (mont ? '?montadora=' + encodeURIComponent(mont) : '');
    var linkLinha = el('a', { class: 'link', href: hrefLinha, text: 'Ver mais da linha' });
    if (!lista.length) { sec.appendChild(el('div', { class: 'secao-cab' }, [el('h2', { text: l.nome }), linkLinha])); return; }
    var titulo = mesmoCarro.length ? 'Para os mesmos veículos' : 'Da mesma linha' + (mont ? ' para ' + mont : '');
    sec.appendChild(el('div', { class: 'secao-cab' }, [el('h2', { text: titulo }), linkLinha]));
    sec.appendChild(el('p', { class: 'ajuda', style: 'margin:0 0 10px', text: mesmoCarro.length ? 'Outras peças de ' + l.nome + ' que também atendem os veículos desta ficha.' : 'Outras peças de ' + l.nome + (mont ? ' para ' + mont : '') + '.' }));
    /* a etiqueta "Mesmo veículo" só quando a lista mistura os dois critérios */
    var misto = lista.some(function (it) { return it.n; }) && lista.some(function (it) { return !it.n; });
    var ul = el('ul', { class: 'lista' });
    lista.forEach(function (it) { ul.appendChild(itemPeca(it.j, aplicacoesResumo(produtos[it.j][0]), misto && it.n ? 'Mesmo veículo' : null)); });
    sec.appendChild(ul);
    if (nLinha > lista.length) sec.appendChild(el('div', { class: 'mais' }, [el('a', { class: 'btn btn-neutro', href: '#/linha/' + l.id, text: 'Ver toda a linha (' + (nLinha + 1) + ')' })]));
  }
  function telaMinhas() {
    setTopo({ titulo: 'Minhas peças', voltarPara: '#/' }); setAba('inicio');
    var res = el('div'), node = el('div', {}, [res]);
    mostrar(node); res.appendChild(esqueleto(4));
    Promise.all([dadosBase(), dadosDetalhes().catch(function () { return null; })]).then(function montar() {
      res.innerHTML = '';
      var n = favoritosValidos().length;
      if (!n) { res.appendChild(vazio('Nenhuma peça salva', 'Toque em “Salvar peça” na ficha de uma peça para encontrá-la aqui, mesmo sem internet.', [el('a', { class: 'btn btn-contorno', href: '#/busca', text: 'Buscar peça' })])); return; }
      /* ordem (lembrada enquanto o app estiver aberto) e "Limpar todas" com confirmação em linha, sem janela do navegador */
      var sel = el('select', { class: 'select select-mini', 'aria-label': 'Ordenar por' }, ORDENS_MINHAS.map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
      sel.value = ordemMinhas;
      sel.addEventListener('change', function () { ordemMinhas = sel.value; montar(); var ns = res.querySelector('select'); if (ns) ns.focus(); });
      var limpar = el('button', { type: 'button', class: 'link-acao', text: 'Limpar todas' });
      var txtConf = el('p', { tabindex: '-1', text: 'Apagar ' + (n === 1 ? 'a peça salva' : 'as ' + n + ' peças salvas') + ' deste aparelho? Não é possível desfazer.' });
      var btnCancelar = el('button', { type: 'button', class: 'btn btn-mini btn-neutro', text: 'Cancelar' });
      var btnApagar = el('button', { type: 'button', class: 'btn btn-mini btn-primario', text: 'Apagar' });
      var confirmar = el('div', { class: 'status aviso confirmar', role: 'group', 'aria-label': 'Confirmar', hidden: true }, [svg(ICONES.aviso), el('div', { class: 'confirmar-corpo' }, [txtConf, el('div', { class: 'linha-btn' }, [btnCancelar, btnApagar])])]);
      limpar.addEventListener('click', function () { confirmar.hidden = false; limpar.disabled = true; txtConf.focus(); });
      btnCancelar.addEventListener('click', function () { confirmar.hidden = true; limpar.disabled = false; limpar.focus(); });
      btnApagar.addEventListener('click', function () { lsJson('mg-favoritos', []); toast('Peças salvas apagadas'); montar(); var f = res.querySelector('a.btn, button'); if (f) f.focus(); });
      res.appendChild(el('div', { class: 'res-cab' }, [el('p', { text: plural(n, 'peça salva', 'peças salvas') + ' neste aparelho' })]));
      res.appendChild(el('div', { class: 'res-barra minhas-barra' }, [el('div', { class: 'select-wrap select-mini-wrap' }, [sel]), limpar]));
      res.appendChild(confirmar);
      res.appendChild(listaMinhas(0, montar, ordemMinhas));
    }).catch(function (e) { res.innerHTML = ''; res.appendChild(status('Não foi possível carregar as peças salvas.', 'erro')); console.error(e); });
  }
  function telaSobre() {
    setTopo({ titulo: 'Sobre a MG', voltarPara: '#/' }); setAba('');
    var temaAtual = ls('mg-tema') || 'auto';
    var seg = el('div', { class: 'segmentos', role: 'group', 'aria-label': 'Tema' }, [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(function (o) {
      var b = el('button', { type: 'button', class: temaAtual === o[0] ? 'ativo' : '', 'aria-pressed': temaAtual === o[0] ? 'true' : 'false', text: o[1] });
      b.addEventListener('click', function () { aplicarTema(o[0]); rolagemAlvo = window.scrollY; telaSobre(); var nb = tela.querySelector('.segmentos button[aria-pressed="true"]'); if (nb) nb.focus(); toast('Tema ' + o[1].toLowerCase()); });
      return b;
    }));
    var instalarBtn = el('button', { type: 'button', class: 'btn btn-contorno so-navegador' }, [svg(ICONES.instalar), 'Instalar app no celular']);
    instalarBtn.addEventListener('click', pedirInstalacao);
    var btnVerificar = el('button', { type: 'button', class: 'btn btn-neutro btn-mini' }, [svg(ICONES.atualizar), 'Procurar atualização']);
    btnVerificar.addEventListener('click', function () {
      btnVerificar.disabled = true; btnVerificar.classList.add('carregando');
      verificarAtualizacao(true).then(function (r) {
        if (r === 'nova') toast('Atualização encontrada: toque em Atualizar.');
        else if (r === 'sem-sw') toast('A atualização automática não está disponível neste navegador.');
        else toast('Você já está na versão mais recente.');
      }).catch(function () { toast('Não foi possível verificar agora. Confira a conexão.'); }).then(function () { btnVerificar.disabled = false; btnVerificar.classList.remove('carregando'); });
    });
    var node = el('div', {}, [
      el('section', { class: 'cartao', style: 'text-align:center' }, [
        el('img', { class: 'sobre-logo', src: logoSrc(), alt: 'MG Peças Automotivas', width: '708', height: '267' }),
        el('h2', { text: 'MG Peças Automotivas' }),
        el('p', { class: 'chamada', text: 'Fabricante nacional de mangueiras do filtro de ar, peças de arrefecimento, respiro, reservatórios, suspensão, metal-borracha e peças plásticas para a linha leve e pesada.' })
      ]),
      el('section', { class: 'cartao' }, [
        el('ul', { class: 'lista-sobre' }, [
          el('li', {}, [svg(ICONES.local), el('span', { text: 'Diadema-SP, Brasil' })]),
          el('li', {}, [svg(ICONES.fabrica), el('span', { text: 'A MG é fabricante e vende para distribuidores de autopeças. Consumidor e mecânico encontram as peças MG em lojas parceiras online.' })]),
          el('li', {}, [svg(ICONES.pecas), el('span', { text: 'Este app é o catálogo oficial: aplicação por veículo, números originais e fotos de cada peça, direto do site da MG.' })])
        ]),
        el('div', { class: 'campo' }, [el('a', { class: 'btn btn-primario', href: LOJA + '/', target: '_blank', rel: 'noopener' }, [svg(ICONES.externo), 'Visitar o site da MG'])]),
        /* rótulo em duas linhas (título curto + explicação menor) para não quebrar no celular */
        el('div', { class: 'campo' }, [el('a', { class: 'btn btn-contorno btn-duplo', href: LOJA + '/representantes/', target: '_blank', rel: 'noopener' }, [svg(ICONES.local), el('span', { class: 'btn-duplo-txt' }, [el('b', { text: 'Sou distribuidor' }), el('small', { text: 'Ver os representantes da MG' })])])])
      ]),
      el('section', { class: 'cartao' }, [
        el('div', { class: 'linha-opcao' }, [el('span', { class: 'rotulo', style: 'margin:0', text: 'Tema' }), seg]),
        el('div', { class: 'campo' }, [instalarBtn]),
        el('div', { class: 'campo' }, [el('a', { class: 'btn btn-neutro', href: '#/instalar' }, [svg(ICONES.qr), 'QR code e passo a passo'])])
      ]),
      el('section', { class: 'cartao' }, [
        el('div', { class: 'versao' }, [
          el('div', {}, [el('span', { class: 'rotulo', text: 'Versão do app' }), el('b', { text: CFG.versao || '—' }), el('p', { class: 'ajuda dados-info', text: 'Dados do catálogo: carregando…' })]),
          btnVerificar
        ]),
        el('p', { class: 'ajuda', text: 'O app procura atualização ao abrir e ao voltar para a tela; quando há uma nova, aparece a barra "Atualização disponível".' })
      ]),
      el('p', { class: 'nota-legal', text: 'MG Peças Automotivas · Diadema-SP' })
    ]);
    mostrar(node);
    /* duas datas: a do índice de peças (indice.json) e a das aplicações/números originais (detalhes.json, campo "gerado") */
    Promise.all([dadosBase(), dadosDetalhes().catch(function () { return null; })]).then(function () {
      var di = node.querySelector('.dados-info'); if (!di) return;
      di.textContent = 'Dados do catálogo atualizados em ' + dataBr(indice.gerado);
      if (detalhesGerado) { di.appendChild(el('br')); di.appendChild(document.createTextNode('Aplicações e números originais gerados em ' + dataBr(detalhesGerado))); }
    });
  }

  /* QR code do app (gerado no aparelho, sem rede), link e passo a passo para iPhone e Android;
     serve para o balcão e para o catálogo impresso, por isso aparece também no app instalado */
  function telaInstalar() {
    setTopo({ titulo: 'Instalar o app', voltarPara: '#/sobre' }); setAba('');
    var url = urlApp('');
    var caixa = el('div', { class: 'qr-caixa', 'aria-busy': 'true' }, [el('span', { class: 'qr-espera', text: 'Gerando o QR code…' })]);
    var copiar = el('button', { type: 'button', class: 'btn btn-primario' }, [svg(ICONES.copiar), 'Copiar link']);
    copiar.addEventListener('click', function () { copiarLink(url); });
    var comp = null;
    if (navigator.share) {
      comp = el('button', { type: 'button', class: 'btn btn-contorno' }, [svg(ICONES.compartilhar), 'Compartilhar link']);
      comp.addEventListener('click', function () { compartilhar('MG Peças Automotivas', 'Catálogo de peças MG no celular', url); });
    }
    var baixarPng = el('button', { type: 'button', class: 'btn btn-contorno', disabled: true }, [svg(ICONES.instalar), 'Baixar PNG']);
    var baixarSvg = el('button', { type: 'button', class: 'btn btn-neutro', disabled: true }, [svg(ICONES.instalar), 'Baixar SVG']);
    function passos(lista) {
      return el('ol', { class: 'passos' }, lista.map(function (t, i) { return el('li', {}, [el('span', { class: 'passo-num', 'aria-hidden': 'true', text: String(i + 1) }), el('span', { html: t })]); }));
    }
    var agora = null, cartaoAgora = null, agoraFim = null;
    if (!emStandalone()) { agora = el('button', { type: 'button', class: 'btn btn-primario so-navegador' }, [svg(ICONES.instalar), 'Instalar agora']); agora.addEventListener('click', pedirInstalacao); }
    /* quando o navegador oferece a instalação (beforeinstallprompt) ou é iPhone/iPad (o botão abre a folha "Adicionar à
       Tela de Início"), o botão sobe para o primeiro cartão; senão fica no fim, depois dos passos */
    function subirBotao() {
      if (!agora || cartaoAgora || !node.isConnected) return;
      if (agoraFim) agoraFim.remove();
      var ios = !promptInstalar && ehIOS();
      cartaoAgora = el('section', { class: 'cartao cartao-agora so-navegador' }, [
        el('h2', { text: 'Instalar neste aparelho' }),
        el('p', { class: 'chamada', text: ios ? 'No Safari, toque em Instalar agora: aparece o passo a passo de "Adicionar à Tela de Início".' : 'Este navegador instala o app com um toque: confirme e o ícone da MG aparece na tela inicial.' }),
        el('div', { class: 'campo' }, [agora])
      ]);
      node.insertBefore(cartaoAgora, node.firstChild);
    }
    function aoInstalavel() { if (!node.isConnected) { document.removeEventListener('mg-instalavel', aoInstalavel); return; } subirBotao(); }
    document.addEventListener('mg-instalavel', aoInstalavel);
    if (agora && !promptInstalar && !ehIOS()) agoraFim = el('div', { class: 'campo' }, [agora]);
    var node = el('div', {}, [
      el('section', { class: 'cartao qr-cartao' }, [
        el('h2', { text: 'QR code do app' }),
        el('p', { class: 'chamada', text: 'Aponte a câmera do celular para o código: o catálogo abre no navegador, pronto para instalar.' }),
        caixa,
        el('p', { class: 'qr-url', text: url }),
        el('div', { class: 'campo' }, [copiar]),
        comp ? el('div', { class: 'campo' }, [comp]) : null,
        el('div', { class: 'grade-2' }, [el('div', { class: 'campo' }, [baixarPng]), el('div', { class: 'campo' }, [baixarSvg])]),
        el('p', { class: 'ajuda', text: 'Para o balcão e o catálogo impresso: baixe o QR e imprima. Depois de instalado, o app abre mesmo sem internet.' })
      ]),
      el('section', { class: 'cartao cartao-passos' }, [
        el('h2', { text: 'No iPhone (Safari)' }),
        passos(['Abra o link no <b>Safari</b> (pelo QR code ou pelo link copiado).', 'Toque em <b>Compartilhar</b>: o quadrado com a seta para cima, na barra de baixo.', 'Role a lista e escolha <b>Adicionar à Tela de Início</b>.', 'Toque em <b>Adicionar</b>. O ícone da MG aparece na tela inicial.'])
      ]),
      el('section', { class: 'cartao cartao-passos' }, [
        el('h2', { text: 'No Android (Chrome)' }),
        passos(['Abra o link no <b>Chrome</b> (pelo QR code ou pelo link copiado).', 'Toque no menu <b>⋮</b> (três pontos), no canto superior direito.', 'Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.', 'Confirme em <b>Instalar</b>. O ícone da MG aparece na tela inicial.']),
        el('p', { class: 'ajuda', text: 'Em outros navegadores (Samsung Internet, Firefox) o caminho é parecido: menu › Adicionar à tela inicial.' }),
        agoraFim
      ])
    ]);
    mostrar(node);
    if (promptInstalar || ehIOS()) subirBotao();
    carregarScript('qr.js').then(function () {
      if (!node.isConnected) return;
      var opcoes = { margem: 4, alt: 'QR code com o link do app da MG' };
      caixa.innerHTML = window.MG_QR.svg(url, opcoes); caixa.removeAttribute('aria-busy');
      /* versão para imprimir: com o endereço escrito embaixo */
      var svgImp = window.MG_QR.svg(url, { margem: 4, largura: 1024, rotulo: url, alt: opcoes.alt });
      baixarSvg.disabled = false; baixarPng.disabled = false;
      baixarSvg.addEventListener('click', function () { baixarArquivo(new Blob([svgImp], { type: 'image/svg+xml;charset=utf-8' }), 'qr-app-mg-pecas.svg'); });
      baixarPng.addEventListener('click', function () {
        var img = new Image(), u = URL.createObjectURL(new Blob([svgImp], { type: 'image/svg+xml;charset=utf-8' }));
        img.onload = function () {
          var c = el('canvas'), lado = 1024; c.width = lado; c.height = Math.round(lado * img.height / img.width) || lado;
          var cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(u);
          c.toBlob(function (b) { if (b) baixarArquivo(b, 'qr-app-mg-pecas.png'); else toast('Não foi possível gerar o PNG. Baixe em SVG.'); }, 'image/png');
        };
        img.onerror = function () { URL.revokeObjectURL(u); toast('Não foi possível gerar o PNG. Baixe em SVG.'); };
        img.src = u;
      });
    }).catch(function (e) { caixa.innerHTML = ''; caixa.removeAttribute('aria-busy'); caixa.appendChild(status('Não foi possível gerar o QR code. Verifique a conexão e tente de novo.', 'erro')); console.error(e); });
  }

  /* ---------- roteador ---------- */
  function renderizar() {
    lembrarRolagem(); /* posição da tela que está saindo (ou da atual, quando só o tema muda) */
    idTela = idDaEntrada(); rolagemAlvo = rolagens[idTela] || 0; /* entrada já visitada (voltar/avançar): abre onde estava */
    var r = rota();
    /* no Início já existe o cartão "Instale o app": a faixa flutuante de instalar fica só nas outras telas (CSS .rota-inicio) */
    document.body.classList.toggle('rota-inicio', r.nome === '');
    document.body.classList.toggle('rota-instalar', r.nome === 'instalar'); /* a tela Instalar já tem o botão: a faixa flutuante some nela (CSS) */
    switch (r.nome) {
      case '': telaInicio(); break;
      case 'placa': telaPlaca(r.q); break;
      case 'busca': telaBusca(r.q); break;
      case 'veiculo': telaVeiculo(r.partes, r.q); break;
      case 'linhas': telaLinhas(); break;
      case 'linha': telaLinha(r.partes[1], r.q); break;
      case 'peca': telaPeca(r.partes[1]); break;
      case 'minhas': telaMinhas(); break;
      case 'sobre': telaSobre(); break;
      case 'instalar': telaInstalar(); break;
      /* endereço desconhecido (link antigo ou digitado errado): avisa e volta ao Início */
      default: toast('Endereço não encontrado'); location.hash = '#/';
    }
  }
  window.addEventListener('hashchange', renderizar);
  var mqEscuro = matchMedia('(prefers-color-scheme: dark)');
  function aoMudarTemaSistema() { if (!ls('mg-tema')) { corDoTema(); renderizar(); } }
  if (mqEscuro.addEventListener) mqEscuro.addEventListener('change', aoMudarTemaSistema); else if (mqEscuro.addListener) mqEscuro.addListener(aoMudarTemaSistema); /* Safari até o 13 só tem addListener */
  corDoTema();

  /* ---------- sem conexão ---------- */
  /* aviso discreto abaixo do topo (navigator.onLine + eventos online/offline); fica no fluxo da página e não bloqueia nada.
     A data é a da última vez que o catálogo foi carregado com conexão (guardada no aparelho); sem ela, a data dos dados. */
  var avisoOffline = document.getElementById('aviso-offline');
  function pintarOffline() {
    if (!avisoOffline) return;
    var off = navigator.onLine === false;
    avisoOffline.hidden = !off;
    if (!off) return;
    var em = ls('mg-dados-em') || (indice && indice.gerado) || '';
    avisoOffline.innerHTML = '';
    avisoOffline.appendChild(svg(ICONES.semRede));
    avisoOffline.appendChild(document.createTextNode(em ? 'Sem conexão · dados guardados em ' + dataBr(em) : 'Sem conexão · usando os dados guardados no aparelho'));
  }
  window.addEventListener('online', pintarOffline);
  window.addEventListener('offline', pintarOffline);
  pintarOffline();

  /* ---------- instalação (PWA) ---------- */
  var promptInstalar = null;
  var faixa = document.getElementById('faixa-instalar'), folhaIos = document.getElementById('folha-ios');
  function emStandalone() { return matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
  function ehIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function podeMostrarFaixa() { var d = +ls('mg-instalar-dispensado') || 0; return !emStandalone() && (Date.now() - d > 7 * 86400000); }
  function pedirInstalacao() {
    if (promptInstalar) { promptInstalar.prompt(); promptInstalar.userChoice.then(function () { promptInstalar = null; faixa.hidden = true; }); return; }
    if (ehIOS()) { abrirFolha(); return; }
    toast('No menu do navegador, toque em “Instalar app” ou “Adicionar à tela inicial”.');
  }
  /* cartão "Instale o app" do Início e faixa flutuante das outras telas: mesmo ícone (icone-192) e mesmos textos */
  function textosInstalar() {
    return { titulo: 'Instale o app da MG', sub: ehIOS() ? 'Toque em Compartilhar › Adicionar à Tela de Início.' : 'Abre direto da tela inicial, mesmo sem internet.', botao: 'Instalar' };
  }
  function cartaoInstalar() {
    if (emStandalone()) return null;
    var t = textosInstalar(), b = el('button', { type: 'button', class: 'btn btn-primario btn-mini', text: t.botao });
    b.addEventListener('click', pedirInstalacao);
    return el('section', { class: 'cartao instalar-cartao so-navegador' }, [
      el('img', { src: 'icones/icone-192.png', alt: '', width: '56', height: '56' }),
      el('div', { class: 'faixa-txt' }, [el('b', { text: t.titulo }), el('span', { text: t.sub }),
        el('a', { class: 'link-acao', href: '#/instalar' }, [svg(ICONES.qr), 'QR code e instruções'])]),
      b
    ]);
  }
  (function () { var t = textosInstalar(); faixa.querySelector('.faixa-txt b').textContent = t.titulo; faixa.querySelector('.faixa-txt span').textContent = t.sub; faixa.querySelector('#btn-instalar').textContent = t.botao; })();
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); promptInstalar = e;
    if (podeMostrarFaixa() && avisoAtualizar.hidden) faixa.hidden = false;
    document.dispatchEvent(new CustomEvent('mg-instalavel')); /* a tela Instalar sobe o botão "Instalar agora" */
  });
  window.addEventListener('appinstalled', function () { faixa.hidden = true; promptInstalar = null; document.querySelectorAll('.cartao-agora').forEach(function (c) { c.remove(); }); toast('App instalado. Abra pela tela inicial.'); });
  document.getElementById('btn-instalar').addEventListener('click', pedirInstalacao);
  document.getElementById('btn-fechar-instalar').addEventListener('click', function () { faixa.hidden = true; ls('mg-instalar-dispensado', String(Date.now())); });
  /* folha do iPhone: foco vai para "Entendi" ao abrir, Esc fecha e o foco volta para quem abriu */
  var folhaAbriuDe = null;
  function fecharFolha() { folhaIos.hidden = true; if (folhaAbriuDe && folhaAbriuDe.focus) folhaAbriuDe.focus(); folhaAbriuDe = null; }
  function abrirFolha() { folhaAbriuDe = document.activeElement; folhaIos.hidden = false; document.getElementById('btn-fechar-ios').focus(); }
  document.getElementById('btn-fechar-ios').addEventListener('click', fecharFolha);
  folhaIos.addEventListener('click', function (e) { if (e.target === folhaIos) fecharFolha(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !folhaIos.hidden) fecharFolha(); });
  if (ehIOS() && !emStandalone() && podeMostrarFaixa()) {
    var visitas = (+ls('mg-visitas') || 0) + 1; ls('mg-visitas', String(visitas));
    if (visitas >= 2) faixa.hidden = false; /* textos do iPhone já vêm de textosInstalar(); "Instalar" abre a folha com o passo a passo */
  }
  /* toast: um único elemento fixo (região viva no index.html), por isso o leitor de tela anuncia cada mensagem */
  var toastTimer = null, toastEl = document.getElementById('toast');
  /* acao (opcional): { texto, href } vira um link no toast (ex.: "Ver" abre Minhas peças); com ação o toast fica 6 s */
  function toast(msg, acao) {
    toastEl.hidden = true; toastEl.textContent = ''; toastEl.classList.remove('com-acao');
    clearTimeout(toastTimer);
    setTimeout(function () {
      toastEl.textContent = '';
      toastEl.appendChild(el('span', { class: 'toast-txt', text: msg }));
      if (acao) {
        var a = el('a', { class: 'toast-acao', href: acao.href, text: acao.texto });
        a.addEventListener('click', function () { toastEl.hidden = true; });
        toastEl.appendChild(a); toastEl.classList.add('com-acao');
      }
      toastEl.hidden = false;
    }, 30);
    toastTimer = setTimeout(function () { toastEl.hidden = true; toastEl.textContent = ''; toastEl.classList.remove('com-acao'); }, acao ? 6000 : 4000);
  }

  /* ---------- service worker e atualização ----------
     Fluxo: o navegador baixa sw.js ao abrir; se mudou (VERSAO nova), o SW novo instala e fica "esperando".
     A barra "Atualização disponível · Atualizar" aparece; ao tocar, o app manda {tipo:'pular'} (skipWaiting), o SW novo
     assume (clients.claim → controllerchange) e a página recarrega UMA vez. Sem toque, a versão nova entra na próxima
     abertura. Na 1ª visita (sem controlador) não recarrega. Também procura atualização ao voltar para a tela
     (visibilitychange), no máximo uma vez por minuto. */
  var regSW = null, temSW = 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  var avisoAtualizar = document.getElementById('aviso-atualizar'), swEsperando = null, ultimaVerificacao = 0;
  function avisarAtualizacao(w) {
    swEsperando = w;
    if (!avisoAtualizar.hidden) return;
    avisoAtualizar.hidden = false; faixa.hidden = true; /* as duas ocupam o mesmo lugar: a atualização tem prioridade */
    anunciar('Atualização do app disponível. Toque em Atualizar.');
  }
  document.getElementById('btn-atualizar').addEventListener('click', function () {
    if (!swEsperando) { avisoAtualizar.hidden = true; return; }
    swEsperando.postMessage({ tipo: 'pular' }); avisoAtualizar.hidden = true; toast('Atualizando…');
    ss('mg-atualizou', CFG.versao || '?'); /* versão que estava rodando: depois da recarga, o toast só sai se ela mudou */
  });
  /* devolve 'nova' (já há um SW esperando), 'ok' (nada novo), 'sem-sw'; com `forcar`, ignora a espera de 1 minuto */
  function verificarAtualizacao(forcar) {
    if (!temSW || !regSW) return Promise.resolve('sem-sw');
    if (!forcar && Date.now() - ultimaVerificacao < 60000) return Promise.resolve(regSW.waiting ? 'nova' : 'ok');
    ultimaVerificacao = Date.now();
    return regSW.update().then(function () {
      return new Promise(function (ok) {
        /* dá um tempo para o SW novo (se houver) terminar de instalar */
        var tentativas = 0; (function espera() { if (regSW.waiting || (regSW.installing && ++tentativas < 40)) { if (regSW.waiting) return ok('nova'); return setTimeout(espera, 250); } ok(regSW.waiting ? 'nova' : 'ok'); })();
      });
    });
  }
  if (temSW) {
    window.addEventListener('load', function () {
      var tinhaControlador = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        regSW = reg; ultimaVerificacao = Date.now();
        if (reg.waiting && navigator.serviceWorker.controller) avisarAtualizacao(reg.waiting);
        reg.addEventListener('updatefound', function () {
          var w = reg.installing; if (!w) return;
          w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) avisarAtualizacao(w); });
        });
      }).catch(function (e) { console.warn('SW', e); });
      var recarregou = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () { if (recarregou || !tinhaControlador) return; recarregou = true; location.reload(); });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') verificarAtualizacao(false).catch(function () {}); });
    });
  }

  /* ---------- início ---------- */
  window.MG_APP = { buscarTexto: buscarTexto, buscarVeiculo: buscarVeiculo, urlMercadoLivre: urlMercadoLivre, casarVeiculo: casarVeiculo, dados: function () { return dadosBase().then(function () { return { indice: indice, produtos: produtos }; }); } };
  renderizar();
  /* recarregou pelo "Atualizar": confirma com a versão que está rodando, uma vez só (a marca da sessão é apagada) e só se a
     versão de fato mudou (recarga sem SW novo, ou a marca presa por um controllerchange que não veio, não avisa nada) */
  var versaoAntes = ss('mg-atualizou');
  if (versaoAntes) { ss('mg-atualizou', null); if (versaoAntes !== (CFG.versao || '?')) toast('App atualizado · versão ' + (CFG.versao || '')); }
  /* detalhes.json só depois da 1ª tela; em seguida pede ao SW para guardar detalhes e marcas para o uso offline
     (pré-cache enxuto na instalação; nada disso quando o aparelho está em economia de dados) */
  function aquecerOffline() {
    var con = navigator.connection; if (con && con.saveData) return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) { if (reg.active) reg.active.postMessage({ tipo: 'aquecer' }); }).catch(function () {});
  }
  function depoisDoIdle() { dadosImagens().then(function () { return dadosDetalhes(); }).catch(function () {}).then(function () { setTimeout(aquecerOffline, 2000); }); }
  dadosBase().then(function () { if ('requestIdleCallback' in window) requestIdleCallback(depoisDoIdle); else setTimeout(depoisDoIdle, 1500); }).catch(function (e) {
    tela.innerHTML = ''; tela.appendChild(status('Não foi possível carregar o catálogo. Verifique a conexão e abra o app de novo.', 'erro')); console.error(e);
  });
})();

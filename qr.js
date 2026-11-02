/* Gerador de QR code — MG Peças Automotivas (catálogo PWA)
   Sem dependências nem rede: modo byte (UTF-8), correção de erros nível M, versões 1 a 10 (até 213 bytes).
   Segue a ISO/IEC 18004: Reed-Solomon em GF(256), padrões de função, escolha de máscara por penalidade,
   bits de formato (BCH 15,5) e de versão (BCH 18,6).
   Uso: MG_QR.matriz(texto) → { n, versao, mascara, m } (m[linha][coluna] = 1 escuro);
        MG_QR.svg(texto, { margem: 4, cor: '#000', fundo: '#fff', rotulo: 'texto abaixo' }) → string SVG.
   Carregado só na tela "Instalar" (#/instalar). */
(function () {
  'use strict';
  /* GF(256), polinômio 0x11d */
  var EXP = [], LOG = [];
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function gerador(n) {
    var g = [1];
    for (var i = 0; i < n; i++) { var ng = []; for (var k = 0; k <= g.length; k++) ng[k] = 0; for (var j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); } g = ng; }
    return g;
  }
  function reedSolomon(dados, nEc) {
    var g = gerador(nEc), r = dados.slice(); for (var k = 0; k < nEc; k++) r.push(0);
    for (var i = 0; i < dados.length; i++) { var c = r[i]; if (c) for (var j = 0; j < g.length; j++) r[i + j] ^= mul(g[j], c); }
    return r.slice(dados.length);
  }
  /* nível M, versões 1..10: total de palavras, palavras de EC por bloco, nº de blocos */
  var TOTAL = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  var EC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var BLOCOS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var ALINH = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  function capacidade(v) { return Math.floor(((TOTAL[v - 1] - EC[v - 1] * BLOCOS[v - 1]) * 8 - 4 - (v < 10 ? 8 : 16)) / 8); }
  function utf8(s) { var out = [], b = unescape(encodeURIComponent(s)); for (var i = 0; i < b.length; i++) out.push(b.charCodeAt(i)); return out; }

  function palavras(bytes, v) {
    var nDados = TOTAL[v - 1] - EC[v - 1] * BLOCOS[v - 1], bits = [];
    function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, nDados * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    var dados = []; for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; dados.push(b); }
    for (var p = 0; dados.length < nDados; p++) dados.push(p % 2 ? 0x11 : 0xec);
    /* blocos: os primeiros (nBlocos - longos) curtos, os últimos com 1 palavra a mais; dados e EC intercalados */
    var nb = BLOCOS[v - 1], curto = Math.floor(nDados / nb), longos = nDados % nb, blocos = [], pos = 0;
    for (var k = 0; k < nb; k++) { var tam = curto + (k >= nb - longos ? 1 : 0); var d = dados.slice(pos, pos + tam); pos += tam; blocos.push({ d: d, e: reedSolomon(d, EC[v - 1]) }); }
    var saida = [];
    for (i = 0; i < curto + 1; i++) blocos.forEach(function (b) { if (i < b.d.length) saida.push(b.d[i]); });
    for (i = 0; i < EC[v - 1]; i++) blocos.forEach(function (b) { saida.push(b.e[i]); });
    return saida;
  }

  function matriz(texto) {
    var bytes = utf8(String(texto)), v = 1;
    while (v <= 10 && capacidade(v) < bytes.length) v++;
    if (v > 10) throw new Error('Texto longo demais para o QR (máx. 213 bytes)');
    var n = 17 + 4 * v, m = [], fn = [];
    for (var i = 0; i < n; i++) { m.push([]); fn.push([]); for (var j = 0; j < n; j++) { m[i][j] = 0; fn[i][j] = false; } }
    function set(r, c, val) { m[r][c] = val ? 1 : 0; fn[r][c] = true; }
    function localizador(r, c) { for (var dr = -4; dr <= 4; dr++) for (var dc = -4; dc <= 4; dc++) { var rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue; var d = Math.max(Math.abs(dr), Math.abs(dc)); set(rr, cc, d !== 2 && d !== 4); } }
    localizador(3, 3); localizador(3, n - 4); localizador(n - 4, 3);
    for (i = 0; i < n; i++) { if (!fn[6][i]) set(6, i, i % 2 === 0); if (!fn[i][6]) set(i, 6, i % 2 === 0); }
    var al = ALINH[v - 1];
    al.forEach(function (r) { al.forEach(function (c) {
      if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (c === 6 && r === al[al.length - 1])) return;
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }); });
    /* reserva das áreas de formato (e versão) */
    for (i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, 0); if (!fn[i][8]) set(i, 8, 0); }
    for (i = 0; i < 8; i++) { if (!fn[8][n - 1 - i]) set(8, n - 1 - i, 0); if (!fn[n - 1 - i][8]) set(n - 1 - i, 8, 0); }
    set(n - 8, 8, 1);
    if (v >= 7) {
      var rem = v; for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      var vb = (v << 12) | rem;
      for (i = 0; i < 18; i++) { var bit = (vb >> i) & 1, a = n - 11 + (i % 3), b = Math.floor(i / 3); set(b, a, bit); set(a, b, bit); }
    }
    /* dados em zigue-zague, da direita para a esquerda, pulando a coluna 6 */
    var cw = palavras(bytes, v), total = cw.length * 8, k = 0;
    for (var dir = n - 1; dir >= 1; dir -= 2) {
      if (dir === 6) dir = 5;
      for (var vert = 0; vert < n; vert++) for (var j = 0; j < 2; j++) {
        var c = dir - j, sobe = ((dir + 1) & 2) === 0, r = sobe ? n - 1 - vert : vert;
        if (!fn[r][c]) { m[r][c] = k < total ? (cw[k >> 3] >> (7 - (k & 7))) & 1 : 0; k++; }
      }
    }
    var MASC = [
      function (r, c) { return (r + c) % 2 === 0; }, function (r) { return r % 2 === 0; }, function (r, c) { return c % 3 === 0; },
      function (r, c) { return (r + c) % 3 === 0; }, function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
      function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; }, function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
      function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
    ];
    function aplicar(mk) { for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (!fn[r][c] && MASC[mk](r, c)) m[r][c] ^= 1; }
    function formato(mk) {
      var dados = mk, rem = dados; /* nível M = 00 */
      for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((dados << 10) | rem) ^ 0x5412;
      function g(i) { return (bits >> i) & 1; }
      for (i = 0; i <= 5; i++) set(i, 8, g(i));
      set(7, 8, g(6)); set(8, 8, g(7)); set(8, 7, g(8));
      for (i = 9; i < 15; i++) set(8, 14 - i, g(i));
      for (i = 0; i < 8; i++) set(8, n - 1 - i, g(i));
      for (i = 8; i < 15; i++) set(n - 15 + i, 8, g(i));
      set(n - 8, 8, 1);
    }
    function penalidade() {
      var p = 0, r, c, escuros = 0;
      function corridas(get) {
        for (var a = 0; a < n; a++) { var run = 1, hist = [0, 0, 0, 0, 0, 0, 0]; for (var b = 0; b < n; b++) {
          var atual = get(a, b);
          if (b > 0 && atual === get(a, b - 1)) run++;
          if (b === n - 1 || atual !== get(a, b + 1)) { if (run >= 5) p += 3 + run - 5; hist.shift(); hist.push(run); run = 1; /* padrão 1:1:3:1:1 com 4 claros de um lado */
            if (!atual && hist[1] && hist[2] === hist[1] && hist[3] === 3 * hist[1] && hist[4] === hist[1] && hist[5] === hist[1] && (hist[0] >= 4 * hist[1] || hist[6] >= 4 * hist[1])) p += 40; }
        } }
      }
      corridas(function (a, b) { return m[a][b]; }); corridas(function (a, b) { return m[b][a]; });
      for (r = 0; r < n - 1; r++) for (c = 0; c < n - 1; c++) { var s = m[r][c] + m[r][c + 1] + m[r + 1][c] + m[r + 1][c + 1]; if (s === 0 || s === 4) p += 3; }
      for (r = 0; r < n; r++) for (c = 0; c < n; c++) escuros += m[r][c];
      var tot = n * n, kk = Math.ceil(Math.abs(escuros * 20 - tot * 10) / tot) - 1; p += 10 * kk;
      return p;
    }
    var melhor = 0, menor = Infinity;
    for (var mk = 0; mk < 8; mk++) { aplicar(mk); formato(mk); var pen = penalidade(); if (pen < menor) { menor = pen; melhor = mk; } aplicar(mk); }
    aplicar(melhor); formato(melhor);
    return { n: n, versao: v, mascara: melhor, m: m };
  }

  function escapar(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* SVG com zona de silêncio (margem em módulos) e rótulo opcional abaixo */
  function svg(texto, o) {
    o = o || {};
    var q = matriz(texto), mg = o.margem == null ? 4 : o.margem, n = q.n, lado = n + 2 * mg, alt = lado + (o.rotulo ? 3 : 0), d = '';
    for (var r = 0; r < n; r++) { var c = 0; while (c < n) { if (q.m[r][c]) { var ini = c; while (c < n && q.m[r][c]) c++; d += 'M' + (ini + mg) + ' ' + (r + mg) + 'h' + (c - ini) + 'v1h-' + (c - ini) + 'z'; } else c++; } }
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + lado + ' ' + alt + '" width="' + (o.largura || 256) + '" shape-rendering="crispEdges" role="img" aria-label="' + escapar(o.alt || 'QR code: ' + texto) + '">' +
      '<rect width="' + lado + '" height="' + alt + '" fill="' + (o.fundo || '#fff') + '"/><path d="' + d + '" fill="' + (o.cor || '#000') + '"/>';
    if (o.rotulo) s += '<text x="' + (lado / 2) + '" y="' + (lado + 1.6) + '" text-anchor="middle" font-family="Barlow, Arial, sans-serif" font-size="1.5" fill="' + (o.cor || '#000') + '">' + escapar(o.rotulo) + '</text>';
    return s + '</svg>';
  }
  window.MG_QR = { matriz: matriz, svg: svg, capacidade: capacidade };
})();

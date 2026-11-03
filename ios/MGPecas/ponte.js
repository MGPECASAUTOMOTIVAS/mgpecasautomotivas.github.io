/* Ponte entre o catálogo (página) e o app do iPhone. Injetada pelo WebViewController no início de cada página do
   catálogo, só no quadro principal. Não muda nada no catálogo: só troca duas funções do navegador pelas do iPhone.
   - window.print(): abre a impressão do iPhone (imprimir ou salvar em PDF). Ao fechar, a página recebe "afterprint"
     (o catálogo usa esse aviso para tirar a folha de impressão da tela).
   - navigator.share(): abre a folha de compartilhar do iPhone. Resolve quando a pessoa compartilha e rejeita com
     AbortError quando ela cancela, como no Safari. */
(function () {
  'use strict';
  if (window.__mgPonteIOS) return;
  var canal = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mgApp;
  if (!canal) return;
  window.__mgPonteIOS = true;

  /* ---------- imprimir ---------- */
  window.print = function () {
    try { window.dispatchEvent(new Event('beforeprint')); } catch (e) {}
    canal.postMessage({ tipo: 'imprimir', titulo: String(document.title || '') });
  };
  window.__mgImpressaoFechada = function () {
    try { window.dispatchEvent(new Event('afterprint')); } catch (e) {}
  };

  /* ---------- compartilhar ---------- */
  var proximo = 1, pendentes = {};
  function texto(v) { return v == null ? '' : String(v); }
  function compartilhar(dados) {
    dados = dados || {};
    return new Promise(function (ok, falha) {
      var id = proximo++, url = '';
      pendentes[id] = { ok: ok, falha: falha };
      if (dados.url != null && dados.url !== '') {
        try { url = new URL(String(dados.url), location.href).href; } catch (e) { url = String(dados.url); }
      }
      canal.postMessage({ tipo: 'compartilhar', id: id, titulo: texto(dados.title), texto: texto(dados.text), url: url });
    });
  }
  window.__mgCompartilhamentoFim = function (id, erro) {
    var p = pendentes[id];
    if (!p) return;
    delete pendentes[id];
    if (!erro) { p.ok(); return; }
    var nome = erro === 'cancelado' ? 'AbortError' : 'NotAllowedError', falha;
    try { falha = new DOMException(erro === 'cancelado' ? 'Compartilhamento cancelado.' : 'Não foi possível compartilhar.', nome); }
    catch (e) { falha = new Error(nome); falha.name = nome; }
    p.falha(falha);
  };
  function podeCompartilhar(dados) {
    if (!dados || (dados.files && dados.files.length)) return false;
    return dados.title != null || dados.text != null || dados.url != null;
  }
  function definir(alvo) {
    Object.defineProperty(alvo, 'share', { value: compartilhar, configurable: true, writable: true });
    Object.defineProperty(alvo, 'canShare', { value: podeCompartilhar, configurable: true, writable: true });
  }
  try { definir(navigator); } catch (e) { try { definir(Navigator.prototype); } catch (e2) {} }
})();

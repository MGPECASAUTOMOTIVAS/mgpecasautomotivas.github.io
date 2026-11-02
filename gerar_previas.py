#!/usr/bin/env python3
"""Gera as páginas de prévia p/<CÓDIGO>.html, uma por peça, a partir dos dados do app.

Por que existem: o link da ficha (#/peca/MG001) tem o código depois do "#", que não chega ao servidor, então a prévia
nos aplicativos de mensagem e redes era sempre a genérica. Cada página aqui é pequena (~1 KB), tem og:title com o nome e o
código da peça, og:description com as aplicações (só dados do catálogo, nada de venda), og:image com a foto da peça (ou a
capa-social.jpg quando não há foto) e redireciona na hora para a ficha no app (meta refresh 0 + script).

Foto da prévia: imagens.json só oferece a foto do CDN da loja em WebP (base + nome + sufixo "-320-0.webp", trocado por 640 px
aqui). Alguns robôs de prévia não aceitam WebP ou foto hospedada fora do domínio, então cada página leva: 1) a foto da peça
(se o dado um dia trouxer variante JPG/PNG, em `sufixoPrevia` ou em endereço absoluto .jpg/.png no item, ela passa na
frente sozinha), 2) uma segunda og:image com a capa-social.jpg (JPEG, com og:image:type, width e height lidos do arquivo),
usada pelos robôs que recusam a primeira, e 3) twitter:image com a mesma foto. Nenhuma foto é copiada para o repositório.

Rodar (nesta pasta ou de qualquer lugar, leva menos de 1 s):
    python3 -I gerar_previas.py
Depois de regerar dados/produtos.json, detalhes.json ou imagens.json, rodar de novo e publicar a pasta p/.
Nada é inventado: só o que está em produtos.json, detalhes.json e imagens.json.
"""
import html
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
DADOS = os.path.join(AQUI, 'dados')
SAIDA = os.path.join(AQUI, 'p')
MAX_VEICULOS = 4

LINHAS = {
    'filtro-ar': 'Mangueiras do Filtro de Ar', 'arrefecimento': 'Mangueiras de Arrefecimento', 'respiro': 'Respiro e Rabichos',
    'reservatorios': 'Reservatórios de Expansão', 'tampas-reservatorio': 'Tampas de Reservatório',
    'tubos-conexoes': 'Tubos, Flanges e Conectores', 'tampas-comando': 'Tampas de Comando de Válvulas', 'suspensao': 'Suspensão',
    'metal-borracha': 'Metal-Borracha', 'coifas': 'Coifas', 'direcao': 'Direção Hidráulica', 'combustivel': 'Combustível',
    'pesada': 'Diversos e Linha Pesada', 'outros': 'Outras Peças',
}


def ler_json(nome):
    with open(os.path.join(DADOS, nome), encoding='utf-8') as f:
        return json.load(f)


def url_app():
    """urlApp do config.js (único lugar a mudar); sem ela, o endereço do GitHub Pages."""
    with open(os.path.join(AQUI, 'config.js'), encoding='utf-8') as f:
        m = re.search(r"urlApp:\s*'([^']*)'", f.read())
    u = (m.group(1) if m else '') or 'https://mgpecasautomotivas.github.io/'
    return u if u.endswith('/') else u + '/'


JPG_PNG = re.compile(r'\.(jpe?g|png)(\?.*)?$', re.I)


def foto(imagens, idx):
    """Endereço da foto da peça para a prévia: variante JPG/PNG se o dado tiver (sufixoPrevia ou item em endereço absoluto
    .jpg/.png); senão a foto do CDN em 640 px (hoje só WebP). None sem foto."""
    v = imagens.get('itens', {}).get(str(idx))
    if not v:
        return None
    if re.match(r'^(https?:)?//', v):
        return v
    suf = imagens.get('sufixoPrevia') or re.sub(r'-\d+-0\.', '-640-0.', imagens.get('sufixo', ''))
    return imagens.get('base', '') + v + suf


def tamanho_jpeg(caminho):
    """(largura, altura) de um JPEG lendo só os marcadores SOF; (0, 0) se não der para ler."""
    try:
        with open(caminho, 'rb') as f:
            dados = f.read()
        i = 2
        while i + 9 < len(dados) and dados[i] == 0xFF:
            marcador, tam = dados[i + 1], int.from_bytes(dados[i + 2:i + 4], 'big')
            if marcador in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                return int.from_bytes(dados[i + 7:i + 9], 'big'), int.from_bytes(dados[i + 5:i + 7], 'big')
            i += 2 + tam
    except OSError:
        pass
    return 0, 0


def descricao(det):
    """Linha da peça e os veículos da aplicação, sem repetir e sem inventar."""
    partes = []
    linha = LINHAS.get(det.get('l', ''))
    if linha:
        partes.append(linha)
    vistos, veics = set(), []
    for a in det.get('a') or []:
        v = (a[0] or '').strip()
        if v and v not in vistos:
            vistos.add(v)
            veics.append(v)
    if veics:
        txt = ', '.join(veics[:MAX_VEICULOS])
        if len(veics) > MAX_VEICULOS:
            txt += ' e mais %d' % (len(veics) - MAX_VEICULOS)
        partes.append('Aplicações: ' + txt)
    return ' · '.join(partes) if partes else 'Peça do catálogo MG'


MODELO = (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
    '<title>{titulo}</title><meta name="robots" content="noindex">'
    '<meta property="og:type" content="website"><meta property="og:site_name" content="MG Peças Automotivas">'
    '<meta property="og:title" content="{titulo}"><meta property="og:description" content="{desc}">'
    '{imagens}<meta property="og:url" content="{url}">'
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{img}">'
    '<meta name="twitter:image:alt" content="{alt}">'
    '<meta http-equiv="refresh" content="0;url={dest}">'
    # aberta pelo app da Google Play (1ª página com referrer android-app://...): a marca fica na sessão antes de ir ao app,
    # que esconde tudo o que é instalar (app.js, APP_LOJA); no navegador nada muda
    '<script>try{{/^android-app:\\/\\/br\\.com\\.mgpecasautomotivas\\.catalogo(?=$|[\\/?#])/.test(document.referrer)'
    '&&sessionStorage.setItem("mg-app-loja","android")}}catch(e){{}}location.replace("{dest}")</script>'
    '</head><body><a href="{dest}">Abrir {cod} no app MG Peças</a></body></html>\n'
)


def main():
    produtos = ler_json('produtos.json')
    detalhes = ler_json('detalhes.json').get('itens', {})
    imagens = ler_json('imagens.json')
    base = url_app()
    capa = base + 'icones/capa-social.jpg'
    cw, ch = tamanho_jpeg(os.path.join(AQUI, 'icones', 'capa-social.jpg'))
    meta_capa = '<meta property="og:image" content="%s"><meta property="og:image:type" content="image/jpeg">' % html.escape(capa)
    if cw and ch:
        meta_capa += '<meta property="og:image:width" content="%d"><meta property="og:image:height" content="%d">' % (cw, ch)
    meta_capa += '<meta property="og:image:alt" content="MG Peças Automotivas">'
    com_jpg_png = 0
    os.makedirs(SAIDA, exist_ok=True)
    existentes = {n for n in os.listdir(SAIDA) if n.endswith('.html')}
    gerados, pulados, total = set(), [], 0
    for idx, p in enumerate(produtos):
        cod, nome = str(p[0]).strip(), str(p[1]).strip()
        if not re.fullmatch(r'[A-Za-z0-9-]+', cod):
            pulados.append(cod)
            continue
        det = detalhes.get(cod, {})
        dest = '../#/peca/' + cod
        img = foto(imagens, idx)
        alt = html.escape('%s %s' % (nome, cod))
        if img:
            # foto da peça primeiro; a capa entra como 2ª og:image, para robôs que recusam WebP ou foto fora do domínio
            if JPG_PNG.search(img):
                com_jpg_png += 1
            metas = '<meta property="og:image" content="%s"><meta property="og:image:alt" content="%s">%s' % (html.escape(img), alt, meta_capa)
        else:
            metas = meta_capa
        pagina = MODELO.format(
            titulo=html.escape('%s %s · MG Peças' % (nome, cod)),
            desc=html.escape(descricao(det)),
            imagens=metas,
            img=html.escape(img or capa),
            alt=alt if img else 'MG Peças Automotivas',
            url=html.escape('%sp/%s.html' % (base, cod)),
            dest=html.escape(dest),
            cod=html.escape(cod),
        )
        arq = cod + '.html'
        gerados.add(arq)
        caminho = os.path.join(SAIDA, arq)
        novo = pagina.encode('utf-8')
        total += len(novo)
        if os.path.exists(caminho):
            with open(caminho, 'rb') as f:
                if f.read() == novo:
                    continue
        with open(caminho, 'wb') as f:
            f.write(novo)
    for velho in sorted(existentes - gerados):  # peça que saiu do catálogo
        os.remove(os.path.join(SAIDA, velho))
        print('removida:', velho)
    print('%d páginas em %s (%.0f KB)' % (len(gerados), os.path.relpath(SAIDA, os.getcwd()), total / 1024))
    print('fotos: %d em JPG/PNG, %d só no CDN (WebP) com capa-social.jpg de reserva (%dx%d)' % (com_jpg_png, len(gerados) - com_jpg_png, cw, ch))
    if pulados:
        print('códigos pulados (caracteres fora de A-Z, 0-9 e hífen):', ', '.join(pulados))
    return 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""Шрифты интерфейса: качает исходники (OFL/Apache) из google/fonts, режет до латиницы+кириллицы,
жмёт в woff2 и пишет css/fonts.css. У каждого шрифта свой size-adjust относительно Nunito
(«Мягкий», по умолчанию) — по высоте строчных и средней ширине русского/английского текста.
Поэтому при смене шрифта кегль и вёрстка не прыгают: «Пиксели» больше не раздувают всё в 2 раза.

Запуск: python3 ui/tools/fonts.py [--force]   (нужны fonttools и brotli: pip install fonttools brotli)
"""
import io, math, pathlib, sys, urllib.request, urllib.parse
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools import subset
from fontTools.varLib import instancer

T = pathlib.Path(__file__).parent
UI = T.parent
OUT = UI / 'fonts'
CACHE = T / '.fonts-src'
GF = 'https://raw.githubusercontent.com/google/fonts/main/'
LAT = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
CYR = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116'
KEEP = LAT + ', ' + CYR + ', U+20BD'
SAMPLE = 'Привет, бро! Как дела? Зайдёшь вечером в войс — поиграем в Minecraft 1.21, ок? Hunty лучше всех'

# key, подпись, файлы [(woff2, unicode-range|None)], веса, откуда взять (google/fonts путь, оси)
FONTS = [
    ('soft', 'Мягкий', [('nunito.woff2', None)], '200 1000', None),
    ('onest', 'Простой', [('onest-lat.woff2', LAT), ('onest-cyr.woff2', CYR)], '400 800', None),
    ('round', 'Круглый', [('comfortaa.woff2', None)], '300 700', None),
    ('book', 'Книжный', [('literata.woff2', None)], '400 700', ('ofl/literata/Literata[opsz,wght].ttf', {'opsz': 12, 'wght': (400, 700)})),
    ('slab', 'Брусок', [('robotoslab.woff2', None)], '400 700', ('apache/robotoslab/RobotoSlab[wght].ttf', {'wght': (400, 700)})),
    ('wide', 'Широкий', [('unbounded.woff2', None)], '400 700', ('ofl/unbounded/Unbounded[wght].ttf', {'wght': (400, 700)})),
    ('hand', 'Рукописный', [('caveat.woff2', None)], '400 700', ('ofl/caveat/Caveat[wght].ttf', {'wght': (400, 700)})),
    ('comic', 'Комикс', [('pangolin.woff2', None)], '400', ('ofl/pangolin/Pangolin-Regular.ttf', {})),
    ('mono', 'Консоль', [('jbmono-lat.woff2', LAT), ('jbmono-cyr.woff2', CYR)], '400 700', None),
    ('pixel', 'Пиксели', [('pix-lat.woff2', LAT), ('pix-cyr.woff2', CYR)], '400', None),
    ('board', 'Табло', [('handjet.woff2', None)], '400 700', ('ofl/handjet/Handjet[ELGR,ELSH,wght].ttf', {'ELGR': 1, 'ELSH': 2, 'wght': (400, 700)})),
]


def fetch(path):
    CACHE.mkdir(exist_ok=True)
    f = CACHE / pathlib.Path(path).name
    if not f.exists():
        urllib.request.urlretrieve(GF + urllib.parse.quote(path), f)
    return f


def build(src, axes, dst):
    f = TTFont(src)
    if axes and 'fvar' in f:
        f = instancer.instantiateVariableFont(f, axes)
        buf = io.BytesIO()
        f.save(buf)
        buf.seek(0)
        f = TTFont(buf)
    opt = subset.Options()
    opt.flavor = 'woff2'
    opt.hinting = False
    opt.desubroutinize = True
    opt.layout_features = ['kern', 'liga', 'calt', 'locl', 'mark', 'mkmk', 'ccmp', 'case', 'tnum', 'lnum', 'pnum']
    opt.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    s = subset.Subsetter(opt)
    s.populate(unicodes=subset.parse_unicodes(KEEP.replace('U+', '').replace(' ', '')))
    s.subset(f)
    subset.save_font(f, str(dst), opt)


def metrics(files):
    fonts = [TTFont(OUT / n) for n, _ in files]

    def find(c):
        for f in fonts:
            g = f.getBestCmap().get(ord(c))
            if g:
                return f, g
        raise SystemExit(f'нет глифа {c!r} в {files}')

    def top(c):
        f, g = find(c)
        gs = f.getGlyphSet()
        bp = BoundsPen(gs)
        gs[g].draw(bp)
        return bp.bounds[3] / f['head'].unitsPerEm

    xh = sum(top(c) for c in 'xoaонае') / 7
    w = sum(f['hmtx'][g][0] / f['head'].unitsPerEm for f, g in (find(c) for c in SAMPLE)) / len(SAMPLE)
    return xh, w


def main():
    OUT.mkdir(exist_ok=True)
    for key, _, files, _, src in FONTS:
        if src and ('--force' in sys.argv or not (OUT / files[0][0]).exists()):
            build(fetch(src[0]), src[1], OUT / files[0][0])
    ref = metrics(FONTS[0][2])
    css = ['/* Сгенерировано ui/tools/fonts.py — руками не править. Шрифты: OFL 1.1 / Apache 2.0, см. fonts/LICENSE.md */',
           '/* У каждого шрифта интерфейса свой size-adjust: на глаз и по ширине он как «Мягкий» (Nunito) — вёрстка не прыгает. */']
    prev = []
    for key, label, files, wt, _ in FONTS:
        xh, w = metrics(files)
        xr, wr = ref[0] / xh, ref[1] / w
        sa = min(math.sqrt(xr * wr), 1.15 * wr)  # среднее по высоте и ширине, но не шире «Мягкого» больше чем на 15%
        sa = round(sa * 100)
        for n, ur in files:
            rule = f'@font-face{{font-family:"hu-{key}";src:url(../fonts/{n}) format("woff2");font-weight:{wt};font-display:swap'
            if sa != 100:
                rule += f';size-adjust:{sa}%'
            if ur:
                rule += f';unicode-range:{ur}'
            css.append(rule + '}')
        print(f'{key:7} {label:12} size-adjust {sa:3}%   ширина {sa / 100 / wr - 1:+.0%}  высота строчных {sa / 100 / xr - 1:+.0%}')
        prev.append(f'.ff-{key}{{font-family:"hu-{key}",sans-serif}}')
    # «Pix» как есть (без выравнивания) — для пиксельных наклеек и пузырей, где кегль подобран под сетку шрифта
    for n, ur in (('pix-lat.woff2', LAT), ('pix-cyr.woff2', CYR)):
        css.append(f'@font-face{{font-family:"Pix";src:url(../fonts/{n}) format("woff2");font-display:block;unicode-range:{ur}}}')
    css.append(':root{--sans:"hu-soft",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}')
    for key, *_ in FONTS[1:]:
        css.append(f'html[data-font="{key}"]{{--sans:"hu-{key}","hu-soft",ui-sans-serif,system-ui,sans-serif}}')
    css.append('html[data-font="system"]{--sans:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,sans-serif}')
    css.append('html[data-font="pixel"] body{letter-spacing:.01em}')
    css.extend(prev)
    css.append('.ff-system{font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}')
    (UI / 'css' / 'fonts.css').write_text('\n'.join(css) + '\n', encoding='utf-8')
    tot = sum(p.stat().st_size for p in OUT.glob('*.woff2'))
    print(f'css/fonts.css · {len(list(OUT.glob("*.woff2")))} файлов, {tot // 1024} КБ')


if __name__ == '__main__':
    main()

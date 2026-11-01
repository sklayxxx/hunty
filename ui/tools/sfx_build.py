# Сборка звуков Hunty (ui/sfx/*.ogg): CC0-исходники → обрезка тишины, выравнивание громкости → Opus/Ogg mono 48 кГц
# Исходники и авторы — docs/SOUNDS.md. Запуск: SND=папка_с_паками python3 ui/tools/sfx_build.py [имена…] (нужны ffmpeg и numpy)
import subprocess, numpy as np, os, sys, json
K = os.environ.get('SND', 'snd-src'); I = K + '/interface-sounds/Audio/'; J = K + '/music-jingles/Audio/'; F = K + '/fsd/'
SR = 48000
UI = {  # имя: (файл, опции)
  'msg': (I + 'drop_002.ogg', {}), 'mention': (I + 'confirmation_002.ogg', {}), 'friend': (I + 'confirmation_004.ogg', {}), 'online': (I + 'glass_001.ogg', {}),
  'ring': (J + 'Steel jingles/jingles_STEEL10.ogg', {'rep': 2, 'gap': .22}), 'ringback': (J + 'Steel jingles/jingles_STEEL16.ogg', {'lp': 2400, 'db': -3}),
  'hangup': (I + 'minimize_005.ogg', {}),
  'join': (I + 'confirmation_001.ogg', {}), 'leave': (I + 'question_002.ogg', {}), 'pjoin': (I + 'maximize_009.ogg', {}), 'pleave': (I + 'minimize_009.ogg', {}),
  'mute': (I + 'minimize_008.ogg', {}), 'unmute': (I + 'maximize_008.ogg', {}), 'deaf': (I + 'minimize_006.ogg', {}), 'undeaf': (I + 'maximize_006.ogg', {}),
  'streamon': (I + 'open_002.ogg', {}), 'streamoff': (I + 'close_002.ogg', {}),
  'clip': (F + '170229.mp3', {}), 'hall': (J + '8-Bit jingles/jingles_NES12.ogg', {'db': -2}), 'nudge': (K + '/impact-sounds/Audio/impactPunch_medium_000.ogg', {}),
  'roll': (I + 'question_003.ogg', {}), 'tick': (I + 'tick_004.ogg', {}), 'allhere': (J + '8-Bit jingles/jingles_NES08.ogg', {'db': -2}),
  'say': (I + 'pluck_001.ogg', {}), 'brb': (I + 'bong_001.ogg', {}),
  'pop': (I + 'pluck_002.ogg', {}), 'boom': (K + '/sci-fi-sounds/Audio/explosionCrunch_000.ogg', {'t': 1.4, 'fade': .3}), 'cash': (F + '209578.mp3', {'t': 1.5, 'fade': .25}),
  'confetti': (J + 'Pizzicato jingles/jingles_PIZZI02.ogg', {}), 'shake': (K + '/rpg-audio/Audio/metalPot2.ogg', {'db': -2}),
  'ok': (I + 'select_006.ogg', {}), 'err': (I + 'error_006.ogg', {}), 'egg': (J + '8-Bit jingles/jingles_NES03.ogg', {'db': -2}),
}
SB = {
  'horn': (F + '414208.mp3', {}), 'drum': (F + '132418.mp3', {}), 'sad': (F + '175409.mp3', {'t': 4.2, 'fade': .5}),
  'clap': (F + '32260.mp3', {'t': 4, 'fade': 1}), 'boing': (F + '540790.mp3', {}), 'laser': (K + '/digital-audio/Audio/laser5.ogg', {'rep': 2, 'gap': .05}),
  'win': (F + '397355.mp3', {}), 'cricket': (F + '129678.mp3', {'ss': 2, 't': 3.2, 'fin': .3, 'fade': .6}),
  'roll': (F + '191718.mp3', {'t': 4, 'fade': .4}), 'buzz': (F + '331912.mp3', {}), 'ding': (F + '335908.mp3', {}), 'laugh': (F + '478934.mp3', {}),
}
def load(f, o):
    a = ['ffmpeg', '-v', 'quiet']
    if o.get('ss'): a += ['-ss', str(o['ss'])]
    a += ['-i', f, '-ac', '1', '-ar', str(SR)]
    if o.get('lp'): a += ['-af', 'lowpass=f=%d' % o['lp']]
    a += ['-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(a, capture_output=True).stdout, dtype=np.float32).copy()
def trim(x, db=-48):
    a = np.abs(x); thr = a.max() * 10 ** (db / 20); nz = np.where(a > thr)[0]
    if not len(nz): return x
    s = max(0, nz[0] - int(SR * .003)); e = min(len(x), nz[-1] + int(SR * .03))
    return x[s:e]
def stm(y, w):
    return max(np.sqrt(np.mean(y[i:i + w] ** 2)) for i in range(0, max(1, len(y) - w), max(1, w // 2)))
def build(name, f, o, out, target, br):
    x = trim(load(f, o))
    if o.get('t'): x = x[:int(SR * o['t'])]
    if o.get('rep'): g = np.zeros(int(SR * o.get('gap', .2)), np.float32); x = np.concatenate(sum([[x, g] for _ in range(o['rep'])], [])[:-1])
    fi = int(SR * o.get('fin', .004)); x[:fi] *= np.linspace(0, 1, fi)
    fo = min(int(SR * o.get('fade', .02)), len(x)); x[-fo:] *= np.linspace(1, 0, fo) ** 2
    w = int(SR * .05); rms = stm(x, w)
    y = x * (10 ** ((target + o.get('db', 0)) / 20) / max(rms, 1e-6))
    pk = np.abs(y).max(); lim = 10 ** (-1 / 20)
    if pk > lim: y *= lim / pk
    p = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libopus', '-b:a', br, '-vbr', 'on', '-application', 'audio', out], input=y.astype(np.float32).tobytes(), capture_output=True)
    if p.returncode: print('ERR', name, p.stderr.decode()[:300]); return
    print(f'{os.path.basename(out):18s} {len(y) / SR:5.2f}s  {os.path.getsize(out) / 1024:5.1f} KB  rmsmax {20 * np.log10(stm(y, w)):6.1f} dB  peak {20 * np.log10(np.abs(y).max()):5.1f} dB')
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sfx') + '/'
only = sys.argv[1:]
for n, (f, o) in UI.items():
    if not only or n in only: build(n, f, o, D + n + '.ogg', -15, '48k')
for n, (f, o) in SB.items():
    if not only or 'sb-' + n in only: build('sb-' + n, f, o, D + 'sb-' + n + '.ogg', -13, '64k')

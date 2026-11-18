// Edição do vídeo: Ken Burns nas imagens, falas em sequência, transições,
// legendas estilo TikTok, gancho inicial, cartão "Continua..." e trilha opcional.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ffmpeg, duration, FONT_FILE, filterPath } from './ffmpeg.js';

export const W = 1080;
export const H = 1920;
const FPS = 30;
const LEAD = 0.45; // silêncio antes da 1ª fala da cena
const GAP = 0.3; // pausa entre falas
const TAIL = 0.6; // respiro no fim da cena
export const XFADE = 0.45; // duração das transições
const TRANSICOES = ['fade', 'smoothleft', 'circleopen', 'slideup', 'fadeblack', 'smoothright', 'radial', 'dissolve'];

const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
const AENC = ['-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2'];

function kenBurns(camera, frames) {
  const F = Math.max(frames, 1);
  const cx = 'iw/2-(iw/zoom/2)';
  const cy = 'ih/2-(ih/zoom/2)';
  switch (camera) {
    case 'zoom_out':
      return `zoompan=z='1.14-0.14*on/${F}':x='${cx}':y='${cy}'`;
    case 'pan_esquerda':
      return `zoompan=z='1.15':x='(iw-iw/zoom)*(1-on/${F})':y='${cy}'`;
    case 'pan_direita':
      return `zoompan=z='1.15':x='(iw-iw/zoom)*on/${F}':y='${cy}'`;
    default:
      return `zoompan=z='1+0.14*on/${F}':x='${cx}':y='${cy}'`;
  }
}

/** Monta o clipe de uma cena (imagem animada + falas). Retorna a duração e o tempo de cada fala. */
export async function buildSceneClip({ image, lineFiles, camera, outFile }) {
  const durs = [];
  for (const f of lineFiles) durs.push(await duration(f));
  const parts = [];
  const times = [];
  let t = LEAD;
  const filters = [`aevalsrc=0:c=stereo:s=44100:d=${LEAD}[s0]`];
  parts.push('[s0]');
  durs.forEach((d, i) => {
    times.push({ start: t, end: t + d });
    t += d;
    parts.push(`[${i + 1}:a]`);
    const pause = i === durs.length - 1 ? TAIL : GAP;
    filters.push(`aevalsrc=0:c=stereo:s=44100:d=${pause}[p${i}]`);
    parts.push(`[p${i}]`);
    t += pause;
  });
  const total = Math.max(t, 2.5);
  const frames = Math.ceil(total * FPS);
  filters.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1,apad,atrim=0:${total.toFixed(3)}[a]`);
  filters.push(
    `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,` +
      `${kenBurns(camera, frames)}:d=${frames}:s=${W}x${H}:fps=${FPS},vignette=PI/6,format=yuv420p[v]`
  );
  await ffmpeg([
    '-loop', '1', '-framerate', String(FPS), '-i', image,
    ...lineFiles.flatMap((f) => ['-i', f]),
    '-filter_complex', filters.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-t', total.toFixed(3),
    ...ENC, ...AENC,
    outFile,
  ]);
  return { duration: total, times };
}

/** Cartão final escurecido com o texto de suspense. */
export async function buildEndCard({ image, text, outFile }) {
  const D = 2.8;
  const txt = outFile + '.txt';
  await fs.writeFile(txt, text || 'Continua...');
  const draw = FONT_FILE
    ? `,drawtext=fontfile='${filterPath(FONT_FILE)}':textfile='${filterPath(txt)}':fontcolor=white:fontsize=84:x=(w-text_w)/2:y=(h-text_h)/2:alpha='min(1,t/0.8)':shadowcolor=black@0.7:shadowx=4:shadowy=4`
    : '';
  await ffmpeg([
    '-loop', '1', '-framerate', String(FPS), '-i', image,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-filter_complex',
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,boxblur=12:2,eq=brightness=-0.25${draw},format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a', '-t', String(D),
    ...ENC, ...AENC,
    outFile,
  ]);
  await fs.rm(txt, { force: true });
  return { duration: D };
}

/** Junta os clipes com transições, aplica legendas e trilha sonora. */
export async function assembleFinal({ clips, assFile, musicFile, outFile }) {
  const inputs = clips.flatMap((c) => ['-i', c.file]);
  const f = [];
  let v = '[0:v]';
  let a = '[0:a]';
  let offset = 0;
  for (let i = 1; i < clips.length; i++) {
    offset += clips[i - 1].duration - XFADE;
    const tr = TRANSICOES[(i - 1) % TRANSICOES.length];
    f.push(`${v}[${i}:v]xfade=transition=${tr}:duration=${XFADE}:offset=${offset.toFixed(3)}[v${i}]`);
    f.push(`${a}[${i}:a]acrossfade=d=${XFADE}[a${i}]`);
    v = `[v${i}]`;
    a = `[a${i}]`;
  }
  f.push(`${v}ass='${filterPath(assFile)}',format=yuv420p[vout]`);
  const extra = [];
  if (musicFile) {
    const idx = clips.length;
    extra.push('-stream_loop', '-1', '-i', musicFile);
    // A trilha abaixa sozinha quando alguém fala (ducking)
    f.push(`${a}asplit=2[voz][sc]`);
    f.push(`[${idx}:a]volume=0.22,aformat=sample_rates=44100:channel_layouts=stereo[mus]`);
    f.push(`[mus][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck]`);
    f.push(`[voz][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]`);
  } else {
    f.push(`${a}loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
  }
  await ffmpeg([
    ...inputs, ...extra,
    '-filter_complex', f.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    ...ENC, ...AENC,
    '-movflags', '+faststart',
    '-shortest',
    outFile,
  ]);
  await ffmpeg(['-ss', '1.5', '-i', outFile, '-frames:v', '1', '-vf', 'scale=360:-1', path.join(path.dirname(outFile), 'capa.jpg')]);
}

// ---------- Legendas (ASS) ----------

const CORES = ['&H00FFFFFF', '&H0066E0FF', '&H00FFC864', '&H00A0FF9A', '&H00C896FF', '&H0078B4FF'];

function ts(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${r}`;
}

const esc = (t) => t.replace(/[{}]/g, '').replace(/\\/g, '/').replace(/\n/g, ' ');

/** Divide falas longas em blocos curtos (estilo TikTok). */
function chunks(text, maxWords = 7) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i += maxWords) out.push(words.slice(i, i + maxWords).join(' '));
  if (out.length > 1 && out.at(-1).split(' ').length <= 2) {
    const last = out.pop();
    out[out.length - 1] += ' ' + last;
  }
  return out;
}

export function buildAss({ plan, sceneTimings }) {
  const colorOf = new Map();
  plan.personagens.forEach((p, i) => colorOf.set(p.nome.toLowerCase(), p.protagonista ? CORES[1] : CORES[(i % (CORES.length - 2)) + 2]));
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Fala,DejaVu Sans,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,6,2,2,90,90,560,1
Style: Narrador,DejaVu Sans,64,&H00E6E6E6,&H00FFFFFF,&H00000000,&H80000000,1,1,0,0,100,100,0,0,1,5,2,2,90,90,560,1
Style: Topo,DejaVu Sans,62,&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,1,0,0,0,100,100,0,0,3,18,0,8,80,80,230,1
Style: Gancho,DejaVu Sans,86,&H0000E5FF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,7,3,5,80,80,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = [];
  const add = (start, end, style, text) => ev.push(`Dialogue: 0,${ts(start)},${ts(end)},${style},,0,0,0,,${text}`);

  if (plan.gancho) add(0.1, Math.min(3, sceneTimings[0]?.duration || 3), 'Gancho', `{\\fad(150,250)\\fscx80\\fscy80\\t(0,200,\\fscx100\\fscy100)}${esc(plan.gancho)}`);
  if (plan.titulo) add(3, Math.min(6.5, sceneTimings[0]?.duration || 6.5), 'Topo', `{\\fad(200,200)}${esc(plan.titulo)}`);

  plan.cenas.forEach((cena, k) => {
    const st = sceneTimings[k];
    if (!st) return;
    if (cena.textoNaTela && k > 0) add(st.start + 0.2, st.start + Math.min(3, st.duration), 'Topo', `{\\fad(200,200)}${esc(cena.textoNaTela)}`);
    cena.falas.forEach((fala, i) => {
      const t = st.times[i];
      if (!t) return;
      const narr = fala.personagem.toLowerCase() === 'narrador';
      const cor = colorOf.get(fala.personagem.toLowerCase()) || CORES[0];
      const parts = chunks(fala.texto);
      const totalChars = parts.reduce((s, p) => s + p.length, 0) || 1;
      let cur = st.start + t.start;
      const span = t.end - t.start;
      parts.forEach((p, j) => {
        const d = span * (p.length / totalChars);
        const end = j === parts.length - 1 ? st.start + t.end + 0.15 : cur + d;
        const nome = narr ? '' : `{\\fs46\\c${cor.replace('&H00', '&H')}&}${esc(fala.personagem.toUpperCase())}\\N{\\r}`;
        add(cur, end, narr ? 'Narrador' : 'Fala', `{\\fad(80,60)}${nome}${esc(p)}`);
        cur += d;
      });
    });
  });
  return header + ev.join('\n') + '\n';
}

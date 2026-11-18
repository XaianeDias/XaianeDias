import { spawn } from 'node:child_process';
import fs from 'node:fs';

export function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} falhou (código ${code}):\n${err.split('\n').slice(-15).join('\n')}`));
    });
  });
}

export const ffmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

export async function duration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return parseFloat(out.trim());
}

const FONT_CANDIDATES = [
  process.env.FONTE_ARQUIVO,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
].filter(Boolean);

export const FONT_FILE = FONT_CANDIDATES.find((f) => fs.existsSync(f)) || null;

/** Caminho seguro para usar dentro de filtros do ffmpeg (escapa ":" e "\"). */
export function filterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

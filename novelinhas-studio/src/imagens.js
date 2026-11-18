// Gera as imagens verticais das cenas mantendo o mesmo personagem.
// Com OPENAI_API_KEY: usa o modelo de imagem da OpenAI e a imagem de referência do personagem
// (gerada uma única vez) para manter o rosto/roupa iguais em todas as cenas.
// Sem chave: gera cartões ilustrativos (modo demonstração).
import fs from 'node:fs/promises';
import path from 'node:path';
import { ffmpeg, FONT_FILE, filterPath } from './ffmpeg.js';

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';

export const hasImageProvider = () => Boolean(process.env.OPENAI_API_KEY);

function baseStyle(character) {
  return character.estiloVisual || 'cinematic, photorealistic, dramatic soap-opera lighting, shallow depth of field, vertical 9:16 frame';
}

async function openaiGenerate(prompt, outFile, referenceFile) {
  let res;
  if (referenceFile) {
    const form = new FormData();
    form.append('model', IMAGE_MODEL);
    form.append('prompt', prompt);
    form.append('size', '1024x1536');
    form.append('quality', QUALITY);
    const buf = await fs.readFile(referenceFile);
    form.append('image[]', new Blob([buf], { type: 'image/png' }), 'referencia.png');
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: '1024x1536', quality: QUALITY }),
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Erro ao gerar imagem: ${data.error?.message || res.status}`);
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('A API de imagem não retornou a imagem.');
  await fs.writeFile(outFile, Buffer.from(b64, 'base64'));
  return outFile;
}

/** Imagem de referência do protagonista (folha de personagem). Gerada uma vez e reaproveitada. */
export async function generateCharacterReference(character, outFile) {
  const prompt = `Character reference portrait for a vertical soap-opera series. Full body and clear face, neutral background, natural pose, looking at camera.
Character: ${character.descricao}
Style: ${baseStyle(character)}`;
  if (hasImageProvider()) return openaiGenerate(prompt, outFile, null);
  return placeholder(outFile, `${character.nome}\n\n(modo demonstração)`, 0);
}

export async function generateSceneImage({ character, plan, scene, index, outFile, referenceFile }) {
  const cast = plan.personagens.filter(
    (p) => scene.personagensEmCena.some((n) => n.toLowerCase() === p.nome.toLowerCase()) && p.descricaoVisual
  );
  const castText = cast.map((p) => `- ${p.nome}${p.protagonista ? ' (main character, same person as the reference image)' : ''}: ${p.descricaoVisual}`).join('\n');
  const prompt = `Vertical 9:16 frame from a dramatic short-form soap opera episode.
Scene: ${scene.promptImagem}
${castText ? `Characters in frame (keep their appearance exactly consistent):\n${castText}` : ''}
Style: ${baseStyle(character)}. No text, no captions, no watermarks.`;
  if (hasImageProvider()) {
    const usesProtagonist = cast.some((p) => p.protagonista);
    return openaiGenerate(prompt, outFile, usesProtagonist ? referenceFile : null);
  }
  const who = scene.personagensEmCena.join(' e ');
  return placeholder(outFile, `${scene.ambiente || 'Cena ' + (index + 1)}${who ? '\n\n' + who : ''}`, index + 1);
}

const PALETTES = [
  ['0x2b1055', '0xd53369'],
  ['0x0f2027', '0x2c5364'],
  ['0x42275a', '0x734b6d'],
  ['0x141e30', '0x243b55'],
  ['0x3a1c71', '0xffaf7b'],
  ['0x200122', '0x6f0000'],
  ['0x1f4037', '0x99f2c8'],
];

/** Cartão ilustrativo 1080x1920 usado quando não há API de imagem configurada. */
async function placeholder(outFile, text, seed) {
  const [c0, c1] = PALETTES[seed % PALETTES.length];
  const txt = outFile + '.txt';
  await fs.writeFile(txt, wrap(text, 22));
  const draw = FONT_FILE
    ? `,drawtext=fontfile='${filterPath(FONT_FILE)}':textfile='${filterPath(txt)}':fontcolor=white@0.92:fontsize=64:line_spacing=18:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.25:boxborderw=40`
    : '';
  await ffmpeg([
    '-f', 'lavfi',
    '-i', `gradients=s=1080x1920:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=1080:y1=1920:d=1:r=1`,
    '-vf', `vignette=PI/4${draw}`,
    '-frames:v', '1',
    outFile,
  ]);
  await fs.rm(txt, { force: true });
  return outFile;
}

function wrap(text, width) {
  return text
    .split('\n')
    .map((line) => {
      const words = line.split(' ');
      const out = [];
      let cur = '';
      for (const w of words) {
        if ((cur + ' ' + w).trim().length > width) {
          if (cur) out.push(cur);
          cur = w;
        } else cur = (cur + ' ' + w).trim();
      }
      out.push(cur);
      return out.join('\n');
    })
    .join('\n');
}

export const imagePath = (dir, i) => path.join(dir, `cena-${String(i + 1).padStart(2, '0')}.png`);

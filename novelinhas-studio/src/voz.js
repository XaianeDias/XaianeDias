// Gera as falas (voz) de cada personagem.
// Com OPENAI_API_KEY: texto-para-fala com interpretação (emoção) em português do Brasil.
// Sem chave: cria silêncio com a duração estimada da fala (o vídeo sai só com legendas).
import fs from 'node:fs/promises';
import { ffmpeg } from './ffmpeg.js';

const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const NARRADOR_VOZ = process.env.NARRADOR_VOZ || 'onyx';

export const hasVoiceProvider = () => Boolean(process.env.OPENAI_API_KEY);

const EMOCAO_INSTRUCAO = {
  neutra: 'tom natural de conversa',
  feliz: 'alegre e animado(a), sorrindo',
  triste: 'triste, voz embargada, mais devagar',
  raiva: 'com raiva, intenso(a), firme e alto',
  medo: 'com medo, respiração tensa, voz trêmula',
  surpresa: 'surpreso(a), chocado(a)',
  ironia: 'irônico(a), debochado(a)',
  sussurro: 'sussurrando, bem baixo e íntimo',
  choro: 'chorando, voz quebrada',
  determinacao: 'determinado(a), confiante e decidido(a)',
};

export async function generateLine({ texto, emocao, voz }, outFile) {
  if (!hasVoiceProvider()) {
    const words = texto.split(/\s+/).filter(Boolean).length;
    const secs = Math.max(1.4, words / 2.6);
    await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', secs.toFixed(2), '-c:a', 'pcm_s16le', outFile]);
    return outFile;
  }
  const narrador = voz === 'narrador';
  const instructions = narrador
    ? 'Narrador de novela brasileira: voz grave, misteriosa e envolvente. Fale em português do Brasil.'
    : `Atue como personagem de novela brasileira. Fale em português do Brasil, ${EMOCAO_INSTRUCAO[emocao] || EMOCAO_INSTRUCAO.neutra}.`;
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: narrador ? NARRADOR_VOZ : voz,
      input: texto,
      instructions,
      response_format: 'wav',
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Erro ao gerar voz: ${data.error?.message || res.status}`);
  }
  const raw = outFile + '.raw.wav';
  await fs.writeFile(raw, Buffer.from(await res.arrayBuffer()));
  // Normaliza formato para a montagem
  await ffmpeg(['-i', raw, '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', outFile]);
  await fs.rm(raw, { force: true });
  return outFile;
}

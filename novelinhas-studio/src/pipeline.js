// Orquestra a criação de um episódio: roteiro -> cenas -> imagens -> vozes -> edição.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { VIDEOS_DIR, CHAR_DIR, MUSIC_DIR, saveProject, getCharacter, updateCharacter } from './storage.js';
import { scriptToScenes, normalizePlan } from './roteiro.js';
import { generateSceneImage, generateCharacterReference, imagePath, hasImageProvider } from './imagens.js';
import { generateLine } from './voz.js';
import { buildSceneClip, buildEndCard, assembleFinal, buildAss, XFADE } from './montagem.js';

export const jobs = new Map();

function newJob(input) {
  const id = new Date().toISOString().slice(0, 10) + '-' + crypto.randomBytes(3).toString('hex');
  const job = {
    id,
    titulo: input.titulo || '',
    roteiro: input.roteiro,
    status: 'na_fila',
    etapa: 'Na fila',
    progresso: 0,
    logs: [],
    plano: null,
    video: null,
    erro: null,
    criadoEm: new Date().toISOString(),
  };
  jobs.set(id, job);
  return job;
}

function logger(job) {
  return (msg) => {
    job.logs.push(`${new Date().toLocaleTimeString('pt-BR')} ${msg}`);
    console.log(`[${job.id}] ${msg}`);
  };
}

const persist = (job) => saveProject(job.id, { ...job, logs: job.logs.slice(-60) });

/** Executa tarefas com limite de paralelismo. */
async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

export async function startEpisode(input) {
  const character = await getCharacter();
  if (!character) throw new Error('Cadastre o personagem antes de criar um episódio.');
  if (!input.roteiro?.trim()) throw new Error('Cole o roteiro (ou a ideia) do episódio.');
  const job = newJob(input);
  const log = logger(job);
  (async () => {
    try {
      job.status = 'processando';
      job.etapa = 'Transformando o roteiro em cenas';
      job.progresso = 5;
      job.plano = await scriptToScenes(character, input, log);
      log(`${job.plano.cenas.length} cenas criadas: "${job.plano.titulo}".`);
      job.titulo = job.plano.titulo;
      if (input.revisar) {
        job.status = 'revisao';
        job.etapa = 'Revise as cenas e falas, depois clique em "Gerar vídeo"';
        job.progresso = 15;
        await persist(job);
        return;
      }
      await render(job, character, { musica: input.musica });
    } catch (e) {
      fail(job, e);
    }
  })();
  return job;
}

export async function continueEpisode(id, plano, opts = {}) {
  const job = jobs.get(id);
  if (!job) throw new Error('Episódio não encontrado (o servidor pode ter sido reiniciado).');
  if (job.status !== 'revisao') throw new Error('Este episódio não está aguardando revisão.');
  const character = await getCharacter();
  if (plano) job.plano = normalizePlan(character, plano);
  job.status = 'processando';
  render(job, character, opts).catch((e) => fail(job, e));
  return job;
}

function fail(job, e) {
  job.status = 'erro';
  job.erro = e.message;
  job.etapa = 'Erro';
  logger(job)(`ERRO: ${e.message}`);
  persist(job).catch(() => {});
}

async function render(job, character, opts = {}) {
  const log = logger(job);
  const dir = path.join(VIDEOS_DIR, job.id);
  const work = path.join(dir, 'trabalho');
  await fs.mkdir(work, { recursive: true });
  const plan = job.plano;

  // 1) Imagem de referência do protagonista (uma vez só, reaproveitada em todos os episódios)
  let reference = character.imagemReferencia ? path.join(CHAR_DIR, character.imagemReferencia) : null;
  if (hasImageProvider() && (!reference || !(await exists(reference)))) {
    job.etapa = 'Criando a imagem de referência do personagem';
    log('Gerando a imagem de referência do protagonista (só acontece uma vez)...');
    const name = `referencia-${Date.now()}.png`;
    reference = await generateCharacterReference(character, path.join(CHAR_DIR, name));
    await updateCharacter({ imagemReferencia: name });
  }

  // 2) Imagens das cenas
  job.etapa = 'Gerando as imagens das cenas';
  let done = 0;
  const images = [];
  await pool(plan.cenas, Number(process.env.PARALELO_IMAGENS || 3), async (scene, i) => {
    images[i] = await generateSceneImage({ character, plan, scene, index: i, outFile: imagePath(dir, i), referenceFile: reference });
    done++;
    job.progresso = 15 + Math.round((done / plan.cenas.length) * 35);
    log(`Imagem da cena ${i + 1} pronta.`);
  });

  // 3) Vozes
  job.etapa = 'Gravando as falas';
  const voiceOf = (nome) =>
    plan.personagens.find((p) => p.nome.toLowerCase() === nome.toLowerCase())?.voz || (nome.toLowerCase() === 'narrador' ? 'narrador' : 'alloy');
  const lines = plan.cenas.flatMap((c, ci) => c.falas.map((f, fi) => ({ ...f, ci, fi })));
  const lineFiles = plan.cenas.map(() => []);
  done = 0;
  await pool(lines, Number(process.env.PARALELO_VOZES || 4), async (l) => {
    const file = path.join(work, `fala-${l.ci}-${l.fi}.wav`);
    await generateLine({ texto: l.texto, emocao: l.emocao, voz: voiceOf(l.personagem) }, file);
    lineFiles[l.ci][l.fi] = file;
    done++;
    job.progresso = 50 + Math.round((done / lines.length) * 20);
  });
  log(`${lines.length} falas gravadas.`);

  // 4) Clipes de cada cena
  job.etapa = 'Editando as cenas';
  const clips = [];
  const sceneTimings = [];
  let start = 0;
  for (let i = 0; i < plan.cenas.length; i++) {
    const file = path.join(work, `clipe-${i}.mp4`);
    const r = await buildSceneClip({ image: images[i], lineFiles: lineFiles[i], camera: plan.cenas[i].camera, outFile: file });
    clips.push({ file, duration: r.duration });
    sceneTimings.push({ start, duration: r.duration, times: r.times });
    start += r.duration - XFADE;
    job.progresso = 70 + Math.round(((i + 1) / plan.cenas.length) * 18);
  }
  const endFile = path.join(work, 'final.mp4');
  const end = await buildEndCard({ image: images.at(-1), text: plan.finalSuspense, outFile: endFile });
  clips.push({ file: endFile, duration: end.duration });

  // 5) Montagem final com transições, legendas e trilha
  job.etapa = 'Finalizando o vídeo (transições, legendas e trilha)';
  log('Montando o vídeo final...');
  const assFile = path.join(work, 'legendas.ass');
  await fs.writeFile(assFile, buildAss({ plan, sceneTimings }));
  const musicFile = opts.musica ? await pickMusic(opts.musica) : null;
  if (musicFile) log(`Trilha: ${path.basename(musicFile)}`);
  const slug = (plan.titulo || 'episodio').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40);
  const videoName = `${slug || 'episodio'}.mp4`;
  await assembleFinal({ clips, assFile, musicFile, outFile: path.join(dir, videoName) });

  const total = clips.reduce((s, c) => s + c.duration, 0) - XFADE * (clips.length - 1);
  job.video = `/videos/${job.id}/${videoName}`;
  job.capa = `/videos/${job.id}/capa.jpg`;
  job.duracao = Math.round(total);
  job.status = 'pronto';
  job.etapa = 'Pronto!';
  job.progresso = 100;
  log(`Vídeo pronto: ${job.duracao}s.`);
  if (!process.env.MANTER_ARQUIVOS_TEMPORARIOS) await fs.rm(work, { recursive: true, force: true });
  await persist(job);
}

async function exists(f) {
  try {
    await fs.access(f);
    return true;
  } catch {
    return false;
  }
}

export async function listMusic() {
  try {
    return (await fs.readdir(MUSIC_DIR)).filter((f) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f));
  } catch {
    return [];
  }
}

async function pickMusic(choice) {
  const all = await listMusic();
  if (!all.length) return null;
  const name = choice === 'aleatoria' ? all[Math.floor(Math.random() * all.length)] : all.find((m) => m === choice);
  return name ? path.join(MUSIC_DIR, name) : null;
}

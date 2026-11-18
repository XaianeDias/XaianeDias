import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  ensureDirs, getCharacter, saveCharacter, archiveCharacter, listPreviousCharacters, listProjects,
  VIDEOS_DIR, CHAR_DIR, MUSIC_DIR,
} from './src/storage.js';
import { startEpisode, continueEpisode, jobs, listMusic } from './src/pipeline.js';
import { VOZES } from './src/roteiro.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/videos', express.static(VIDEOS_DIR));
app.use('/personagem-img', express.static(CHAR_DIR));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(400).json({ erro: e.message }));

app.get('/api/status', wrap(async (_req, res) => {
  res.json({
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    imagensEVoz: Boolean(process.env.OPENAI_API_KEY),
    vozes: VOZES,
    musicas: await listMusic(),
  });
}));

app.get('/api/personagem', wrap(async (_req, res) => res.json({ atual: await getCharacter(), anteriores: await listPreviousCharacters() })));

app.post('/api/personagem', wrap(async (req, res) => {
  const { descricao } = req.body || {};
  if (!descricao?.trim()) throw new Error('Cole a descrição do personagem.');
  res.json(await saveCharacter(req.body));
}));

// "Trocar personagem": arquiva o atual
app.delete('/api/personagem', wrap(async (_req, res) => {
  await archiveCharacter();
  res.json({ ok: true });
}));

// Reativar um personagem anterior
app.post('/api/personagem/reativar', wrap(async (req, res) => {
  const anterior = (await listPreviousCharacters())[req.body.indice];
  if (!anterior) throw new Error('Personagem não encontrado.');
  if (await getCharacter()) await archiveCharacter();
  const c = await saveCharacter(anterior);
  res.json(c);
}));

app.post('/api/episodios', wrap(async (req, res) => res.json(publicJob(await startEpisode(req.body || {})))));

app.post('/api/episodios/:id/renderizar', wrap(async (req, res) => {
  res.json(publicJob(await continueEpisode(req.params.id, req.body?.plano, { musica: req.body?.musica })));
}));

app.get('/api/episodios/:id', wrap(async (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) return res.json(publicJob(job));
  const file = path.join(VIDEOS_DIR, path.basename(req.params.id), 'projeto.json');
  res.json(JSON.parse(await fs.readFile(file, 'utf8')));
}));

app.get('/api/episodios', wrap(async (_req, res) => {
  const saved = await listProjects();
  const live = [...jobs.values()].filter((j) => !saved.some((s) => s.id === j.id)).map(publicJob);
  res.json([...live, ...saved].map(({ id, titulo, status, video, capa, duracao, criadoEm }) => ({ id, titulo, status, video, capa, duracao, criadoEm })));
}));

function publicJob(j) {
  return { ...j, logs: j.logs.slice(-40) };
}

const PORT = Number(process.env.PORT || 3000);
await ensureDirs();
app.listen(PORT, () => {
  console.log(`\n🎬 Novelinhas Studio rodando em http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('  • Sem ANTHROPIC_API_KEY: o roteiro precisa estar no formato "NOME: fala".');
  if (!process.env.OPENAI_API_KEY) console.log('  • Sem OPENAI_API_KEY: modo demonstração (imagens ilustrativas e sem voz).');
  console.log(`  • Músicas de fundo: coloque arquivos .mp3 em ${MUSIC_DIR}\n`);
});

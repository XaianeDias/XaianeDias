// Armazenamento simples em arquivos JSON dentro da pasta data/
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '..', 'data');
export const VIDEOS_DIR = path.join(DATA_DIR, 'videos');
export const CHAR_DIR = path.join(DATA_DIR, 'personagem');
export const MUSIC_DIR = path.join(DATA_DIR, 'musicas');

const CHARACTER_FILE = path.join(DATA_DIR, 'personagem.json');
const HISTORY_FILE = path.join(DATA_DIR, 'personagens-anteriores.json');

export async function ensureDirs() {
  for (const d of [DATA_DIR, VIDEOS_DIR, CHAR_DIR, MUSIC_DIR]) await fs.mkdir(d, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

/** Personagem ativo: fica salvo e é usado em todos os vídeos até ser trocado. */
export async function getCharacter() {
  return readJson(CHARACTER_FILE, null);
}

export async function saveCharacter(data) {
  const current = await getCharacter();
  const character = {
    nome: (data.nome || '').trim() || 'Protagonista',
    descricao: (data.descricao || '').trim(),
    voz: data.voz || current?.voz || 'nova',
    estiloVisual: (data.estiloVisual || '').trim() || current?.estiloVisual || '',
    imagemReferencia: current?.imagemReferencia || null,
    criadoEm: current?.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
  // Se a descrição mudou, a imagem de referência antiga deixa de valer
  if (current && current.descricao !== character.descricao) character.imagemReferencia = null;
  await writeJson(CHARACTER_FILE, character);
  return character;
}

export async function updateCharacter(patch) {
  const current = await getCharacter();
  if (!current) return null;
  const next = { ...current, ...patch, atualizadoEm: new Date().toISOString() };
  await writeJson(CHARACTER_FILE, next);
  return next;
}

/** "Trocar personagem": arquiva o atual e libera para cadastrar outro. */
export async function archiveCharacter() {
  const current = await getCharacter();
  if (!current) return;
  const history = await readJson(HISTORY_FILE, []);
  history.unshift({ ...current, arquivadoEm: new Date().toISOString() });
  await writeJson(HISTORY_FILE, history.slice(0, 50));
  await fs.rm(CHARACTER_FILE, { force: true });
}

export async function listPreviousCharacters() {
  return readJson(HISTORY_FILE, []);
}

export async function saveProject(id, project) {
  const dir = path.join(VIDEOS_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, 'projeto.json'), project);
}

export async function listProjects() {
  let entries = [];
  try {
    entries = await fs.readdir(VIDEOS_DIR);
  } catch {
    return [];
  }
  const projects = [];
  for (const id of entries) {
    const p = await readJson(path.join(VIDEOS_DIR, id, 'projeto.json'), null);
    if (p) projects.push(p);
  }
  return projects.sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}

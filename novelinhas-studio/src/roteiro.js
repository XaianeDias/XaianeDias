// Transforma o roteiro (ou uma ideia solta) em cenas com falas, usando o Claude.
// Sem ANTHROPIC_API_KEY, usa um leitor simples de roteiro no formato "NOME: fala".
import Anthropic from '@anthropic-ai/sdk';

export const VOZES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
export const CAMERAS = ['zoom_in', 'zoom_out', 'pan_esquerda', 'pan_direita'];
export const EMOCOES = ['neutra', 'feliz', 'triste', 'raiva', 'medo', 'surpresa', 'ironia', 'sussurro', 'choro', 'determinacao'];

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

const str = { type: 'string' };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'gancho', 'personagens', 'cenas', 'finalSuspense'],
  properties: {
    titulo: str,
    gancho: { type: 'string', description: 'Frase curta de impacto exibida nos 2 primeiros segundos' },
    personagens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nome', 'descricaoVisual', 'voz', 'protagonista'],
        properties: {
          nome: str,
          descricaoVisual: { type: 'string', description: 'Aparência física fixa, em inglês, para geração de imagem' },
          voz: { type: 'string', enum: [...VOZES, 'narrador'] },
          protagonista: { type: 'boolean' },
        },
      },
    },
    cenas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ambiente', 'promptImagem', 'personagensEmCena', 'camera', 'textoNaTela', 'falas'],
        properties: {
          ambiente: { type: 'string', description: 'Cenário em português, para exibição' },
          promptImagem: {
            type: 'string',
            description: 'Prompt em inglês da imagem vertical da cena: ação, enquadramento, luz, emoção. Sem descrever a aparência dos personagens (ela é adicionada automaticamente).',
          },
          personagensEmCena: { type: 'array', items: str },
          camera: { type: 'string', enum: CAMERAS },
          textoNaTela: { type: 'string', description: 'Legenda de contexto opcional, ex.: "3 dias depois..." (vazio se não houver)' },
          falas: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['personagem', 'texto', 'emocao'],
              properties: {
                personagem: { type: 'string', description: 'Nome do personagem ou "Narrador"' },
                texto: str,
                emocao: { type: 'string', enum: EMOCOES },
              },
            },
          },
        },
      },
    },
    finalSuspense: { type: 'string', description: 'Texto do cartão final, ex.: "Continua no próximo episódio..."' },
  },
};

function systemPrompt() {
  return `Você é roteirista e diretor de "novelinhas" verticais para TikTok, Reels e YouTube Shorts em português do Brasil.
Sua tarefa é transformar o roteiro enviado em um episódio de 60 a 120 segundos, dividido em cenas prontas para gerar imagens e vozes.

Regras:
- O PROTAGONISTA é sempre o personagem fixo informado. Use exatamente o nome dele e marque protagonista=true só para ele.
- Se o usuário mandar um roteiro completo, respeite as falas dele (pode ajustar pontuação e cortar repetições). Se mandar só uma ideia, escreva o roteiro.
- Entre 6 e 14 cenas. Cada cena tem de 1 a 4 falas curtas e naturais (até ~20 palavras cada), no tom de novela: drama, reviravolta, emoção.
- Some no total entre 150 e 280 palavras faladas, para o vídeo ficar entre 1 e 2 minutos.
- A primeira cena precisa prender a atenção em 3 segundos; a última termina com suspense.
- Use "Narrador" (voz "narrador") só quando necessário para contexto.
- Para coadjuvantes, crie uma descrição visual fixa em inglês e escolha vozes diferentes entre si. O protagonista usa a voz informada.
- promptImagem: em inglês, descreva ação, expressão, enquadramento (close-up, medium shot...), luz e cenário. Não repita a aparência física dos personagens.
- Varie a câmera entre as cenas.`;
}

function userPrompt(character, input) {
  return `PERSONAGEM FIXO (protagonista):
Nome: ${character.nome}
Voz: ${character.voz}
Descrição: ${character.descricao}
${character.estiloVisual ? `Estilo visual da série: ${character.estiloVisual}` : ''}

EPISÓDIO: ${input.titulo || '(sem título — crie um)'}

ROTEIRO / IDEIA:
${input.roteiro}`;
}

export async function scriptToScenes(character, input, log = () => {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    log('Sem ANTHROPIC_API_KEY: usando o leitor simples de roteiro (formato "NOME: fala").');
    return parseScriptLocally(character, input);
  }
  log('Claude está dividindo o roteiro em cenas...');
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: systemPrompt(),
    messages: [{ role: 'user', content: userPrompt(character, input) }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('O Claude recusou este roteiro. Tente reescrever o conteúdo.');
  if (msg.stop_reason === 'max_tokens') throw new Error('O roteiro ficou longo demais. Tente encurtar.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const plan = JSON.parse(text);
  return normalizePlan(character, plan);
}

/** Garante que o protagonista tem a descrição/voz cadastradas e que os dados estão coerentes. */
export function normalizePlan(character, plan) {
  const personagens = plan.personagens || [];
  let prot = personagens.find((p) => p.protagonista) || personagens.find((p) => same(p.nome, character.nome));
  if (!prot) {
    prot = { nome: character.nome, descricaoVisual: '', voz: character.voz, protagonista: true };
    personagens.unshift(prot);
  }
  prot.nome = character.nome;
  prot.protagonista = true;
  prot.voz = character.voz;
  prot.descricaoVisual = character.descricao;
  for (const p of personagens) if (p !== prot) p.protagonista = false;
  if (!personagens.some((p) => same(p.nome, 'Narrador'))) {
    personagens.push({ nome: 'Narrador', descricaoVisual: '', voz: 'narrador', protagonista: false });
  }
  plan.personagens = personagens;
  plan.cenas = (plan.cenas || []).filter((c) => c.falas?.length || c.textoNaTela);
  plan.cenas.forEach((c, i) => {
    c.camera = CAMERAS.includes(c.camera) ? c.camera : CAMERAS[i % CAMERAS.length];
    for (const f of c.falas) if (same(f.personagem, prot.nome) || /^(eu|protagonista)$/i.test(f.personagem)) f.personagem = prot.nome;
  });
  return plan;
}

const same = (a = '', b = '') => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Leitor offline. Formato aceito:
 *   CENA: cozinha da mansão, à noite      (ou [cozinha da mansão] / linha em branco para separar)
 *   MARIA (raiva): Você mentiu pra mim!
 *   Narrador: Três dias depois...
 *   (texto sem "NOME:" vira narração)
 */
export function parseScriptLocally(character, input) {
  const lines = input.roteiro.split(/\r?\n/).map((l) => l.trim());
  const cenas = [];
  let current = null;
  const names = new Map();
  const newScene = (ambiente = '') => {
    current = { ambiente, promptImagem: ambiente, personagensEmCena: [], camera: CAMERAS[cenas.length % 4], textoNaTela: '', falas: [] };
    cenas.push(current);
  };
  for (const line of lines) {
    if (!line) {
      if (current && current.falas.length) current = null;
      continue;
    }
    const scene = line.match(/^(?:cena\s*\d*\s*[:\-–]\s*|\[)(.+?)\]?$/i);
    if (scene) {
      newScene(scene[1].trim());
      continue;
    }
    if (!current) newScene(cenas.at(-1)?.ambiente || '');
    const fala = line.match(/^([\p{L}][\p{L} .'-]{0,30}?)\s*(?:\(([^)]+)\))?\s*:\s*(.+)$/u);
    let personagem = 'Narrador';
    let texto = line;
    let emocao = 'neutra';
    if (fala) {
      personagem = titleCase(fala[1]);
      texto = fala[3];
      if (fala[2]) emocao = guessEmotion(fala[2]);
    }
    if (/^eu$/i.test(personagem) || same(personagem, character.nome)) personagem = character.nome;
    if (!names.has(personagem.toLowerCase())) names.set(personagem.toLowerCase(), personagem);
    if (personagem !== 'Narrador' && !current.personagensEmCena.includes(personagem)) current.personagensEmCena.push(personagem);
    current.falas.push({ personagem, texto, emocao });
  }
  const extraVoices = VOZES.filter((v) => v !== character.voz);
  const personagens = [...names.values()]
    .filter((n) => n !== 'Narrador')
    .map((nome, i) => ({
      nome,
      descricaoVisual: '',
      voz: same(nome, character.nome) ? character.voz : extraVoices[i % extraVoices.length],
      protagonista: same(nome, character.nome),
    }));
  const plan = {
    titulo: input.titulo || 'Novo episódio',
    gancho: '',
    personagens,
    cenas: cenas.map((c) => ({ ...c, promptImagem: c.promptImagem || 'dramatic scene' })),
    finalSuspense: 'Continua...',
  };
  return normalizePlan(character, plan);
}

function titleCase(s) {
  return s.trim().toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());
}

function guessEmotion(s) {
  const t = s.toLowerCase();
  const map = [
    [/feliz|sorri|alegr|ri[nd]/, 'feliz'],
    [/trist|choran|chor/, 'triste'],
    [/raiva|grit|brav|furios/, 'raiva'],
    [/medo|assust|nervos/, 'medo'],
    [/surpres|chocad/, 'surpresa'],
    [/iron|debocha|sarc/, 'ironia'],
    [/sussur|baixinho/, 'sussurro'],
    [/determin|firme|decidid/, 'determinacao'],
  ];
  return map.find(([re]) => re.test(t))?.[1] || 'neutra';
}

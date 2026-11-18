const $ = (s) => document.querySelector(s);
const EMOCOES = ['neutra', 'feliz', 'triste', 'raiva', 'medo', 'surpresa', 'ironia', 'sussurro', 'choro', 'determinacao'];

let status = { vozes: [], musicas: [] };
let personagem = null;
let jobAtual = null;
let poll = null;

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || 'Erro inesperado');
  return data;
}

const esc = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------- Status ----------------
async function carregarStatus() {
  status = await api('/api/status');
  $('#status').innerHTML = [
    status.claude
      ? '<span class="chip ok">✓ Claude: roteiro inteligente</span>'
      : '<span class="chip warn">⚠ Sem chave do Claude: use o formato NOME: fala</span>',
    status.imagensEVoz
      ? '<span class="chip ok">✓ Imagens e vozes com IA</span>'
      : '<span class="chip warn">⚠ Modo demonstração: sem imagens/vozes de IA</span>',
  ].join('');
  $('#sel-voz').innerHTML = status.vozes.map((v) => `<option>${v}</option>`).join('');
  $('#sel-musica').innerHTML =
    '<option value="">Sem música</option>' +
    (status.musicas.length ? '<option value="aleatoria">Aleatória</option>' : '') +
    status.musicas.map((m) => `<option>${esc(m)}</option>`).join('');
}

// ---------------- Personagem ----------------
async function carregarPersonagem() {
  const { atual, anteriores } = await api('/api/personagem');
  personagem = atual;
  const form = $('#personagem-form');
  if (atual) {
    $('#personagem-view').hidden = false;
    form.hidden = true;
    $('#p-nome').textContent = atual.nome;
    $('#p-desc').textContent = atual.descricao;
    $('#p-voz').textContent = atual.voz;
    $('#p-estilo').textContent = atual.estiloVisual ? ` · Estilo: ${atual.estiloVisual}` : '';
    const img = $('#p-img');
    img.hidden = !atual.imagemReferencia;
    if (atual.imagemReferencia) img.src = `/personagem-img/${atual.imagemReferencia}`;
  } else {
    $('#personagem-view').hidden = true;
    form.hidden = false;
    form.reset();
    $('#btn-cancelar').hidden = true;
  }
  $('#anteriores').innerHTML = anteriores.length
    ? `<div class="anteriores"><b>Personagens anteriores</b><ul>${anteriores
        .map((p, i) => `<li>${esc(p.nome)} — <small>${esc(p.descricao.slice(0, 70))}…</small><button type="button" class="link" data-reativar="${i}">usar de novo</button></li>`)
        .join('')}</ul></div>`
    : '';
  $('#btn-criar').disabled = !atual;
}

$('#personagem-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    await api('/api/personagem', { method: 'POST', body: data });
    await carregarPersonagem();
  } catch (err) {
    alert(err.message);
  }
});

$('#btn-editar').addEventListener('click', () => {
  const f = $('#personagem-form');
  f.nome.value = personagem.nome;
  f.descricao.value = personagem.descricao;
  f.voz.value = personagem.voz;
  f.estiloVisual.value = personagem.estiloVisual || '';
  f.hidden = false;
  $('#personagem-view').hidden = true;
  $('#btn-cancelar').hidden = false;
});
$('#btn-cancelar').addEventListener('click', carregarPersonagem);

$('#btn-trocar').addEventListener('click', async () => {
  if (!confirm(`Trocar o personagem "${personagem.nome}"? Ele ficará salvo em "Personagens anteriores".`)) return;
  await api('/api/personagem', { method: 'DELETE' });
  await carregarPersonagem();
});

$('#anteriores').addEventListener('click', async (e) => {
  const i = e.target.dataset.reativar;
  if (i === undefined) return;
  await api('/api/personagem/reativar', { method: 'POST', body: { indice: Number(i) } });
  await carregarPersonagem();
});

// ---------------- Episódio ----------------
$('#episodio-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { titulo: f.titulo.value, roteiro: f.roteiro.value, musica: f.musica.value, revisar: f.revisar.checked };
  $('#btn-criar').disabled = true;
  try {
    jobAtual = await api('/api/episodios', { method: 'POST', body });
    $('#card-resultado').hidden = true;
    $('#card-revisao').hidden = true;
    acompanhar(jobAtual.id);
  } catch (err) {
    alert(err.message);
    $('#btn-criar').disabled = false;
  }
});

function acompanhar(id) {
  clearInterval(poll);
  $('#card-progresso').hidden = false;
  $('#card-progresso').scrollIntoView({ behavior: 'smooth' });
  const tick = async () => {
    const job = await api(`/api/episodios/${id}`);
    jobAtual = job;
    $('#prog-titulo').textContent = job.titulo || 'Gerando episódio...';
    $('#prog-etapa').textContent = job.status === 'erro' ? `❌ ${job.erro}` : job.etapa;
    $('#prog-bar').style.width = `${job.progresso}%`;
    $('#prog-logs').textContent = job.logs.join('\n');
    if (job.status === 'revisao') {
      clearInterval(poll);
      mostrarRevisao(job.plano);
    } else if (job.status === 'pronto') {
      clearInterval(poll);
      mostrarResultado(job);
    } else if (job.status === 'erro') {
      clearInterval(poll);
      $('#btn-criar').disabled = false;
    }
  };
  tick();
  poll = setInterval(tick, 1500);
}

// ---------------- Revisão ----------------
function opcoesPersonagens(plano, atual) {
  return plano.personagens.map((p) => `<option ${p.nome === atual ? 'selected' : ''}>${esc(p.nome)}</option>`).join('');
}

function linhaFala(plano, fala = { personagem: plano.personagens[0].nome, texto: '', emocao: 'neutra' }) {
  const div = document.createElement('div');
  div.className = 'fala';
  div.innerHTML = `
    <select class="quem">${opcoesPersonagens(plano, fala.personagem)}</select>
    <select class="emocao">${EMOCOES.map((e) => `<option ${e === fala.emocao ? 'selected' : ''}>${e}</option>`).join('')}</select>
    <input class="texto" value="${esc(fala.texto)}" placeholder="Fala" />
    <button type="button" title="Remover fala">✕</button>`;
  div.querySelector('button').onclick = () => div.remove();
  return div;
}

function mostrarRevisao(plano) {
  $('#card-revisao').hidden = false;
  $('#rev-gancho').value = plano.gancho || '';
  $('#rev-final').value = plano.finalSuspense || '';
  const box = $('#rev-cenas');
  box.innerHTML = '';
  plano.cenas.forEach((c, i) => {
    const el = $('#tpl-cena').content.firstElementChild.cloneNode(true);
    el.querySelector('.num').textContent = `Cena ${i + 1}`;
    el.querySelector('.ambiente').value = c.ambiente;
    el.querySelector('.prompt').value = c.promptImagem;
    el.querySelector('.texto-tela').value = c.textoNaTela || '';
    const falas = el.querySelector('.falas');
    c.falas.forEach((f) => falas.appendChild(linhaFala(plano, f)));
    el.querySelector('.add-fala').onclick = () => falas.appendChild(linhaFala(plano));
    el.dataset.index = i;
    box.appendChild(el);
  });
  $('#card-revisao').scrollIntoView({ behavior: 'smooth' });
}

$('#btn-render').addEventListener('click', async () => {
  const plano = structuredClone(jobAtual.plano);
  plano.gancho = $('#rev-gancho').value;
  plano.finalSuspense = $('#rev-final').value;
  plano.cenas = [...document.querySelectorAll('#rev-cenas .cena')].map((el) => {
    const orig = plano.cenas[Number(el.dataset.index)];
    const falas = [...el.querySelectorAll('.fala')]
      .map((f) => ({ personagem: f.querySelector('.quem').value, emocao: f.querySelector('.emocao').value, texto: f.querySelector('.texto').value.trim() }))
      .filter((f) => f.texto);
    return {
      ...orig,
      ambiente: el.querySelector('.ambiente').value,
      promptImagem: el.querySelector('.prompt').value,
      textoNaTela: el.querySelector('.texto-tela').value,
      falas,
      personagensEmCena: [...new Set([...orig.personagensEmCena, ...falas.map((f) => f.personagem).filter((n) => n !== 'Narrador')])],
    };
  });
  $('#btn-render').disabled = true;
  try {
    await api(`/api/episodios/${jobAtual.id}/renderizar`, { method: 'POST', body: { plano, musica: $('#sel-musica').value } });
    $('#card-revisao').hidden = true;
    acompanhar(jobAtual.id);
  } catch (err) {
    alert(err.message);
  } finally {
    $('#btn-render').disabled = false;
  }
});

// ---------------- Resultado ----------------
function mostrarResultado(job) {
  $('#card-resultado').hidden = false;
  $('#video').src = job.video;
  $('#btn-baixar').href = job.video;
  $('#btn-criar').disabled = false;
  $('#card-resultado').scrollIntoView({ behavior: 'smooth' });
  carregarLista();
}

$('#btn-novo').addEventListener('click', () => {
  $('#card-resultado').hidden = true;
  $('#card-progresso').hidden = true;
  $('#episodio-form').reset();
  $('#card-episodio').scrollIntoView({ behavior: 'smooth' });
});

async function carregarLista() {
  const eps = await api('/api/episodios');
  const prontos = eps.filter((e) => e.video);
  $('#lista').innerHTML = prontos.length
    ? prontos
        .map(
          (e) => `<a class="ep" href="${e.video}" target="_blank">
            <img src="${e.capa}" alt="" loading="lazy" />
            <div>${esc(e.titulo || 'Episódio')}<br /><small>${e.duracao || '?'}s · ${new Date(e.criadoEm).toLocaleDateString('pt-BR')}</small></div>
          </a>`
        )
        .join('')
    : '<p class="empty">Nenhum episódio ainda.</p>';
}

await carregarStatus();
await carregarPersonagem();
await carregarLista();

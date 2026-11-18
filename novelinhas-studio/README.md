# 🎬 Novelinhas Studio

Plataforma para criar **novelinhas verticais** (TikTok, Reels, YouTube Shorts) de **1 a 2 minutos**.

1. Você cola **uma vez** o prompt com a descrição do personagem. Ele fica salvo e é usado em **todos os episódios até você clicar em "Trocar personagem"**.
2. Para cada episódio, você cola o **roteiro** (ou só a ideia).
3. A plataforma entrega o **vídeo MP4 vertical (1080x1920)** já editado:
   - roteiro dividido em cenas pelo Claude (6 a 14 cenas, de 1 a 2 minutos);
   - uma imagem por cena, com o **mesmo rosto e roupa** do protagonista (uma imagem de referência é gerada uma vez e reaproveitada);
   - **vozes diferentes** para cada personagem, com emoção (raiva, choro, sussurro...) e narrador;
   - movimento de câmera (zoom/pan), transições entre cenas;
   - **legendas estilo TikTok** com o nome de quem fala, frase de impacto no início e cartão "Continua..." no final;
   - música de fundo opcional, que abaixa sozinha quando alguém fala.

Você pode marcar **"Revisar cenas e falas"** para editar as falas, as emoções e as descrições das imagens antes de gerar o vídeo.

## Como instalar e rodar

Pré-requisitos: [Node.js 20+](https://nodejs.org) e [FFmpeg](https://ffmpeg.org/download.html) instalados.

```bash
cd novelinhas-studio
npm install
cp .env.example .env     # depois abra o .env e cole suas chaves
npm start
```

Abra **http://localhost:3000** no navegador.

### Chaves de API

| Chave | Para que serve | Sem ela |
|---|---|---|
| `ANTHROPIC_API_KEY` | O Claude transforma o roteiro (ou a ideia) em cenas, falas, emoções e descrições de imagem | O roteiro precisa estar no formato `NOME: fala` (veja abaixo) |
| `OPENAI_API_KEY` | Gera as imagens das cenas e as vozes dos personagens | **Modo demonstração**: cartões ilustrativos no lugar das imagens e vídeo sem voz (só legendas) |

Sem nenhuma chave dá para testar o fluxo todo em modo demonstração.

### Formato do roteiro (quando não há chave do Claude)

```
CENA: igreja lotada, dia do casamento
HELENA (nervosa): Eu não posso fazer isso...
RICARDO: Helena, todo mundo está olhando!

CENA: sacristia, porta entreaberta
NARRADOR: Mas o que Helena viu ali mudou tudo.
HELENA (raiva): Você e a minha irmã?!
```

- `CENA: ...` (ou uma linha em branco) começa uma nova cena.
- A emoção entre parênteses muda a interpretação da voz.
- Com a chave do Claude você pode mandar só uma ideia, ex.: *"Helena descobre no dia do casamento que o noivo a trai com a irmã"*.

### Música de fundo

Coloque arquivos `.mp3` em `data/musicas/` e escolha no campo "Música de fundo" (ou "Aleatória"). Use músicas livres de direitos autorais.

## Onde ficam os arquivos

- `data/personagem.json` – personagem atual (e `personagens-anteriores.json`, para reativar depois)
- `data/personagem/` – imagem de referência do personagem
- `data/videos/<episódio>/` – vídeo final, capa, imagens das cenas e `projeto.json`

## Estrutura do código

```
server.js            servidor web e API
src/roteiro.js       Claude: roteiro -> cenas (e leitor offline "NOME: fala")
src/imagens.js       imagens das cenas com personagem consistente
src/voz.js           vozes dos personagens (texto para fala)
src/montagem.js      edição com FFmpeg: câmera, transições, legendas, trilha
src/pipeline.js      junta tudo e acompanha o progresso
public/              a interface (HTML/CSS/JS)
```

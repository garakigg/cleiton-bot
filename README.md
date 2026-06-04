# Cleiton da Ouvidoria

Bot de recepcao e moderacao para grupo de WhatsApp usando numero comum, com motor Baileys/Knight e painel local.

> Aviso importante: esta abordagem usa automacao nao oficial via WhatsApp Web. Funciona para muitos projetos pessoais, mas pode violar regras do WhatsApp e existe risco de bloqueio do numero. Use um numero secundario.

## Funcoes

- Mensagem de boas-vindas para novos membros.
- `!regras` envia as regras do grupo.
- `!menu` lista comandos.
- `!sticker` transforma imagem enviada em figurinha.
- `!play nome ou link` baixa e envia audio curto.
- `!video nome ou link` baixa e envia video curto.
- `cleiton pergunta` responde usando Gemini com a personalidade do Cleiton quando a IA estiver configurada.
- Antilink automatico.
- Antispam automatico com mute temporario.
- Banco SQLite em `data/cleiton.sqlite`.
- Painel visual em `http://localhost:3000`.
- Comandos de moderacao: `!kick`, `!ban`, `!mute`, `!fechargp`, `!abrirgp`.
- Dono fixo em `5522981347316`, com segundo dono configuravel em `config/cleiton-config.json`.
- Logs opcionais para Discord via webhook.

## Como Rodar

1. Instale as dependencias:

```powershell
npm.cmd install
```

Se o bot avisar que nao encontrou Chrome, rode:

```powershell
npm.cmd run setup-browser
```

2. Crie o arquivo `.env`:

```powershell
Copy-Item .env.example .env
```

3. Edite `.env` com suas regras, prompt e `GEMINI_API_KEY` se quiser IA.

4. Crie o config local:

```powershell
Copy-Item config/cleiton-config.example.json config/cleiton-config.json
```

Edite `config/cleiton-config.json` se quiser segundo dono ou webhooks do Discord.

5. Inicie:

```powershell
npm.cmd start
```

6. Use o codigo de pareamento ou QR Code com o WhatsApp do numero que vai ser o bot.

## Comandos

```txt
!menu
!regras
!sticker
!play nome da musica
!video link ou nome do video
cleiton como funciona o grupo?
!mute @pessoa 10m
!kick @pessoa
!ban @pessoa
!fechargp
!abrirgp
```

Para figurinha, envie uma imagem com a legenda `!sticker` ou responda uma imagem com `!sticker`.

## Observacoes

- O bot precisa continuar rodando para responder.
- Na primeira execucao, ele salva a sessao em `session-cleiton`.
- Para trocar o numero, pare o bot e apague `session-cleiton`.
- Para apagar mensagens, remover pessoas e abrir/fechar grupo, o Cleiton precisa ser admin.
- Nao envie `.env`, `session-cleiton`, `data` ou `config/cleiton-config.json` para repositorios publicos.

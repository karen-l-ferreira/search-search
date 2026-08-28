# Busca Contato

Dado um CNPJ **ou uma razão social**, consulta:

- **CNPJá** (só quando a entrada não é um CNPJ) — resolve razão social → CNPJ
- **Lemit** (`/consulta/empresa/{cnpj}`)
- **Receita Federal** via BrasilAPI (pública, sem token)
- **ActiveCampaign** (contatos já cadastrados)

E lista todos os telefones e emails encontrados numa única tela.

Quando você digita um nome de empresa em vez de CNPJ, o app busca na CNPJá a
empresa mais parecida, mostra o CNPJ usado e lista outras empresas com nome
parecido (caso a busca seja ambígua) para você conferir/repetir com outro CNPJ.

Tem dois formatos prontos no mesmo repositório, escolha um:

## Opção A — Vercel (recomendado, mais rápido pro Bruno acessar por link)

1. Cria conta em [vercel.com](https://vercel.com) (dá pra logar com GitHub).
2. **Import Project** → seleciona este repositório.
3. Antes de fazer o deploy, em **Environment Variables**, adiciona:
   - `LEMIT_TOKEN`
   - `AC_API_TOKEN`
   - `AC_BASE_URL` = `https://gcbinvestimentos.activehosted.com`
   - `CNPJA_API_KEY` (chave gerada em [cnpja.com/me](https://cnpja.com/me), plano com créditos — necessária só para buscar por razão social)
4. Deploy. O Vercel te dá uma URL tipo `https://busca-contato-adiante.vercel.app`.
5. Manda esse link pro Bruno. Pronto, funciona direto, sem precisar rodar nada na sua máquina.

Usa os arquivos `public/index.html` (a tela) e `api/buscar.js` (a lógica), o `vercel.json` já configura tudo.

## Opção B — Servidor tradicional (rodar você mesma, ou num Render/VPS)

1. Instale o [Node.js](https://nodejs.org) versão 18 ou superior.
2. Clone este repositório.
3. Copie `.env.example` para `.env` e preencha com os valores reais.
4. Rode:
   ```
   node server.js
   ```
5. Abra `http://localhost:3000` no navegador.

Pro Bruno acessar por um link (sem depender da sua máquina ligada), hospeda esse mesmo
`server.js` num serviço como Render ou Railway (ambos têm plano grátis pra começar),
ou numa VM que a Adiante já tenha (pergunta pro Wendel).

## Enriquecimento em massa (planilha)

Em `/lote.html` dá pra subir uma planilha (.xlsx, .xls ou .csv) com uma coluna de
CNPJ ou razão social (aceita cabeçalhos como "CNPJ", "Razão Social", "Empresa" ou
"Cedente"). O app processa linha por linha e devolve a mesma planilha com colunas
extras: CNPJ usado, razão social encontrada (quando a busca foi por nome),
contato do AC, telefones e emails encontrados.

Antes de usar, instale a dependência de planilha:

```
npm install
```

**Atenção no Vercel:** o plano gratuito (Hobby) limita funções a 10 segundos,
então planilhas grandes podem estourar o tempo antes de terminar — nesse caso,
prefira rodar via `node server.js` (Opção B), que não tem esse limite.

## Segurança

- O arquivo `.env` está no `.gitignore`, nunca sobe pro GitHub.
- No Vercel, os tokens ficam em "Environment Variables" (painel do próprio Vercel), nunca no código.
- Nunca compartilhe `LEMIT_TOKEN`, `AC_API_TOKEN` nem `CNPJA_API_KEY` em texto puro fora desses lugares.

// Servidor standalone (Node.js puro, sem dependências) — use isso se for
// rodar num servidor/VM/Render, onde um processo pode ficar sempre ligado.
// Para deploy no Vercel, use api/buscar.js + public/index.html em vez deste arquivo.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { buscarPorNomeOuCnpj, paginaResultadoBusca } = require('./lib');
const { parseMultipart } = require('./multipart');
const { enriquecerPlanilha } = require('./lote');

// Carrega variáveis do arquivo .env (se existir), sem depender de pacote externo
(function carregarEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const conteudo = fs.readFileSync(envPath, 'utf-8');
  conteudo.split('\n').forEach((linha) => {
    const l = linha.trim();
    if (!l || l.startsWith('#')) return;
    const idx = l.indexOf('=');
    if (idx === -1) return;
    const chave = l.slice(0, idx).trim();
    const valor = l.slice(idx + 1).trim();
    if (!(chave in process.env)) process.env[chave] = valor;
  });
})();

const PORT = process.env.PORT || 3000;

function paginaForm() {
  return fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(paginaForm());
    return;
  }

  if (req.method === 'GET' && req.url === '/lote.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'public', 'lote.html'), 'utf-8'));
    return;
  }

  if (req.method === 'POST' && (req.url === '/lote' || req.url === '/api/lote')) {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const { files } = parseMultipart(buffer, req.headers['content-type']);
        const arquivo = files.planilha;

        if (!arquivo || !arquivo.content || !arquivo.content.length) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<p>Nenhum arquivo enviado. <a href="/lote.html">Voltar</a></p>');
          return;
        }

        const resultado = await enriquecerPlanilha(arquivo.content, process.env);
        if (resultado.erro) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<p>${resultado.erro} <a href="/lote.html">Voltar</a></p>`);
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="resultado-enriquecimento.xlsx"',
        });
        res.end(resultado.bufferSaida);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Erro ao processar a planilha: ' + String((err && err.message) || err));
      }
    });
    return;
  }

  if (req.method === 'POST' && (req.url === '/buscar' || req.url === '/api/buscar')) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      const params = new URLSearchParams(body);
      const entrada = (params.get('documento') || '').trim();

      if (!entrada) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>Informe um CNPJ ou razão social. <a href="/">Voltar</a></p>');
        return;
      }

      const busca = await buscarPorNomeOuCnpj(entrada, process.env);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(paginaResultadoBusca(busca));
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Não encontrado');
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  if (!process.env.LEMIT_TOKEN) console.warn('AVISO: variável LEMIT_TOKEN não configurada.');
  if (!process.env.AC_API_TOKEN) console.warn('AVISO: variável AC_API_TOKEN não configurada.');
});

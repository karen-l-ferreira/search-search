// Servidor standalone (Node.js puro, sem dependências) — use isso se for
// rodar num servidor/VM/Render, onde um processo pode ficar sempre ligado.
// Para deploy no Vercel, use api/buscar.js + public/index.html em vez deste arquivo.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { buscarContato, paginaResultado } = require('./lib');

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

  if (req.method === 'POST' && (req.url === '/buscar' || req.url === '/api/buscar')) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      const params = new URLSearchParams(body);
      const cnpjRaw = params.get('documento') || '';
      const cnpjLimpo = cnpjRaw.replace(/\D/g, '');

      if (!cnpjLimpo) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>CNPJ inválido. <a href="/">Voltar</a></p>');
        return;
      }

      const resultado = await buscarContato(cnpjLimpo, process.env);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(paginaResultado(cnpjRaw, resultado));
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

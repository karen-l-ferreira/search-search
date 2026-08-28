// Function serverless do Vercel. O Vercel detecta automaticamente qualquer
// arquivo dentro de /api e expõe como rota (essa vira POST /api/buscar).
const { buscarPorNomeOuCnpj, paginaResultadoBusca } = require('../lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Método não permitido');
    return;
  }

  // No Vercel, req.body já vem parseado quando o Content-Type é
  // application/x-www-form-urlencoded (padrão de <form method="POST">)
  const entrada = String((req.body && req.body.documento) || '').trim();

  if (!entrada) {
    res.status(400).send('<p>Informe um CNPJ ou razão social. <a href="/">Voltar</a></p>');
    return;
  }

  const busca = await buscarPorNomeOuCnpj(entrada, process.env);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(paginaResultadoBusca(busca));
};

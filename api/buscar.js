// Function serverless do Vercel. O Vercel detecta automaticamente qualquer
// arquivo dentro de /api e expõe como rota (essa vira POST /api/buscar).
const { buscarContato, paginaResultado } = require('../lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Método não permitido');
    return;
  }

  // No Vercel, req.body já vem parseado quando o Content-Type é
  // application/x-www-form-urlencoded (padrão de <form method="POST">)
  const cnpjRaw = (req.body && req.body.documento) || '';
  const cnpjLimpo = String(cnpjRaw).replace(/\D/g, '');

  if (!cnpjLimpo) {
    res.status(400).send('<p>CNPJ inválido. <a href="/">Voltar</a></p>');
    return;
  }

  const resultado = await buscarContato(cnpjLimpo, process.env);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(paginaResultado(cnpjRaw, resultado));
};

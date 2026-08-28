// Function serverless do Vercel para enriquecimento em massa (upload de planilha).
const { parseMultipart } = require('../multipart');
const { enriquecerPlanilha } = require('../lote');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Método não permitido');
    return;
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const { files } = parseMultipart(buffer, req.headers['content-type']);
    const arquivo = files.planilha;
    if (!arquivo || !arquivo.content || !arquivo.content.length) {
      res.status(400).send('<p>Nenhum arquivo enviado. <a href="/lote.html">Voltar</a></p>');
      return;
    }

    const resultado = await enriquecerPlanilha(arquivo.content, process.env);
    if (resultado.erro) {
      res.status(400).send(`<p>${resultado.erro} <a href="/lote.html">Voltar</a></p>`);
      return;
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="resultado-enriquecimento.xlsx"');
    res.status(200).send(resultado.bufferSaida);
  } catch (err) {
    res.status(500).send('Erro ao processar a planilha: ' + String((err && err.message) || err));
  }
};

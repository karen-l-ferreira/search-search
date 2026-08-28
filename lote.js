// Enriquecimento em massa a partir de uma planilha (.xlsx/.xls/.csv).
// Cada linha pode trazer um CNPJ ou uma razão social na coluna detectada —
// reaproveita o mesmo fluxo de busca usado na tela única (lib.js).

const XLSX = require('xlsx');
const { buscarPorNomeOuCnpj } = require('./lib');

const REGEX_COLUNA_CNPJ = /^cnpj$|^cpf$|^documento$/i;
const REGEX_COLUNA_NOME = /raz[aã]o|nome|empresa|cedente|cliente/i;

function detectarColuna(headerRow) {
  let idxCnpj = -1;
  let idxNome = -1;
  headerRow.forEach((cell, i) => {
    const v = String(cell || '').trim();
    if (idxCnpj === -1 && REGEX_COLUNA_CNPJ.test(v)) idxCnpj = i;
    if (idxNome === -1 && REGEX_COLUNA_NOME.test(v)) idxNome = i;
  });
  if (idxCnpj !== -1) return idxCnpj;
  if (idxNome !== -1) return idxNome;
  return 0;
}

function lerEntradasDaPlanilha(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (!linhas.length) return { header: [], linhas: [], colIndex: 0 };

  const header = linhas[0];
  const colIndex = detectarColuna(header);
  const dados = linhas.slice(1).filter((linha) => linha.some((c) => String(c || '').trim() !== ''));
  return { header, linhas: dados, colIndex };
}

async function processarComLimiteDeConcorrencia(items, limite, worker) {
  const resultados = new Array(items.length);
  let indice = 0;
  async function proximo() {
    while (indice < items.length) {
      const atual = indice++;
      resultados[atual] = await worker(items[atual], atual);
    }
  }
  const trabalhadores = Array.from({ length: Math.min(limite, items.length) }, proximo);
  await Promise.all(trabalhadores);
  return resultados;
}

const COLUNAS_NOVAS = [
  'Tipo_Entrada',
  'CNPJ_Usado',
  'Razao_Social_Encontrada',
  'Nome_Contato_AC',
  'Email_Contato_AC',
  'Telefone_Contato_AC',
  'Telefones_Encontrados',
  'Emails_Encontrados',
  'Avisos_ou_Erro',
];

function linhaVazia(base) {
  return [...base, '', '', '', '', '', '', '', '', 'Linha sem valor na coluna de busca'];
}

function linhaComErro(base, busca) {
  return [...base, busca.tipo, '', '', '', '', '', '', '', busca.erro];
}

function linhaComResultado(base, busca) {
  const r = busca.resultado;
  const avisos = [];
  if (!r.fontes.lemit.ok) avisos.push('Lemit falhou');
  if (!r.fontes.receita.ok) avisos.push('Receita Federal falhou');
  if (!r.fontes.ac.ok) avisos.push('ActiveCampaign falhou');
  const razaoEncontrada = busca.tipo === 'nome' && busca.candidatos[0] ? busca.candidatos[0].razaoSocial : '';

  return [
    ...base,
    busca.tipo,
    busca.cnpjUsado || '',
    razaoEncontrada,
    r.contatosAC.map((c) => c.nome).join('; '),
    r.contatosAC.map((c) => c.email).filter(Boolean).join('; '),
    r.contatosAC.map((c) => c.telefone).filter(Boolean).join('; '),
    r.telefones.join('; '),
    r.emails.join('; '),
    avisos.join('; '),
  ];
}

async function enriquecerPlanilha(buffer, env, { concorrencia = 4 } = {}) {
  const { header, linhas, colIndex } = lerEntradasDaPlanilha(buffer);
  if (!linhas.length) {
    return { erro: 'Não encontrei nenhuma linha com dados na planilha.' };
  }

  const resultados = await processarComLimiteDeConcorrencia(linhas, concorrencia, async (linha) => {
    const entrada = String(linha[colIndex] || '').trim();
    if (!entrada) return { linha, busca: null };
    const busca = await buscarPorNomeOuCnpj(entrada, env);
    return { linha, busca };
  });

  const linhasSaida = resultados.map(({ linha, busca }) => {
    const base = [...linha];
    while (base.length < header.length) base.push('');

    if (!busca) return linhaVazia(base);
    if (busca.erro) return linhaComErro(base, busca);
    return linhaComResultado(base, busca);
  });

  const linhasCompletas = [[...header, ...COLUNAS_NOVAS], ...linhasSaida];
  const novaSheet = XLSX.utils.aoa_to_sheet(linhasCompletas);
  const novoWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(novoWb, novaSheet, 'Resultado');
  const bufferSaida = XLSX.write(novoWb, { type: 'buffer', bookType: 'xlsx' });

  return { bufferSaida, total: linhas.length, colunaUsada: header[colIndex] || `coluna ${colIndex + 1}` };
}

module.exports = { enriquecerPlanilha, lerEntradasDaPlanilha, detectarColuna };

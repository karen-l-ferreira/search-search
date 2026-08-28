// Lógica compartilhada: consulta Lemit, Receita Federal (BrasilAPI) e ActiveCampaign
// Usado tanto pelo servidor standalone (server.js) quanto pela function do Vercel (api/buscar.js)

const https = require('https');

function httpsGet(urlString, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const req = https.get(urlString, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: JSON.parse(data) });
        } catch (e) {
          resolve({ ok: false, status: res.statusCode, json: null, raw: data });
        }
      });
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, status: 0, json: null, error: String(err) });
    });
    req.setTimeout(timeoutMs, () => {
      if (settled) return;
      settled = true;
      req.destroy();
      resolve({ ok: false, status: 0, json: null, error: 'timeout' });
    });
  });
}

const PHONE_KEY = /telefone|phone|celular|fone|whatsapp|contato_tel/i;
const EMAIL_KEY = /email|e-mail/i;

function coletar(obj, phones, emails) {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    obj.forEach((item) => coletar(item, phones, emails));
    return;
  }
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string' || typeof val === 'number') {
        if (PHONE_KEY.test(key) && String(val).trim() !== '') phones.push(String(val));
        if (EMAIL_KEY.test(key) && String(val).trim() !== '') emails.push(String(val));
      } else {
        coletar(val, phones, emails);
      }
    }
  }
}

function dedup(lista) {
  const seen = new Set();
  return lista.filter((v) => {
    const k = v.replace(/\D/g, '') || v.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function buscarCnpjPorNome(nomeEmpresa, env) {
  const CNPJA_API_KEY = env.CNPJA_API_KEY || '';
  if (!CNPJA_API_KEY) {
    return { ok: false, erro: 'CNPJA_API_KEY não configurado no .env', candidatos: [] };
  }

  const url = `https://api.cnpja.com/office?names.in=${encodeURIComponent(nomeEmpresa)}&limit=5`;
  const resp = await httpsGet(url, { Authorization: CNPJA_API_KEY });

  if (!resp.ok) {
    return {
      ok: false,
      erro: `CNPJá falhou ao buscar por nome (status ${resp.status || 'sem resposta'}${resp.error ? ', ' + resp.error : ''})`,
      candidatos: [],
    };
  }

  // A API pode devolver um array direto ou um objeto com a lista em "records"/"data",
  // dependendo da versão — tratamos as variações conhecidas em vez de travar em uma só.
  const lista = Array.isArray(resp.json)
    ? resp.json
    : (resp.json && (resp.json.records || resp.json.data)) || [];

  const candidatos = lista
    .map((item) => ({
      cnpj: (item.taxId || '').replace(/\D/g, ''),
      razaoSocial: (item.company && item.company.name) || item.alias || '',
      nomeFantasia: item.alias || '',
      uf: (item.address && item.address.state) || '',
      municipio: (item.address && item.address.city) || '',
    }))
    .filter((c) => c.cnpj.length === 14);

  return { ok: true, candidatos };
}

async function buscarPorNomeOuCnpj(entrada, env) {
  const limpo = String(entrada).replace(/\D/g, '');

  if (limpo.length === 14) {
    const resultado = await buscarContato(limpo, env);
    return { entrada, tipo: 'cnpj', cnpjUsado: limpo, candidatos: [], resultado, erro: null };
  }

  const busca = await buscarCnpjPorNome(entrada, env);
  if (!busca.ok || !busca.candidatos.length) {
    return {
      entrada,
      tipo: 'nome',
      cnpjUsado: null,
      candidatos: [],
      resultado: null,
      erro: busca.erro || `Nenhuma empresa encontrada na CNPJá para "${entrada}"`,
    };
  }

  const escolhido = busca.candidatos[0];
  const resultado = await buscarContato(escolhido.cnpj, env);
  return { entrada, tipo: 'nome', cnpjUsado: escolhido.cnpj, candidatos: busca.candidatos, resultado, erro: null };
}

async function buscarContato(cnpjLimpo, env) {
  const LEMIT_TOKEN = env.LEMIT_TOKEN || '';
  const AC_API_TOKEN = env.AC_API_TOKEN || '';
  const AC_BASE_URL = env.AC_BASE_URL || 'https://gcbinvestimentos.activehosted.com';

  const [lemit, receitaPrimaria, ac] = await Promise.all([
    httpsGet(`https://api.lemit.com.br/api/v1/consulta/empresa/${cnpjLimpo}`, {
      Authorization: `Bearer ${LEMIT_TOKEN}`,
    }),
    httpsGet(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`),
    httpsGet(`${AC_BASE_URL}/api/3/contacts?search=${cnpjLimpo}`, {
      'Api-Token': AC_API_TOKEN,
    }),
  ]);

  // Se a BrasilAPI falhar (ex: limite de requisições, 429), tenta a ReceitaWS
  // como alternativa antes de desistir dessa fonte.
  let receita = receitaPrimaria;
  if (!receitaPrimaria.ok) {
    const receitaAlternativa = await httpsGet(`https://www.receitaws.com.br/v1/cnpj/${cnpjLimpo}`);
    if (receitaAlternativa.ok) {
      receita = receitaAlternativa;
    }
  }

  const phones = [];
  const emails = [];
  coletar(lemit.json, phones, emails);
  coletar(receita.json, phones, emails);
  coletar(ac.json, phones, emails);

  const contatosAC = ((ac.json && ac.json.contacts) || []).map((c) => {
    const nome = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
    return { nome: nome || '(sem nome)', email: c.email || '', telefone: c.phone || '' };
  });

  return {
    telefones: dedup(phones),
    emails: dedup(emails),
    contatosAC,
    fontes: {
      lemit: { ok: lemit.ok, status: lemit.status, erro: lemit.error },
      receita: { ok: receita.ok, status: receita.status, erro: receita.error },
      ac: { ok: ac.ok, status: ac.status, erro: ac.error },
    },
  };
}

function paginaResultadoBusca(busca) {
  if (busca.erro) {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Resultado da Busca</title>
<style>
  body { font-family: Arial, sans-serif; background: #f5f6f8; padding: 40px; }
  .card { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 32px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
  h2 { margin-top: 0; color: #193469; }
  .avisos { background: #FAECE7; padding: 12px; border-radius: 4px; font-size: 14px; }
  a.voltar { display: inline-block; margin-top: 20px; color: #f4633a; }
</style>
</head>
<body>
  <div class="card">
    <h2>Busca: ${escapeHtml(busca.entrada)}</h2>
    <div class="avisos">${escapeHtml(busca.erro)}</div>
    <a class="voltar" href="/">&larr; Nova busca</a>
  </div>
</body>
</html>`;
  }

  const notaOrigem =
    busca.tipo === 'nome'
      ? `<div class="origem">Encontrado via busca por razão social na CNPJá — CNPJ: <strong>${escapeHtml(busca.cnpjUsado)}</strong></div>`
      : '';

  const alternativas =
    busca.candidatos.length > 1
      ? `<h3>Outras empresas encontradas com nome parecido</h3><ul>${busca.candidatos
          .slice(1)
          .map((c) => `<li>${escapeHtml(c.razaoSocial)} — ${escapeHtml(c.cnpj)} (${escapeHtml(c.uf || '')})</li>`)
          .join('')}</ul><p class="aviso-alt">Se o CNPJ escolhido acima não for a empresa certa, refaça a busca usando um desses CNPJs diretamente.</p>`
      : '';

  const pagina = paginaResultado(busca.cnpjUsado, busca.resultado);
  return pagina.replace('<div class="card">', `<div class="card">${notaOrigem}`).replace('<a class="voltar"', `${alternativas}<a class="voltar"`);
}

function paginaResultado(cnpj, resultado) {
  const linhasTelefones = resultado.telefones.length
    ? resultado.telefones.map((t) => `<li>${escapeHtml(t)}</li>`).join('')
    : '<li><em>nenhum encontrado</em></li>';
  const linhasEmails = resultado.emails.length
    ? resultado.emails.map((e) => `<li>${escapeHtml(e)}</li>`).join('')
    : '<li><em>nenhum encontrado</em></li>';
  const linhasAC = resultado.contatosAC.length
    ? resultado.contatosAC
        .map((c) => `<li>${escapeHtml(c.nome)} — ${escapeHtml(c.email)} — ${escapeHtml(c.telefone)}</li>`)
        .join('')
    : '<li><em>nenhum contato encontrado no AC</em></li>';

  const avisos = [];
  if (!resultado.fontes.lemit.ok) avisos.push(`Lemit falhou (status ${resultado.fontes.lemit.status || 'sem resposta'}${resultado.fontes.lemit.erro ? ', ' + resultado.fontes.lemit.erro : ''})`);
  if (!resultado.fontes.receita.ok) avisos.push(`Receita Federal falhou (status ${resultado.fontes.receita.status || 'sem resposta'}${resultado.fontes.receita.erro ? ', ' + resultado.fontes.receita.erro : ''})`);
  if (!resultado.fontes.ac.ok) avisos.push(`ActiveCampaign falhou (status ${resultado.fontes.ac.status || 'sem resposta'}${resultado.fontes.ac.erro ? ', ' + resultado.fontes.ac.erro : ''})`);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Resultado da Busca</title>
<style>
  body { font-family: Arial, sans-serif; background: #f5f6f8; padding: 40px; }
  .card { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 32px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
  h2 { margin-top: 0; color: #193469; }
  h3 { color: #193469; margin-bottom: 8px; }
  ul { margin-top: 0; padding-left: 20px; }
  .avisos { background: #FAECE7; padding: 12px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; }
  a.voltar { display: inline-block; margin-top: 20px; color: #f4633a; }
</style>
</head>
<body>
  <div class="card">
    <h2>Resultado: ${escapeHtml(cnpj)}</h2>
    ${avisos.length ? `<div class="avisos"><strong>Atenção:</strong><ul>${avisos.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul></div>` : ''}
    <h3>Contato(s) já cadastrado(s) no AC</h3>
    <ul>${linhasAC}</ul>
    <h3>Telefones encontrados</h3>
    <ul>${linhasTelefones}</ul>
    <h3>Emails encontrados</h3>
    <ul>${linhasEmails}</ul>
    <a class="voltar" href="/">&larr; Nova busca</a>
  </div>
</body>
</html>`;
}

module.exports = {
  buscarContato,
  paginaResultado,
  buscarCnpjPorNome,
  buscarPorNomeOuCnpj,
  paginaResultadoBusca,
  escapeHtml,
};

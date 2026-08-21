// Lógica compartilhada: consulta Lemit, Receita Federal (BrasilAPI) e ActiveCampaign
// Usado tanto pelo servidor standalone (server.js) quanto pela function do Vercel (api/buscar.js)

const https = require('https');
const { URL } = require('url');

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

function httpsPost(urlString, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const u = new URL(urlString);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers },
      (res) => {
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
      }
    );
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
    req.end();
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

async function buscarContato(cnpjLimpo, env) {
  const LEMIT_TOKEN = env.LEMIT_TOKEN || '';
  const AC_API_TOKEN = env.AC_API_TOKEN || '';
  const AC_BASE_URL = env.AC_BASE_URL || 'https://gcbinvestimentos.activehosted.com';

  const [lemit, receita, ac, saldo] = await Promise.all([
    httpsGet(`https://api.lemit.com.br/api/v1/consulta/empresa/${cnpjLimpo}`, {
      Authorization: `Bearer ${LEMIT_TOKEN}`,
    }),
    httpsGet(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`),
    httpsGet(`${AC_BASE_URL}/api/3/contacts?search=${cnpjLimpo}`, {
      'Api-Token': AC_API_TOKEN,
    }),
    httpsPost(`https://api.lemit.com.br/api/v1/saldo`, {
      Authorization: `Bearer ${LEMIT_TOKEN}`,
    }),
  ]);

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
    saldo: saldo.json,
    fontes: {
      lemit: { ok: lemit.ok, status: lemit.status, erro: lemit.error },
      receita: { ok: receita.ok, status: receita.status, erro: receita.error },
      ac: { ok: ac.ok, status: ac.status, erro: ac.error },
      saldo: { ok: saldo.ok, status: saldo.status, erro: saldo.error },
    },
  };
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

  let saldoTexto = 'não disponível';
  if (resultado.fontes.saldo.ok && resultado.saldo) {
    const s = resultado.saldo;
    const chaveConhecida = ['saldo', 'creditos', 'credito', 'limite', 'consultas_restantes', 'balance'].find(
      (k) => s[k] !== undefined
    );
    if (chaveConhecida) {
      saldoTexto = String(s[chaveConhecida]);
    } else {
      // Não achou um campo com nome conhecido, mostra o retorno bruto (limitado)
      saldoTexto = escapeHtml(JSON.stringify(s)).slice(0, 300);
    }
  } else if (!resultado.fontes.saldo.ok) {
    saldoTexto = `falhou (status ${resultado.fontes.saldo.status || 'sem resposta'})`;
  }

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
    <h3>Saldo restante Lemit</h3>
    <p>${saldoTexto}</p>
    <a class="voltar" href="/">&larr; Nova busca</a>
  </div>
</body>
</html>`;
}

module.exports = { buscarContato, paginaResultado, escapeHtml };

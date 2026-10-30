'use strict';
// Matheus Vicente - matheis.vieira@bjsegdistribuidora.com.br
/* =========================================================
   BJSEG — Controle de Estoque (consulta e análise) · multi-loja
   Perfis: Líder (enxerga todas as lojas) e uma conta por loja (enxerga só a própria).
   O Object é a fonte de tudo (estoque, transferências, movimentações). Esta ferramenta é SOMENTE LEITURA: só mostra e analisa os números.
   ========================================================= */
const KEY = 'bjseg.wms.v3', NAVKEY = 'bjseg.nav', LOCKEY = 'bjseg.loc', AUTHKEY = 'bjseg.auth.v2', SESSKEY = 'bjseg.sess', THEMEKEY = 'bjseg.theme', SGKEY = 'bjseg.avisos.', FAVKEY = 'bjseg.fav.', FILKEY = 'bjseg.filtros.';

/* ---------- Integração com o ERP Object ----------
   Ajuste a URL (e o token, se houver). Sem resposta válida, entra em modo SIMULADO. */
const ERP = { url: 'https://bjseg.objectdata.com.br/intranet/main?chat_empresa=&time=1753700631', auto: 1000 /* sincronização automática, em ms (0 = só manual) */, urlTransf: '' /* URL das transferências no Object (vazio = modo simulado) */, token: '', timeout: 6000 };

const DAY = 864e5, PARADO = 60; // PARADO = dias sem saída para considerar estoque parado
const ATRASO = 3, ATRASO_GRAVE = 7; // transferência pendente: atenção após 3 dias, crítico após 7
const STALE_MIN = 60;               // minutos sem leitura do Object para avisar "dados desatualizados"
const AJUSTE_VALOR = 500;           // ajuste de inventário a partir deste valor (em custo) vira alerta
const COB_RECEBE = 7, COB_ALVO = 14; // unidade com menos de 7 dias de cobertura pede reforço; quem doa nunca cai abaixo de 14 dias (nem de 2× o mínimo)
let sgCache = []; // sugestões de transferência da visão atual (recalculadas a cada render)
const PEND_SAIU_ORIGEM = true;      // true = o Object já baixa o saldo da origem ao criar a transferência (então o "a caminho" entra no total da empresa)
const LOCS = [
  { id: 'matriz', nome: 'Face Matriz' }, { id: 'aruja', nome: 'Arujá' },
  { id: 'sjc', nome: 'São José dos Campos' }, { id: 'taubate', nome: 'Taubaté' }, { id: 'santos', nome: 'Santos' }
];
/* Acessos: 1 líder + 1 por loja. Senha padrão = 'bjseg@' + id (ex.: bjseg@aruja). Só o líder pode alterar senhas (aba Acessos). */
const USERS = [{ id: 'lider', nome: 'Líder (todas as lojas)', admin: true }, ...LOCS.map(l => ({ id: l.id, nome: l.nome, loc: l.id }))];
const defPass = id => 'bjseg@' + id;
const VIEWS = ['painel', 'lojas', 'estoque', 'transferencias', 'atividades', 'analises', 'alertas', 'compras', 'acessos'];
const VIEWS_LOJA = ['painel', 'estoque', 'transferencias', 'atividades', 'analises', 'alertas'];
const LABEL = { ok: 'Estoque Normal', crit: 'Crítico', out: 'Esgotado' };
const TAG = { in: 'Entrada', out: 'Saída', tr: 'Transf.', adj: 'Ajuste', erp: 'ERP' };

const $ = (s, el = document) => el.querySelector(s);
const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDT = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const pc = n => n.toFixed(1).replace('.', ',') + '%';
const dec = n => n.toFixed(1).replace('.', ',');
const wait = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const LN = id => id === 'all' ? 'Geral (todas as lojas)' : (LOCS.find(l => l.id === id)?.nome || id);
const zero = () => Object.fromEntries(LOCS.map(l => [l.id, 0]));
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

/* ---------- Dados de exemplo ---------- */
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seed() {
  const now = Date.now(), R = rng(20261029), W = [.35, .15, .2, .15, .15];
  const arr = a => Object.fromEntries(LOCS.map((l, i) => [l.id, a[i]]));
  // P(sku, produto, categoria, fornecedor, prazo, custo, preço, local na matriz, estoque[5], mínimo[5], saídas/dia, janela)
  const P = (sku, name, cat, supplier, lead, cost, price, loc, stock, min, rate, win) =>
    ({ id: crypto.randomUUID(), sku, name, cat, supplier, lead, cost, price, loc, stock: arr(stock), min: arr(min), rate, win, created: now - 120 * DAY, updated: now });
  const products = [
    P('7767', 'CAMERA HIK B 1080P DS-2CE16D0T-EXIPF', 'CFTV', 'HIKVISION', 7, 74.5, 119.9, 'A-01-1', [60, 8, 7, 6, 5], [20, 3, 3, 2, 2], 3.2),
    P('7687', 'DVR HIK 16CH 1080P IDS-7216HQHI-M1/FA/ALM ACUSENSE ALARME', 'CFTV', 'HIKVISION', 7, 430, 689, 'A-02-1', [5, 2, 1, 0, 1], [4, 1, 1, 1, 1], .6),
    P('8152', 'DVR HIK 08CH 3K/5MP LITE IDS-7208HQHI-M1/XT', 'CFTV', 'HIKVISION', 7, 240, 389, 'A-02-2', [12, 4, 3, 3, 2], [6, 2, 2, 2, 1], .8),
    P('7768', 'CAMERA HIK D 1080P DS-2CE76D0T-EXIPF (2.8MM)', 'CFTV', 'HIKVISION', 10, 82, 134.5, 'A-01-2', [0, 0, 0, 0, 0], [8, 3, 3, 3, 3], 2.5),
    P('7748', 'HD INTERNO 4TB SKYHAWK (11196063)', 'CFTV', 'HIKVISION', 10, 310, 459, 'A-03-1', [9, 2, 2, 2, 0], [4, 1, 1, 1, 1], .5),
    P('9256', 'PEC DZ GATTER 400 (3M CREM) 220V SB1000 10004856', 'Motores', 'NICE', 15, 820, 1290, 'B-01-1', [4, 1, 0, 1, 0], [4, 1, 1, 1, 1], .35),
    P('9179', 'PEC BV GATTER PLUS F10 1.5M 220V P40 20008246+20007655', 'Motores', 'NICE', 15, 560, 899, 'B-01-2', [8, 2, 2, 2, 2], [3, 1, 1, 1, 1], .3),
    P('635', 'CABO COAXIAL 4MM BIP DUPLA BLINDAGEM CONDUTTI (CX AZUL) RL0100M', 'Cabeamento', 'CONDUTTI', 5, 175, 289, 'C-01-1', [20, 4, 3, 3, 2], [12, 2, 2, 2, 2], 1.2),
    P('3816', 'CABO LAN CAT5 AZ SOHOPLUS CX0305M', 'Cabeamento', 'SOHOPLUS', 5, 210, 349, 'C-01-2', [5, 2, 2, 1, 1], [5, 2, 1, 1, 1], .5),
    P('2563', 'CABO LAN 4P CONDUTTI MULTICAMERAS BC RL0100M', 'Cabeamento', 'CONDUTTI', 5, 62, 109, 'C-02-1', [30, 2, 5, 4, 3], [10, 2, 2, 2, 2], 1.5),
    P('2371', 'CENTRAL ALARME JFL SMARTCLOUD 32 34374/42321', 'Alarmes', 'JFL', 7, 690, 1149, 'D-01-1', [2, 1, 0, 1, 0], [3, 1, 1, 1, 1], .25),
    P('641', 'SENSOR INFRA ATIVO JFL DUPLO IRA-360 V3', 'Alarmes', 'JFL', 7, 41, 79.9, 'D-02-1', [40, 8, 7, 6, 3], [15, 3, 3, 3, 3], 1.8),
    P('6804', 'SIRENE 12V PT JFL SIR-120 32402', 'Alarmes', 'JFL', 5, 19, 39.9, 'D-02-2', [0, 2, 1, 0, 0], [8, 2, 2, 2, 2], .9),
    P('4131', 'CONTROLE DE ACESSO FACIAL HIKVISION DS-K1T342MFWX C/ BIOMETRIA+WIFI/ MIFARE IP65', 'Controle de Acesso', 'HIKVISION', 7, 290, 479, 'E-01-1', [8, 2, 1, 1, 0], [4, 1, 1, 1, 1], .4),
    P('3714', 'FECHADURA ELETROIMA IPEC M150 PT C/ SENSOR', 'Controle de Acesso', 'IPEC', 7, 98, 169, 'E-01-2', [6, 2, 2, 1, 1], [3, 1, 1, 1, 1], .3),
    P('8231', 'PPA CANCELA BARRIER BRUSHLESS SLIM 3.0M S/ BARREIRA F08164001', 'Controle de Acesso', 'PPA', 20, 1950, 2890, 'F-01-1', [5, 0, 0, 0, 0], [0, 0, 0, 0, 0], .1, [75, 100]),
    P('8885', 'FONTE MCM 12V 3A GARRA PLUS C/ PLUG PR1555', 'Acessórios', 'MCM', 5, 31, 54.9, 'G-01-1', [50, 10, 8, 7, 5], [20, 4, 4, 4, 3], 2.2),
    P('665', 'CONEC BNC MOLA PARAFUSO 6MM DOURADO', 'Acessórios', 'Fornecedor Geral (exemplo)', 5, 33, 59, 'G-01-2', [12, 3, 2, 2, 1], [5, 2, 1, 1, 1], .7),
    P('3757', 'PPA CREMALHEIRA POP 1.5M CUSTOM F22902 - A22902', 'Acessórios', 'PPA', 10, 15.5, 28.5, 'G-02-1', [80, 15, 10, 8, 7], [25, 5, 5, 5, 3], 2),
    P('8666', 'CONEC P4 MACHO C/ BORNE', 'Acessórios', 'Fornecedor Geral (exemplo)', 5, 18, 32, 'G-02-2', [60, 0, 0, 0, 0], [0, 0, 0, 0, 0], .15, [70, 100])
  ];
  // Histórico de saídas/entradas dos últimos 100 dias (base das análises)
  const pick = () => { let x = R(), i = 0; while (i < 4 && x > W[i]) { x -= W[i]; i++; } return LOCS[i].id; };
  const log = [];
  products.forEach(p => {
    const [d0, d1] = p.win || [1, 100];
    for (let d = d1; d >= d0; d--) {
      if (p.rate > 0 && R() < Math.min(1, p.rate))
        log.push({ t: now - (d - R() * .9) * DAY, type: 'out', sku: p.sku, qty: Math.max(1, Math.round(p.rate * (.5 + R() * 1.5))), loc: pick() });
      if (p.rate > 0 && !p.win && R() < .06)
        log.push({ t: now - (d - R() * .9) * DAY, type: 'in', sku: p.sku, qty: Math.max(5, Math.round(p.rate * 14)), loc: 'matriz' });
    }
  });
  [['7767', -8, 'aruja', 2], ['4131', -3, 'sjc', 6], ['641', 9, 'sjc', 11]].forEach(([sku, q, loc, d]) => log.push({ t: now - d * DAY, type: 'adj', sku, qty: q, loc }));
  products.forEach(p => { delete p.rate; delete p.win; });
  log.sort((a, b) => b.t - a.t);
  return { v: 3, products, log, erp: { status: 'idle', last: null, msg: '' } };
}
let state = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { return seed(); } })();
(function fix() {
  state.log ||= []; state.transf ||= seedTransf(); state.transf.forEach(t => { t.items ||= [{ sku: t.sku, qty: t.qty }]; }); state.erp ||= { status: 'idle', last: null, msg: '' }; state.imports ||= [];
  if (state.erp.status === 'sync') state.erp.status = 'idle';
  state.products.forEach(p => { p.stock = { ...zero(), ...p.stock }; p.min = { ...zero(), ...p.min }; p.created ||= Date.now(); });
})();
let me = null, cur = 'all'; // me = usuário logado; cur = visão atual ('all' ou id da loja)
const isAdm = () => !!me?.admin;

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('Não foi possível salvar no navegador'); } };
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800); }
function addLog(o) { state.log.unshift({ t: Date.now(), ...o }); if (state.log.length > 3000) state.log.length = 3000; }

/* ---------- Regras de negócio ---------- */
const qty = (p, loc = cur) => loc === 'all' ? sum(p.stock) : (p.stock[loc] || 0);
const minq = (p, loc = cur) => loc === 'all' ? sum(p.min) : (p.min[loc] || 0);
const alertAt = (p, loc) => p.min[loc] > 0 && p.stock[loc] <= p.min[loc];
function statusOf(p, loc = cur) {
  if (loc === 'all') return sum(p.stock) === 0 ? 'out' : LOCS.some(l => alertAt(p, l.id)) ? 'crit' : 'ok';
  const s = p.stock[loc], m = p.min[loc];
  return s === 0 ? 'out' : m > 0 && s <= m ? 'crit' : 'ok';
}
function outs(sku, days, loc) { // saídas (un.) nos últimos N dias
  const lim = Date.now() - days * DAY; let s = 0;
  for (const l of state.log) { if (l.t < lim) break; if (l.type === 'out' && l.sku === sku && (loc === 'all' || l.loc === loc)) s += l.qty; }
  return s;
}
function lastOut(sku, loc) { for (const l of state.log) if (l.type === 'out' && l.sku === sku && (loc === 'all' || l.loc === loc)) return l.t; return null; }
function covTxt(p, loc = cur) {
  const a = outs(p.sku, 30, loc) / 30; if (!a) return '—';
  const c = qty(p, loc) / a, cls = c < p.lead ? 'out' : c < p.lead * 2 ? 'crit' : '';
  return `<span class="cv ${cls}">${c >= 999 ? '999+' : Math.round(c)} d</span>`;
}
const nameOf = sku => state.products.find(p => p.sku === sku)?.name || sku;
const matches = p => { const q = $('#q').value.trim().toLowerCase(); return !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q); };
function buyList() { // sugestão de compra por fornecedor (usa estoque total) — só o líder vê
  const g = {};
  state.products.forEach(p => {
    const tot = sum(p.stock) + (PEND_SAIU_ORIGEM ? inTransit(p.sku, 'all') : 0), mn = sum(p.min), avg = rate(p, 'all').r, cob = avg > 0 ? tot / avg : null;
    const risco = cob !== null && cob < p.lead, baixo = mn > 0 && tot <= mn;
    if (!risco && !baixo) return;
    const q = Math.max(mn * 2, Math.ceil(avg * (p.lead + 15))) - tot;
    if (q > 0) (g[p.supplier || 'Não informado'] ||= []).push({ p, q, tot, cob, risco });
  });
  return g;
}

/* ---------- Cálculos de leitura: a caminho, ritmo previsto, ruptura, sugestões, fluxo, alertas ----------
   Nada aqui altera dados: são só contas em cima do que o Object enviou. */
const fmtDay = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const ago = t => { const m = Math.floor((Date.now() - t) / 6e4); return m < 1 ? 'menos de 1 min' : m < 60 ? m + ' min' : m < 1440 ? Math.floor(m / 60) + ' h' : Math.floor(m / 1440) + ' d'; };
const tVisible = t => cur === 'all' || t.from === cur || t.to === cur;
const SEV = { out: 'Crítico', crit: 'Atenção' };
const TREND = { up: ['↑ em alta', 'crit'], down: ['↓ em queda', ''], flat: ['→ estável', ''] };

function lowPairs() { // itens por local no mínimo ou abaixo, do mais urgente ao menos
  const pairs = [];
  state.products.forEach(p => LOCS.forEach(l => { if ((cur === 'all' || cur === l.id) && alertAt(p, l.id)) pairs.push({ p, loc: l.id }); }));
  return pairs.sort((a, b) => a.p.stock[a.loc] / a.p.min[a.loc] - b.p.stock[b.loc] / b.p.min[b.loc]);
}
function inTransit(sku, loc = cur) { // unidades de transferências PENDENTES com destino em loc ('all' = todas)
  const S = String(sku).toUpperCase(); let s = 0;
  state.transf.forEach(t => { if (t.status !== 'pend' || (loc !== 'all' && t.to !== loc)) return; t.items.forEach(i => { if (i.sku.toUpperCase() === S) s += i.qty; }); });
  return s;
}
function rate(p, loc = cur) { // ritmo previsto (un./dia): média móvel ponderada, 60% dos últimos 30 dias + 40% dos últimos 7
  const a30 = outs(p.sku, 30, loc) / 30, a7 = outs(p.sku, 7, loc) / 7;
  return { r: a30 * .6 + a7 * .4, a30, a7, trend: a30 && a7 > a30 * 1.3 ? 'up' : a30 && a7 < a30 * .7 ? 'down' : 'flat' };
}
const rupTxt = (q, r) => !r ? '—' : q <= 0 ? 'Esgotado' : q / r > 365 ? 'mais de 1 ano' : fmtDay(Date.now() + q / r * DAY);

/* Dias em ruptura: o saldo de cada dia é refeito andando para trás nas movimentações do Object */
const evDelta = l => l.type === 'out' ? -l.qty : l.qty; // entrada soma, saída subtrai, ajuste já vem com sinal
function ruptura(p, loc = cur, days = 30) {
  const E = state.log.filter(l => l.sku === p.sku && (l.type === 'out' || l.type === 'in' || l.type === 'adj') && (loc === 'all' || l.loc === loc)), now = Date.now(), q = qty(p, loc);
  let n = 0;
  for (let d = 0; d < days; d++) {
    const b = now - d * DAY; let bal = q;
    for (const l of E) { if (l.t <= b) break; bal -= evDelta(l); }
    if (bal <= 0) n++;
  }
  return n;
}
function lostRow(p, loc = cur) { // venda perdida estimada = dias sem estoque × ritmo normal × preço
  const d = ruptura(p, loc, 30); if (!d) return null;
  const r = outs(p.sku, 90, loc) / Math.max(1, 90 - ruptura(p, loc, 90)); if (!r) return null;
  const un = r * d; return { p, d, r, un, val: un * p.price, mg: un * (p.price - p.cost) };
}

function suggestions() {
  // Aviso inteligente (regras, sem IA): recebe quem está no mínimo OU com menos de COB_RECEBE dias de cobertura.
  // A retirada é dividida unidade por unidade, sempre da que ficaria com MAIS dias de cobertura, para não pesar em nenhuma.
  // Quem doa nunca cai abaixo de 2× o mínimo nem de COB_ALVO dias de vendas. Só sugere: quem executa é o Object.
  const R = [], keep = (p, l, r) => Math.max(p.min[l] * 2, Math.ceil(r * COB_ALVO));
  state.products.forEach(p => {
    const rt = Object.fromEntries(LOCS.map(l => [l.id, rate(p, l.id).r])), tr = Object.fromEntries(LOCS.map(l => [l.id, inTransit(p.sku, l.id)])), eff = l => p.stock[l] + tr[l];
    const need0 = l => keep(p, l, rt[l]) - eff(l);
    const rec = LOCS.map(l => l.id).filter(l => need0(l) > 0 && ((alertAt(p, l) && eff(l) <= p.min[l]) || (rt[l] > 0 && eff(l) / rt[l] < COB_RECEBE)))
      .sort((a, b) => eff(a) / Math.max(keep(p, a, rt[a]), 1) - eff(b) / Math.max(keep(p, b, rt[b]), 1));
    if (!rec.length) return;
    const don = LOCS.map(l => l.id).filter(l => !rec.includes(l)).map(l => ({ id: l, sobra: p.stock[l] - keep(p, l, rt[l]), given: 0 })).filter(d => d.sobra > 0);
    rec.forEach(to => {
      let need = need0(to); const got = {};
      while (need > 0) {
        let best = null, bs = -1;
        for (const d of don) { if (d.sobra <= 0) continue; const s = (p.stock[d.id] - d.given) / Math.max(rt[d.id], .05); if (s > bs) { bs = s; best = d; } }
        if (!best) break;
        best.sobra--; best.given++; got[best.id] = (got[best.id] || 0) + 1; need--;
      }
      const ids = Object.keys(got);
      ids.forEach((id, i) => R.push({ p, from: id, to, q: got[id], tr: tr[to], rest: i === ids.length - 1 ? Math.max(0, need) : 0, dn: don.find(d => d.id === id), rd: rt[id] }));
    });
  });
  return cur === 'all' ? R : R.filter(x => x.from === cur || x.to === cur);
}
function flowData(days = 90) { // fluxo entre unidades: transferências aceitas no período + pendentes a receber
  const lim = Date.now() - days * DAY, m = {}, env = zero(), rec = zero(), pend = zero();
  LOCS.forEach(a => m[a.id] = zero());
  state.transf.forEach(t => {
    if (!tVisible(t)) return; const u = tQty(t);
    if (t.status === 'pend') pend[t.to] += u;
    else if (t.status === 'ok' && (t.decided || t.created) >= lim) { m[t.from][t.to] += u; env[t.from] += u; rec[t.to] += u; }
  });
  return { m, env, rec, pend };
}

/* Alertas e anomalias (leitura): cada item traz gravidade, tipo, item e explicação */
function alerts() {
  const A = [], now = Date.now(), P = state.products, inScope = l => cur === 'all' || l === cur, last = state.erp.last;
  if (!last) A.push({ sev: 'crit', tipo: 'Dados', item: 'Object', txt: 'Ainda não houve leitura do Object: os números exibidos são de exemplo.' });
  else if (now - last > STALE_MIN * 6e4) A.push({ sev: 'out', tipo: 'Dados desatualizados', item: 'Object', txt: `Última leitura há ${ago(last)}. Confira a conexão com o Object.` });
  state.transf.filter(t => t.status === 'pend' && tVisible(t)).forEach(t => {
    const age = Math.floor((now - t.created) / DAY); if (age <= ATRASO) return;
    A.push({ sev: age > ATRASO_GRAVE ? 'out' : 'crit', tipo: 'Transferência parada', item: `${t.id} · ${tName(t.items[0])}${t.items.length > 1 ? ` +${t.items.length - 1}` : ''}`,
      txt: `${LN(t.from)} → ${LN(t.to)}, ${tQty(t)} un. aguardando aceite há ${age} dias.` });
  });
  P.forEach(p => {
    const miss = []; if (p.cat === 'Sem categoria') miss.push('categoria'); if (!p.supplier || p.supplier === 'Não informado') miss.push('fornecedor'); if (!(p.cost > 0)) miss.push('custo'); if (!(p.price > 0)) miss.push('preço');
    if (miss.length) A.push({ sev: 'crit', tipo: 'Cadastro incompleto', item: `${p.name} (${p.sku})`, txt: `Falta no Object: ${miss.join(', ')}.` });
    if (p.price > 0 && p.cost >= p.price) A.push({ sev: 'out', tipo: 'Margem zero ou negativa', item: `${p.name} (${p.sku})`, txt: `Custo de ${brl(p.cost)} é maior ou igual ao preço de ${brl(p.price)}.` });
    LOCS.filter(l => inScope(l.id) && !p.min[l.id]).forEach(l => {
      const u = outs(p.sku, 30, l.id); if (u > 0) A.push({ sev: 'crit', tipo: 'Sem estoque mínimo', item: `${p.name} (${p.sku})`, txt: `${l.nome}: saiu ${u} un. em 30 dias e o mínimo não está definido.` });
    });
  });
  // Saídas fora do padrão (últimos 14 dias): quantidade 4× acima da média das saídas do mesmo produto
  const stat = {};
  for (const l of state.log) { if (l.t < now - 90 * DAY) break; if (l.type === 'out' && inScope(l.loc)) { const s = stat[l.sku] ||= { n: 0, q: 0 }; s.n++; s.q += l.qty; } }
  for (const l of state.log) {
    if (l.t < now - 14 * DAY) break; if (l.type !== 'out' || !inScope(l.loc)) continue;
    const s = stat[l.sku]; if (s && s.n >= 4 && l.qty >= Math.max(8, 4 * s.q / s.n))
      A.push({ sev: 'crit', tipo: 'Saída incomum', item: `${nameOf(l.sku)} (${l.sku})`, txt: `${LN(l.loc)}: saída de ${l.qty} un. em ${fmtDT(l.t)}; a média é ${dec(s.q / s.n)} por saída.` });
  }
  // Ajustes de inventário (30 dias): muitos ajustes ou valor alto em custo
  const adj = {};
  for (const l of state.log) {
    if (l.t < now - 30 * DAY) break; if (l.type !== 'adj' || !inScope(l.loc)) continue;
    const a = adj[l.sku] ||= { n: 0, net: 0, val: 0 }; a.n++; a.net += l.qty; a.val += Math.abs(l.qty) * (P.find(x => x.sku === l.sku)?.cost || 0);
  }
  Object.entries(adj).forEach(([sku, a]) => { if (a.n >= 3 || a.val >= AJUSTE_VALOR)
    A.push({ sev: a.val >= AJUSTE_VALOR * 4 ? 'out' : 'crit', tipo: 'Ajuste de inventário', item: `${nameOf(sku)} (${sku})`, txt: `${a.n} ajuste(s) em 30 dias, líquido de ${a.net > 0 ? '+' : ''}${a.net} un. (${brl(a.val)} em custo).` }); });
  return A.sort((a, b) => (a.sev === 'out' ? 0 : 1) - (b.sev === 'out' ? 0 : 1));
}

/* ---------- Integração ERP Object ---------- */
function locId(s) {
  const n = norm(s); if (!n) return null;
  return LOCS.find(l => l.id === n || norm(l.nome) === n || (l.id === 'matriz' && n.includes('matriz')) || (l.id === 'sjc' && n.includes('jose')))?.id || null;
}
// Converte um item do ERP (campos em PT ou EN) para o formato interno
function mapERP(r) {
  const sku = String(r.sku ?? r.codigo ?? '').trim().toUpperCase(); if (!sku) return null;
  const n = v => (v === undefined || v === null || v === '' || !Number.isFinite(+v)) ? null : +v;
  const put = (o, loc, v) => { const id = locId(loc), x = n(v); if (id && x !== null) o[id] = Math.max(0, Math.trunc(x)); };
  const it = { sku, name: r.name ?? r.descricao ?? r.produto, cat: r.cat ?? r.categoria, supplier: r.fornecedor ?? r.supplier,
    lead: n(r.prazo ?? r.lead), cost: n(r.custo ?? r.cost), price: n(r.preco ?? r.price ?? r.preco_venda), stock: {}, min: {} };
  const S = r.saldos ?? r.estoques ?? r.filiais;
  if (Array.isArray(S)) S.forEach(s => { const l = s.filial ?? s.loja ?? s.local ?? s.deposito; put(it.stock, l, s.saldo ?? s.stock ?? s.quantidade); put(it.min, l, s.minimo ?? s.min); });
  else if (S && typeof S === 'object') Object.entries(S).forEach(([k, v]) => put(it.stock, k, v));
  else { put(it.stock, 'matriz', r.saldo ?? r.stock ?? r.quantidade); put(it.min, 'matriz', r.minimo ?? r.min); } // sem local: assume Matriz
  return it;
}
function mergeERP(items) {
  let changed = 0, created = 0;
  items.forEach(it => {
    let p = state.products.find(x => x.sku.toUpperCase() === it.sku); const isNew = !p;
    if (isNew) { p = { id: crypto.randomUUID(), sku: it.sku, name: it.sku, cat: 'Sem categoria', supplier: 'Não informado', lead: 7, cost: 0, price: 0, loc: '', stock: zero(), min: zero(), created: Date.now(), updated: Date.now() }; state.products.push(p); created++; }
    const snap = () => JSON.stringify([p.name, p.cat, p.supplier, p.lead, p.cost, p.price, p.stock, p.min]), before = snap();
    ['name', 'cat', 'supplier', 'lead', 'cost', 'price'].forEach(k => { if (it[k] !== undefined && it[k] !== null && it[k] !== '') p[k] = it[k]; });
    // A variação de saldo vinda do ERP vira saída (baixou) ou entrada (subiu): é a base das análises
    if (!isNew) Object.entries(it.stock).forEach(([loc, v]) => { const d = v - (p.stock[loc] || 0); if (d) addLog({ type: d < 0 ? 'out' : 'in', sku: p.sku, qty: Math.abs(d), loc }); });
    Object.assign(p.stock, it.stock); Object.assign(p.min, it.min);
    if (snap() !== before) { p.updated = Date.now(); if (!isNew) changed++; }
  });
  return { changed, created };
}
let syncing = false;

/* ---------- Sincronização automática (silenciosa, a cada ERP.auto ms) ----------
   Roda sozinha, sem botão. Sem sobrepor consultas, com a aba visível,
   e só redesenha a tela quando algum dado mudou. Se falhar, espera mais antes de tentar de novo. */
async function getJSON(url) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ERP.timeout), headers = { Accept: 'application/json' };
  if (ERP.token) headers.Authorization = 'Bearer ' + ERP.token;
  const r = await fetch(url, { signal: ctl.signal, headers }).finally(() => clearTimeout(timer));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
let autoFail = 0, autoOn = false;
async function autoSync() {
  let delay = ERP.auto || 5000, mine = false;
  try {
    if (ERP.auto && me && !syncing && !document.hidden) {
      mine = syncing = true;
      const sig = () => JSON.stringify([state.products.map(p => [p.sku, p.name, p.cost, p.price, p.lead, p.stock, p.min]), state.transf.map(t => [t.id, t.status])]);
      const before = sig();
      const j = await getJSON(ERP.url);
      const items = (Array.isArray(j) ? j : j.itens || j.items || []).map(mapERP).filter(Boolean);
      if (!items.length) throw new Error('Resposta sem itens');
      mergeERP(items);
      if (ERP.urlTransf) { const t = await getJSON(ERP.urlTransf); mergeTransf((Array.isArray(t) ? t : t.itens || t.items || t.transferencias || []).map(mapTransf).filter(Boolean)); }
      state.erp = { status: 'ok', last: Date.now(), msg: `${items.length} itens` }; autoFail = 0; updateSync();
      if (sig() !== before) { save(); render(); }
    }
  } catch {
    autoFail++; updateSync(); delay = Math.min(60000, 5000 * autoFail); // sem resposta: espera 5 s, 10 s... até 60 s
  } finally { if (mine) syncing = false; setTimeout(autoSync, delay); }
}
/* ---------- Transferências entre unidades (SOMENTE CONSULTA, vindas do Object) ----------
   O saldo só entra no destino quando a unidade aceita no Object. Este site não aceita nem cancela. */
const TSTAT = { pend: 'Pendente', ok: 'Aceita', cancel: 'Cancelada' }, TCLS = { pend: 'crit', ok: 'ok', cancel: 'out' };
function seedTransf() {
  const now = Date.now(), mk = (id, items, from, to, status, d, dd, motivo, extra = {}) => ({ id, items: items.map(([sku, qty]) => ({ sku, qty })), from, to, status,
    created: now - d * DAY, decided: dd == null ? null : now - dd * DAY, motivo, solicitante: 'Exemplo', responsavel: status === 'pend' ? '' : 'Exemplo', ...extra });
  return [mk('T-1041', [['7767', 20]], 'matriz', 'aruja', 'pend', 1, null, 'Reposição: abaixo do estoque mínimo'),
    mk('T-1038', [['641', 10], ['8885', 15]], 'matriz', 'sjc', 'pend', 5, null, 'Reforço para obra de cliente', { obs: 'Retirar até sexta-feira' }),
    mk('T-1029', [['3757', 20]], 'matriz', 'taubate', 'pend', 9, null, 'Equilíbrio de estoque entre unidades'),
    mk('T-1033', [['7768', 8]], 'matriz', 'santos', 'ok', 6, 5, 'Reposição: item esgotado na loja'),
    mk('T-1021', [['2563', 12]], 'matriz', 'aruja', 'ok', 12, 11, 'Instalação agendada'),
    mk('T-1009', [['3757', 20]], 'matriz', 'sjc', 'ok', 20, 18, 'Reposição de estoque mínimo'),
    mk('T-1015', [['6804', 6]], 'aruja', 'santos', 'cancel', 15, 14, 'Pedido de cliente', { cancelMotivo: 'Item enviado por engano' }),
    mk('T-1040', [['9256', 2]], 'matriz', 'taubate', 'ok', 3, 2, 'Venda já fechada com cliente')];
}
function tStat(s) { const n = norm(s); return /aceit|receb|conclu|finaliz/.test(n) ? 'ok' : /cancel|recus|rejeit|estorn/.test(n) ? 'cancel' : 'pend'; }
function mapTransf(r) {
  const from = locId(r.origem ?? r.de ?? r.from ?? r.filial_origem), to = locId(r.destino ?? r.para ?? r.to ?? r.filial_destino);
  const num = v => { const x = +v; return Number.isFinite(x) ? x : null; }, txt = v => (v === undefined || v === null || v === '') ? undefined : String(v);
  const raw = r.itens ?? r.items ?? r.produtos, nm = i => i.descricao ?? i.nome ?? i.name ?? i.produto;
  const items = (Array.isArray(raw) ? raw : [r]).map(i => ({ sku: String(i.sku ?? i.codigo ?? i.produto_codigo ?? '').trim().toUpperCase(),
    qty: Math.trunc(num(i.quantidade ?? i.qtd ?? i.qty) ?? 0), name: typeof nm(i) === 'string' ? nm(i) : undefined, cost: num(i.custo ?? i.cost) })).filter(i => i.sku && i.qty > 0);
  if (!from || !to || !items.length) return null;
  const dt = v => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
  return { id: String(r.id ?? r.numero ?? r.transferencia ?? `${items[0].sku}|${from}|${to}|${r.data}`), items, from, to, status: tStat(r.status ?? r.situacao),
    created: dt(r.data ?? r.criado_em ?? r.created) || Date.now(), decided: dt(r.data_aceite ?? r.data_resposta ?? r.atualizado_em),
    motivo: txt(r.motivo ?? r.justificativa ?? r.reason), cancelMotivo: txt(r.motivo_cancelamento ?? r.motivo_recusa), obs: txt(r.observacao ?? r.obs ?? r.observacoes),
    solicitante: txt(r.solicitante ?? r.criado_por ?? r.usuario ?? r.requested_by), responsavel: txt(r.aceito_por ?? r.responsavel ?? r.usuario_aceite ?? r.decidido_por) };
}
function mergeTransf(list) {
  const m = new Map(state.transf.map(t => [t.id, t])); list.forEach(t => m.set(t.id, { ...m.get(t.id), ...t }));
  state.transf = [...m.values()].sort((a, b) => b.created - a.created).slice(0, 1000);
}
const tQty = t => t.items.reduce((s, i) => s + i.qty, 0);
const tName = i => state.products.find(p => p.sku.toUpperCase() === i.sku)?.name || i.name || i.sku;
function renderTransf() {
  const st = $('#fTs').value, q = $('#q').value.trim().toLowerCase(), now = Date.now(), d30 = now - 30 * DAY;
  const base = state.transf.filter(t => (cur === 'all' || t.from === cur || t.to === cur) && (!q || t.items.some(i => i.sku.toLowerCase().includes(q) || tName(i).toLowerCase().includes(q))));
  const pend = base.filter(t => t.status === 'pend'), ok = base.filter(t => t.status === 'ok' && (t.decided || t.created) >= d30), can = base.filter(t => t.status === 'cancel' && (t.decided || t.created) >= d30);
  const un = a => a.reduce((s, t) => s + tQty(t), 0), old = pend.filter(t => now - t.created > 3 * DAY).length;
  $('#tPend').textContent = pend.length; $('#tPendSub').textContent = `${un(pend)} un. aguardando aceite${old ? ` · ${old} há mais de 3 dias` : ''}`;
  $('#tOk').textContent = ok.length; $('#tOkSub').textContent = `${un(ok)} un. recebidas · ${LN(cur)}`;
  $('#tCan').textContent = can.length; $('#tCanSub').textContent = `${un(can)} un. não chegaram ao destino`;
  const list = base.filter(t => !st || t.status === st).slice(0, 200);
  $('#trRows').innerHTML = list.map(t => {
    const age = Math.floor((now - t.created) / DAY), when = t.status === 'pend' ? `aguardando há ${age} d` : `${t.status === 'ok' ? 'aceita' : 'cancelada'} em ${fmtDT(t.decided || t.created)}`;
    const prod = esc(tName(t.items[0])) + (t.items.length > 1 ? ` <span class="sku">+ ${t.items.length - 1} item(ns)</span>` : ` <span class="sku">${esc(t.items[0].sku)}</span>`);
    return `<tr><td>${fmtDT(t.created)}</td><td>${prod}</td><td>${esc(LN(t.from))}</td><td>${esc(LN(t.to))}</td><td class="n">${tQty(t)}</td>
      <td><span class="mot" title="${esc(t.motivo || '')}">${esc(t.motivo || '—')}</span></td>
      <td><span class="badge ${TCLS[t.status]}">${TSTAT[t.status]}</span></td><td><span class="${t.status === 'pend' ? 'cv ' + (age > 7 ? 'out' : age > 3 ? 'crit' : '') : ''}">${when}</span></td>
      <td><button class="btn sm" data-t="${esc(t.id)}">Detalhes</button></td></tr>`; }).join('')
    || '<tr><td colspan="9" style="text-align:center;color:var(--muted)">Nenhuma transferência encontrada.</td></tr>';
  renderTransfExtra();
}
function openTransf(id) {
  const t = state.transf.find(x => x.id === id); if (!t || !(cur === 'all' || t.from === cur || t.to === cur) && !isAdm()) return;
  const now = Date.now(), age = Math.floor((now - t.created) / DAY), dl = (l, v) => `<div><span>${l}</span><b>${esc(v || '—')}</b></div>`;
  const rows = t.items.map(i => { const p = state.products.find(x => x.sku.toUpperCase() === i.sku), cost = p?.cost ?? i.cost ?? null; return { i, p, cost }; });
  const tot = rows.reduce((s, r) => s + (r.cost !== null ? r.cost * r.i.qty : 0), 0);
  const note = t.status === 'pend' ? `Aguardando aceite da unidade de destino há ${age} dia(s). Enquanto estiver pendente, os itens ainda não contam no estoque de ${esc(LN(t.to))}.`
    : t.status === 'ok' ? 'Aceita pela unidade de destino: os itens já entraram no estoque dela.' : 'Cancelada: os itens não entraram no estoque do destino.';
  $('#tBody').innerHTML = `<h3>Transferência ${esc(t.id)} <span class="badge ${TCLS[t.status]}">${TSTAT[t.status]}</span></h3><p class="muted">${note}</p>
    <div class="dl">${dl('Origem', LN(t.from))}${dl('Destino', LN(t.to))}${dl('Criada em', fmtDT(t.created))}${dl(t.status === 'cancel' ? 'Cancelada em' : 'Aceita em', t.decided ? fmtDT(t.decided) : null)}
      ${dl('Solicitante', t.solicitante)}${dl(t.status === 'cancel' ? 'Cancelada por' : 'Aceite por', t.responsavel)}</div>
    <h2 style="margin:.2rem 0 .3rem">Motivo</h2><p style="margin:0 0 .8rem">${esc(t.motivo || 'Não informado no Object.')}</p>
    ${t.cancelMotivo ? `<h2 style="margin:.2rem 0 .3rem">Motivo do cancelamento</h2><p style="margin:0 0 .8rem">${esc(t.cancelMotivo)}</p>` : ''}
    ${t.obs ? `<h2 style="margin:.2rem 0 .3rem">Observação</h2><p style="margin:0 0 .8rem">${esc(t.obs)}</p>` : ''}
    <h2 style="margin:.2rem 0 .4rem">Itens transferidos</h2>
    <div class="wrap"><table class="mini"><thead><tr><th>SKU</th><th>Produto</th><th>Categoria</th><th class="n">Qtd.</th><th class="n">Custo unit.</th><th class="n">Total (custo)</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.i.sku)}</td><td>${esc(r.p?.name || r.i.name || r.i.sku)}</td><td>${esc(r.p?.cat || '—')}</td><td class="n">${r.i.qty}</td><td class="n">${r.cost !== null ? brl(r.cost) : '—'}</td><td class="n">${r.cost !== null ? brl(r.cost * r.i.qty) : '—'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="3"><b>Total</b></td><td class="n"><b>${tQty(t)}</b></td><td></td><td class="n"><b>${brl(tot)}</b></td></tr></tfoot></table></div>`;
  $('#tDlg').showModal();
}

/* ---------- Renderização ---------- */
let flashId = null;
function logRow(l, showName = true) {
  const where = l.type === 'tr' ? `${esc(LN(l.loc))} → ${esc(LN(l.to))}` : esc(LN(l.loc));
  const sign = l.type === 'in' ? '+' : l.type === 'out' ? '−' : l.type === 'adj' ? (l.qty < 0 ? '−' : '+') : '⇄ ';
  const main = l.type === 'erp' ? esc(l.msg) : `${showName ? esc(nameOf(l.sku)) + ' ' : ''}<span class="sku">${esc(l.sku)} · ${where}</span>`;
  return `<li><time>${fmtDT(l.t)}</time><span class="tag ${l.type}">${TAG[l.type]}</span><span>${main}</span><span class="qt">${l.type === 'erp' ? '' : sign + Math.abs(l.qty)}</span></li>`;
}
function render() {
  if (!me) return;
  sgCache = suggestions();
  const adm = isAdm(), P = state.products, units = P.reduce((s, p) => s + qty(p), 0);
  const custo = P.reduce((s, p) => s + qty(p) * p.cost, 0), venda = P.reduce((s, p) => s + qty(p) * p.price, 0);
  const pairs = lowPairs();

  $('#kValorLb').textContent = 'Valor do estoque (custo) · ' + LN(cur);
  $('#kValor').textContent = brl(custo);
  $('#kValorSub').textContent = `Venda: ${brl(venda)} · Margem potencial: ${venda ? pc((venda - custo) / venda * 100) : '0,0%'}`;
  $('#kSkus').textContent = P.length; $('#kUn').textContent = `${units.toLocaleString('pt-BR')} unidades`;
  $('#kAlarm').textContent = pairs.length;

  $('#urgCount').textContent = pairs.length ? `${pairs.length} alerta(s) · ${LN(cur)}` : '';
  $('#feed').innerHTML = pairs.length ? pairs.map(({ p, loc }) => {
    const s = p.stock[loc], m = p.min[loc], tr = inTransit(p.sku, loc), f = Math.max(m * 2 - s - tr, 0);
    return `<li class="${s === 0 ? 'out' : 'crit'}"><div><b>${esc(p.name)}</b><span class="sku">${esc(p.sku)} · ${esc(LN(loc))}</span></div>
      <div class="cov"><i style="width:${Math.min(100, s / m * 100)}%"></i></div>
      <small>${s === 0 ? 'Esgotado' : `${s} un. em estoque`}, mínimo de ${m} · cobertura ${covTxt(p, loc)}</small>
      <small>${f ? `Para o ideal (2× o mínimo) faltam ${f} un.` : 'O ideal (2× o mínimo) já será coberto pelo que está a caminho.'}${tr ? ` ${tr} un. a caminho.` : ''}</small>${sgLine(p, loc)}</li>`; }).join('')
    : '<li class="vazio">Nenhum item abaixo do estoque mínimo.</li>';

  const cats = [...new Set(P.map(p => p.cat))].sort(), c0 = $('#fCat').value;
  $('#fCat').innerHTML = '<option value="">Todas as categorias</option>' + cats.map(c => `<option${c === c0 ? ' selected' : ''}>${esc(c)}</option>`).join('');
  $('#catRows').innerHTML = cats.map(c => { const L = P.filter(p => p.cat === c);
    return `<tr><td>${esc(c)}</td><td class="n">${L.length}</td><td class="n">${L.reduce((s, p) => s + qty(p), 0).toLocaleString('pt-BR')}</td><td class="n">${brl(L.reduce((s, p) => s + qty(p) * p.cost, 0))}</td></tr>`; }).join('')
    || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Sem produtos.</td></tr>';

  const L = state.log.filter(l => cur === 'all' || l.type === 'erp' || l.loc === cur || l.to === cur).slice(0, 30);
  $('#logList').innerHTML = L.map(l => logRow(l)).join('') || '<li class="vazio">Nenhuma movimentação registrada.</li>';

  renderTable(); renderTransf(); renderActivity(); renderAnalises(); renderAlerts(); renderAttn(); renderFavs(); renderSaved(); renderSmartBar();
  if (adm) { renderLoc(); renderMatrix(); renderBuy(); renderSup(); renderUsers(); }
}
function renderLoc() {
  const P = state.products;
  $('#locTiles').innerHTML = LOCS.map(l => {
    const un = P.reduce((s, p) => s + p.stock[l.id], 0), val = P.reduce((s, p) => s + p.stock[l.id] * p.cost, 0),
      al = P.filter(p => alertAt(p, l.id)).length, ex = P.filter(p => p.stock[l.id] === 0).length;
    return `<button class="tile loc${cur === l.id ? ' sel' : ''}" data-loc="${l.id}" title="Ver o estoque desta loja"><span class="lb">${esc(l.nome)}</span><strong>${brl(val)}</strong><small>${un.toLocaleString('pt-BR')} un. · ${al} em alerta · ${ex} esgotado(s)</small></button>`; }).join('');
}
function renderMatrix() {
  $('#mxHead').innerHTML = '<tr><th>SKU</th><th>Produto</th>' + LOCS.map(l => `<th class="n">${esc(l.nome)}</th>`).join('') + '<th class="n">Total</th></tr>';
  const list = state.products.filter(matches);
  $('#mx').innerHTML = list.length ? list.map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td>` +
    LOCS.map(l => `<td class="n cell ${alertAt(p, l.id) ? (p.stock[l.id] === 0 ? 'out' : 'crit') : ''}">${p.stock[l.id]}<small>/${p.min[l.id]}</small></td>`).join('') +
    `<td class="n">${sum(p.stock)}</td></tr>`).join('')
    : `<tr><td colspan="${LOCS.length + 3}" style="text-align:center;color:var(--muted)">Nenhum produto encontrado.</td></tr>`;
}
// % do estoque em relação ao ideal (2x o mínimo)
const nivel = p => { const m = minq(p) * 2, q = qty(p); return m ? Math.min(100, Math.round(q / m * 100)) : (q > 0 ? 100 : 0); };
// Gráfico de tendência: saídas dos últimos 28 dias em 14 faixas de 2 dias.
// DEMO: produto sem saída recebe curva de exemplo (só visual) com vendas de 70%, 50% e 20%. Troque por false para desligar.
const DEMO = true, NIV = [.7, .5, .2], SPK = 14, FORMA = [.35, .55, .5, .8, .6, .45, .58, .48, .88, 1, .22, .72, .38, .3];
const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const nivel3 = p => NIV[state.products.indexOf(p) % 3];
const demoU = p => DEMO && !outs(p.sku, 30, cur) ? Math.round(nivel3(p) * 100 + hash(p.sku) % 9) : 0; // saídas (30 d) de exemplo
function sparkData() {
  const lim = Date.now() - SPK * 2 * DAY, M = {};
  for (const l of state.log) { if (l.t < lim) break; if (l.type === 'out' && (cur === 'all' || l.loc === cur)) (M[l.sku] ||= Array(SPK).fill(0))[Math.min(SPK - 1, (l.t - lim) / (2 * DAY) | 0)] += l.qty; }
  return M;
}
function sparkSvg(a, abs) { // curva suave com área em degradê; abs = altura absoluta (exemplo), senão escala pelo próprio pico
  const mx = abs ? 1 : Math.max(...a, 1), P = a.map((q, i) => [i * 100 / (a.length - 1), 44 - q / mx * 38]);
  const d = 'M' + P[0] + P.slice(1, -1).map((p, i) => `Q${p} ${(p[0] + P[i + 2][0]) / 2},${(p[1] + P[i + 2][1]) / 2}`).join('') + 'L' + P.at(-1);
  return `<svg class="spk" viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label="Saídas dos últimos 28 dias"><path class="a" d="${d}V50H0Z"/><path class="l" d="${d}"/></svg>`;
}
const sparkCell = (p, SD) => SD[p.sku] ? sparkSvg(SD[p.sku])
  : demoU(p) ? sparkSvg(FORMA.map((f, k) => Math.min(1, Math.max(.06, f + (hash(p.sku + k) % 25 - 12) / 100)) * nivel3(p), 1)) : sparkSvg(Array(SPK).fill(0));
function renderTable() {
  const adm = isAdm(), c = $('#fCat').value, st = $('#fSt').value, onlyFav = $('#fFav').checked, showLoc = adm || me.loc === 'matriz';
  const list = state.products.filter(p => matches(p) && (!c || p.cat === c) && (!st || statusOf(p) === st) && (!onlyFav || favs.has(p.sku)));
  const SD = sparkData();
  $('#rows').innerHTML = list.length ? list.map(p => { const s = statusOf(p), tr = inTransit(p.sku), fv = favs.has(p.sku); const n = nivel(p); return `
    <tr data-id="${p.id}" class="lvl" style="--w:${n}%">
      <td>${esc(p.sku)}</td><td>${esc(p.name)}<span class="sub">${showLoc && p.loc ? 'Matriz: ' + esc(p.loc) + ' · ' : ''}${esc(p.supplier)}</span></td><td>${esc(p.cat)}</td>
      <td class="n">${qty(p)}</td><td class="n">${tr ? `<span class="cv crit" title="Transferências pendentes de aceite">+${tr}</span>` : '—'}</td><td class="n">${minq(p)}</td><td class="n">${covTxt(p)}</td><td class="n">${brl(p.cost)}</td><td class="n">${brl(p.price)}</td>
      <td><span class="badge ${s}">${LABEL[s]}</span></td>
      <td class="spk-c">${sparkCell(p, SD)}</td>
      <td><div class="acts">
        <button class="btn sm" data-act="det">Detalhes</button>
        <button class="btn sm fav${fv ? ' on' : ''}" data-act="fav" aria-pressed="${fv}" title="${fv ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">${fv ? '★' : '☆'}</button></div></td>
      <td class="lv"><div class="bar"><i></i></div><b>${n}%</b></td></tr>`; }).join('')
    : '<tr><td colspan="13" style="text-align:center;color:var(--muted)">Nenhum produto encontrado.</td></tr>';
}
function renderUsers() {
  $('#usrRows').innerHTML = USERS.map(u => { const d = auth.users[u.id]?.def;
    return `<tr><td>${esc(u.nome)}</td><td>${u.admin ? 'Líder · vê todas as lojas' : 'Loja · vê somente ' + esc(u.nome)}</td>
      <td><span class="badge ${d ? 'c' : 'ok'}">${d ? 'Senha padrão' : 'Alterada pelo líder'}</span></td>
      <td><button class="btn sm" data-pw="${u.id}">Redefinir senha</button></td></tr>`; }).join('');
}
function renderAnalises() {
  const P = state.products, empty = n => `<tr><td colspan="${n}" style="text-align:center;color:var(--muted)">Sem dados.</td></tr>`;
  $('#anNote').textContent = isAdm() ? `Visão atual: ${LN(cur)} (mude no seletor do topo). A lista de compras sempre considera todos os locais.` : `Análises da loja ${LN(cur)}.`;
  // Produtos que mais saem
  const top = P.map(p => ({ p, u: outs(p.sku, 30, cur) || demoU(p) })).filter(x => x.u > 0).sort((a, b) => b.u - a.u).slice(0, 10);
  $('#topRows').innerHTML = top.map(x => `<tr><td>${esc(x.p.name)} <span class="sku">${esc(x.p.sku)}</span></td><td class="n">${x.u}</td><td class="n">${brl(x.u * x.p.price)}</td><td class="n">${qty(x.p)}</td></tr>`).join('') || empty(4);
  // Cobertura e previsão de ruptura
  const cv = P.map(p => { const R = rate(p, cur), q = qty(p), d = !R.r && demoU(p); if (d) { R.r = d / 30; R.trend = ['up', 'flat', 'down'][NIV.indexOf(nivel3(p))]; } return { p, q, R, c: R.r ? q / R.r : null }; }).filter(x => x.c !== null).sort((x, y) => x.c - y.c).slice(0, 12);
  $('#cvRows').innerHTML = cv.map(x => { const risk = x.c < x.p.lead, att = x.c < x.p.lead * 2, [tt, tc] = TREND[x.R.trend];
    return `<tr><td>${esc(x.p.name)} <span class="sku">${esc(x.p.sku)}</span></td><td class="n">${x.q}</td><td class="n">${dec(x.R.r)}</td><td><span class="cv ${tc}">${tt}</span></td><td class="n">${Math.round(x.c)} d</td><td class="n">${rupTxt(x.q, x.R.r)}</td><td class="n">${x.p.lead} d</td><td><span class="badge ${risk ? 'out' : att ? 'crit' : 'ok'}">${risk ? 'Risco' : att ? 'Atenção' : 'Ok'}</span></td></tr>`; }).join('') || empty(8);
  // Dias em ruptura e venda perdida
  const lost = P.map(p => lostRow(p, cur)).filter(Boolean).sort((a, b) => b.val - a.val);
  $('#lostTot').textContent = lost.length ? `Venda perdida estimada: ${brl(lost.reduce((s, x) => s + x.val, 0))} · margem ${brl(lost.reduce((s, x) => s + x.mg, 0))}` : '';
  $('#lostRows').innerHTML = lost.map(x => `<tr><td>${esc(x.p.name)} <span class="sku">${esc(x.p.sku)}</span></td><td class="n"><span class="cv ${x.d >= 7 ? 'out' : 'crit'}">${x.d} d</span></td><td class="n">${dec(x.r)}</td><td class="n">${Math.round(x.un)}</td><td class="n">${brl(x.val)}</td><td class="n">${brl(x.mg)}</td></tr>`).join('')
    || '<tr><td colspan="6" style="text-align:center;color:var(--cyan)">Nenhum item com vendas ficou sem estoque nos últimos 30 dias.</td></tr>';
  // Estoque parado
  const par = P.map(p => { const q = qty(p), lo = lastOut(p.sku, cur); return { p, q, lo, d: Math.floor((Date.now() - (lo || p.created)) / DAY), cap: q * p.cost }; })
    .filter(x => x.q > 0 && x.d >= PARADO).sort((a, b) => b.cap - a.cap);
  $('#parTot').textContent = par.length ? `Capital parado: ${brl(par.reduce((s, x) => s + x.cap, 0))}` : '';
  $('#parRows').innerHTML = par.map(x => `<tr><td>${esc(x.p.name)} <span class="sku">${esc(x.p.sku)}</span></td><td class="n">${x.q}</td><td class="n">${x.d} d${x.lo ? '' : '*'}</td><td class="n">${brl(x.cap)}</td></tr>`).join('')
    || '<tr><td colspan="4" style="text-align:center;color:var(--cyan)">Nenhum item parado.</td></tr>';
  // Margem e giro (90 dias)
  const sold = P.map(p => { const u = outs(p.sku, 90, cur); return { p, u, rec: u * p.price, cus: u * p.cost, est: qty(p) * p.cost }; }), cat = {};
  sold.forEach(x => { const c = cat[x.p.cat] ||= { rec: 0, cus: 0, est: 0 }; c.rec += x.rec; c.cus += x.cus; c.est += x.est; });
  const T = Object.values(cat).reduce((t, c) => ({ rec: t.rec + c.rec, cus: t.cus + c.cus, est: t.est + c.est }), { rec: 0, cus: 0, est: 0 });
  const mg = (n, c, b) => `<tr><td>${b ? '<b>' + n + '</b>' : esc(n)}</td><td class="n">${brl(c.rec)}</td><td class="n">${brl(c.cus)}</td><td class="n">${brl(c.rec - c.cus)}</td><td class="n">${c.rec ? pc((c.rec - c.cus) / c.rec * 100) : '—'}</td></tr>`;
  const gd = (n, c, b) => { const cd = c.cus / 90; return `<tr><td>${b ? '<b>' + n + '</b>' : esc(n)}</td><td class="n">${brl(c.est)}</td><td class="n">${brl(c.cus)}</td><td class="n">${c.est && c.cus ? dec(c.cus * 365 / 90 / c.est) + '×' : '—'}</td><td class="n">${cd ? Math.round(c.est / cd) + ' d' : 'sem saída'}</td></tr>`; };
  $('#mgRows').innerHTML = Object.entries(cat).sort((a, b) => (b[1].rec - b[1].cus) - (a[1].rec - a[1].cus)).map(([n, c]) => mg(n, c)).join('') || empty(5);
  $('#mgFoot').innerHTML = Object.keys(cat).length ? mg('Total', T, true) : '';
  $('#gdRows').innerHTML = Object.entries(cat).sort((a, b) => (b[1].cus ? b[1].est / b[1].cus : 1e9) - (a[1].cus ? a[1].est / a[1].cus : 1e9)).map(([n, c]) => gd(n, c)).join('') || empty(5);
  $('#gdFoot').innerHTML = Object.keys(cat).length ? gd('Total', T, true) : '';
  const pm = sold.filter(x => x.u > 0).sort((a, b) => (b.rec - b.cus) - (a.rec - a.cus)).slice(0, 10);
  $('#pmRows').innerHTML = pm.map(x => { const m = x.p.price ? (x.p.price - x.p.cost) / x.p.price * 100 : 0;
    return `<tr><td>${esc(x.p.name)} <span class="sku">${esc(x.p.sku)}</span></td><td class="n">${x.u}</td><td class="n"><span class="badge ${m >= 30 ? 'ok' : m >= 15 ? 'crit' : 'out'}">${pc(m)}</span></td><td class="n">${brl(x.rec - x.cus)}</td></tr>`; }).join('') || empty(4);
  // Curva ABC
  const rv = P.map(p => ({ p, v: outs(p.sku, 90, cur) * p.price })).sort((a, b) => b.v - a.v), tot = rv.reduce((s, x) => s + x.v, 0);
  let acc = 0;
  $('#abcRows').innerHTML = rv.map(x => { const before = tot ? acc / tot * 100 : 100; acc += x.v;
    const k = x.v === 0 ? 'c' : before < 80 ? 'a' : before < 95 ? 'b' : 'c';
    return `<tr><td><span class="badge ${k}">${k.toUpperCase()}</span></td><td>${esc(x.p.name)} <span class="sku">${esc(x.p.sku)}</span></td><td class="n">${brl(x.v)}</td><td class="n">${pc(tot ? x.v / tot * 100 : 0)}</td><td class="n">${pc(tot ? acc / tot * 100 : 0)}</td></tr>`; }).join('') || empty(5);
}
function renderBuy() {
  const g = buyList(), sups = Object.keys(g).sort(); let total = 0;
  $('#buy').innerHTML = sups.length ? sups.map(s => {
    const it = g[s].sort((a, b) => a.p.name.localeCompare(b.p.name)), sub = it.reduce((t, x) => t + x.q * x.p.cost, 0); total += sub;
    return `<section class="tile tbl"><div class="toolbar"><h2>${esc(s)}</h2><span class="count">${it.length} item(ns) · prazo até ${Math.max(...it.map(x => x.p.lead))} d · ${brl(sub)}</span></div>
      <div class="wrap"><table class="mini"><thead><tr><th>SKU</th><th>Produto</th><th class="n">Estoque total</th><th class="n">Cobertura</th><th class="n">Qtd. sugerida</th><th class="n">Custo unit.</th><th class="n">Total</th><th>Motivo</th></tr></thead><tbody>
      ${it.map(x => `<tr><td>${esc(x.p.sku)}</td><td>${esc(x.p.name)}</td><td class="n">${x.tot}</td><td class="n">${x.cob === null ? '—' : Math.round(x.cob) + ' d'}</td><td class="n"><b>${x.q}</b></td><td class="n">${brl(x.p.cost)}</td><td class="n">${brl(x.q * x.p.cost)}</td><td><span class="badge ${x.risco ? 'out' : 'crit'}">${x.risco ? 'Cobertura < prazo' : 'No mínimo'}</span></td></tr>`).join('')}
      </tbody></table></div></section>`; }).join('')
    : '<section class="tile tbl"><p class="muted" style="margin:0">Nenhuma compra necessária no momento.</p></section>';
  $('#buyTot').textContent = sups.length ? `Total estimado: ${brl(total)}` : '';
}
function exportCsv() {
  const g = buyList(), rows = [['Fornecedor', 'SKU', 'Produto', 'Qtd. sugerida', 'Custo unit. (R$)', 'Total (R$)', 'Prazo (dias)']];
  Object.keys(g).sort().forEach(s => g[s].forEach(x => rows.push([s, x.p.sku, x.p.name, x.q, x.p.cost.toFixed(2).replace('.', ','), (x.q * x.p.cost).toFixed(2).replace('.', ','), x.p.lead])));
  if (rows.length === 1) return toast('Nenhuma compra sugerida para exportar');
  const txt = '\ufeff' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = 'pedido-compras-bjseg.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Telas novas (somente leitura) ---------- */
const sgLine = (p, loc) => { const L = sgCache.filter(x => x.p === p && x.to === loc); return L.length ? `<small class="sg">Sugestão: retirar ${L.map(x => `${x.q} un. de ${esc(LN(x.from))}`).join(' e ')}</small>` : ''; };
const emptyRow = (n, msg, ok) => `<tr><td colspan="${n}" style="text-align:center;color:var(--${ok ? 'cyan' : 'muted'})">${msg}</td></tr>`;
const prodTxt = t => esc(tName(t.items[0])) + (t.items.length > 1 ? ` <span class="sku">+ ${t.items.length - 1} item(ns)</span>` : ` <span class="sku">${esc(t.items[0].sku)}</span>`);

function renderTransfExtra() {
  const now = Date.now();
  // 1) Pendentes paradas
  const stuck = state.transf.filter(t => t.status === 'pend' && tVisible(t) && now - t.created > ATRASO * DAY).sort((a, b) => a.created - b.created);
  $('#tAttnCount').textContent = stuck.length ? `${stuck.length} parada(s)` : '';
  $('#tAttnRows').innerHTML = stuck.map(t => { const age = Math.floor((now - t.created) / DAY);
    return `<tr><td>${esc(t.id)}</td><td>${prodTxt(t)}</td><td>${esc(LN(t.from))} → ${esc(LN(t.to))}</td><td class="n">${tQty(t)}</td>
      <td class="n"><span class="cv ${age > ATRASO_GRAVE ? 'out' : 'crit'}">${age} d</span></td><td>${esc(t.solicitante || '—')}</td><td><button class="btn sm" data-t="${esc(t.id)}">Detalhes</button></td></tr>`; }).join('')
    || emptyRow(7, `Nenhuma transferência pendente há mais de ${ATRASO} dias.`, true);
  // 2) Sugestões de transferência
  const S = sgCache;
  $('#sgCount').textContent = S.length ? `${S.length} sugestão(ões) · ${LN(cur)}` : '';
  $('#sgRows').innerHTML = S.map(x => `<tr><td>${esc(x.p.name)} <span class="sku">${esc(x.p.sku)}</span></td>
    <td>${esc(LN(x.from))}<span class="sub">${x.p.stock[x.from]} em estoque, mín. ${x.p.min[x.from]} · fica com ${x.p.stock[x.from] - x.dn.given}${x.rd > 0 ? ` (${Math.round((x.p.stock[x.from] - x.dn.given) / x.rd)} d)` : ''}</span></td>
    <td>${esc(LN(x.to))}<span class="sub">${x.p.stock[x.to]} em estoque, mín. ${x.p.min[x.to]}${x.tr ? ` · ${x.tr} a caminho` : ''}</span></td>
    <td class="n"><b>${x.q}</b></td>
    <td>${x.rest > 0 ? `<span class="badge crit">Ainda faltam ${x.rest} un.: avaliar compra</span>` : '<span class="badge ok">Cobre a necessidade</span>'}</td></tr>`).join('')
    || emptyRow(5, 'Nenhuma transferência a sugerir: ninguém no mínimo tem outra unidade com sobra.', true);
  // 3) Fluxo entre unidades (90 dias)
  const F = flowData(90);
  $('#flRows').innerHTML = LOCS.map(l => `<tr><td>${esc(l.nome)}</td><td class="n">${F.env[l.id]}</td><td class="n">${F.rec[l.id]}</td><td class="n">${F.rec[l.id] - F.env[l.id] > 0 ? '+' : ''}${F.rec[l.id] - F.env[l.id]}</td><td class="n">${F.pend[l.id] ? `<span class="cv crit">${F.pend[l.id]}</span>` : '—'}</td></tr>`).join('');
  $('#fmHead').innerHTML = '<tr><th>De ↓ / Para →</th>' + LOCS.map(l => `<th class="n">${esc(l.nome)}</th>`).join('') + '</tr>';
  $('#fmRows').innerHTML = LOCS.map(a => `<tr><td>${esc(a.nome)}</td>${LOCS.map(b => `<td class="n">${F.m[a.id][b.id] || '·'}</td>`).join('')}</tr>`).join('');
}

/* Linha do tempo: tudo o que o Object registrou (movimentações, ajustes e transferências) */
const KIND = { in: ['Entrada', 'in'], out: ['Saída', 'out'], adj: ['Ajuste', 'adj'], erp: ['ERP', 'erp'], tr: ['Transf.', 'tr'], trc: ['Transf. criada', 'tr'], tra: ['Transf. aceita', 'in'], trx: ['Transf. cancelada', 'out'] };
let actLimit = 100;
function activity() {
  const ev = [];
  state.log.forEach(l => ev.push({ t: l.t, kind: l.type, loc: l.loc, to: l.to, sku: l.sku, qty: l.qty, msg: l.msg, user: l.user || '' }));
  state.transf.forEach(t => {
    ev.push({ t: t.created, kind: 'trc', loc: t.from, to: t.to, tr: t, user: t.solicitante || '' });
    if (t.status !== 'pend' && t.decided) ev.push({ t: t.decided, kind: t.status === 'ok' ? 'tra' : 'trx', loc: t.from, to: t.to, tr: t, user: t.responsavel || '' });
  });
  return ev.sort((a, b) => b.t - a.t);
}
function renderActivity() {
  const ty = $('#fAType').value, per = +$('#fAPer').value, q = $('#q').value.trim().toLowerCase(), now = Date.now(), all = activity();
  const users = [...new Set(all.map(e => e.user).filter(Boolean))].sort(), u0 = $('#fAUser').value;
  $('#fAUser').innerHTML = '<option value="">Todos os usuários</option>' + users.map(u => `<option${u === u0 ? ' selected' : ''}>${esc(u)}</option>`).join('');
  const us = $('#fAUser').value;
  const hit = e => !q || (e.tr ? e.tr.items.some(i => i.sku.toLowerCase().includes(q) || tName(i).toLowerCase().includes(q))
    : e.kind === 'erp' ? (e.msg || '').toLowerCase().includes(q) : (e.sku || '').toLowerCase().includes(q) || nameOf(e.sku).toLowerCase().includes(q));
  const L = all.filter(e => (cur === 'all' || e.kind === 'erp' || e.loc === cur || e.to === cur) && (!ty || (ty === 'transf' ? e.kind.startsWith('tr') : e.kind === ty))
    && (!per || e.t >= now - per * DAY) && (!us || e.user === us) && hit(e));
  const row = e => {
    const [lb, cl] = KIND[e.kind] || [e.kind, 'erp']; let main, val = '';
    if (e.tr) { const t = e.tr; main = `${esc(t.id)} · ${prodTxt(t)} <span class="sku">${esc(LN(t.from))} → ${esc(LN(t.to))}</span>`; val = '⇄ ' + tQty(t); }
    else if (e.kind === 'erp') main = esc(e.msg || '');
    else { main = `${esc(nameOf(e.sku))} <span class="sku">${esc(e.sku)} · ${esc(LN(e.loc))}</span>`; val = (e.kind === 'in' || (e.kind === 'adj' && e.qty > 0) ? '+' : '−') + Math.abs(e.qty); }
    return `<li><time>${fmtDT(e.t)}</time><span class="tag ${cl}">${lb}</span><span>${main}${e.user ? ` <span class="sku">· ${esc(e.user)}</span>` : ''}</span><span class="qt">${val}</span></li>`;
  };
  $('#actCount').textContent = `${L.length} atividade(s) · ${LN(cur)}`;
  $('#actList').innerHTML = L.slice(0, actLimit).map(row).join('') || '<li class="vazio">Nenhuma atividade com esses filtros.</li>';
  $('#actMore').hidden = L.length <= actLimit;
}

function renderAlerts() {
  const A = alerts(), f = $('#fAl').value, L = f ? A.filter(a => a.sev === f) : A, c = A.filter(a => a.sev === 'out').length;
  $('#alCount').textContent = A.length ? `${c} crítico(s) · ${A.length - c} atenção` : '';
  $('#alRows').innerHTML = L.map(a => `<tr><td><span class="badge ${a.sev}">${SEV[a.sev]}</span></td><td>${esc(a.tipo)}</td><td class="w">${esc(a.item)}</td><td class="w">${esc(a.txt)}</td></tr>`).join('')
    || emptyRow(4, 'Nenhum alerta com esse filtro. Tudo dentro do esperado.', true);
}
function renderAttn() { // resumo no Painel
  const A = alerts(), c = A.filter(a => a.sev === 'out').length;
  $('#attnCount').textContent = A.length ? `${c} crítico(s) · ${A.length - c} atenção` : '';
  $('#attnList').innerHTML = A.slice(0, 6).map(a => `<li><span class="badge ${a.sev}">${SEV[a.sev]}</span><span>${esc(a.tipo)}: ${esc(a.item)}<span class="sub">${esc(a.txt)}</span></span></li>`).join('')
    + (A.length > 6 ? `<li class="vazio"><a href="#alertas">Ver os ${A.length} alertas</a></li>` : '') || '<li class="vazio">Nada fora do normal.</li>';
}
function renderFavs() {
  const L = state.products.filter(p => favs.has(p.sku));
  $('#favList').innerHTML = L.map(p => { const s = statusOf(p), tr = inTransit(p.sku);
    return `<li><span class="badge ${s}">${LABEL[s]}</span><span>${esc(p.name)}<span class="sub">${esc(p.sku)} · ${qty(p)} un. · cobertura ${covTxt(p)}${tr ? ` · +${tr} a caminho` : ''}</span></span></li>`; }).join('')
    || '<li class="vazio">Marque produtos com ☆ na aba Estoque para acompanhá-los aqui.</li>';
}
function renderSaved() {
  const s = $('#fSaved'), v = s.value;
  s.innerHTML = '<option value="">Filtros salvos…</option>' + saved.map(f => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('');
  s.value = saved.some(f => f.name === v) ? v : ''; $('#fDel').hidden = !s.value;
}
function renderSup() { // fornecedores (só o líder)
  const g = {}, buy = buyList(), tot90 = state.products.reduce((s, p) => s + outs(p.sku, 90, 'all') * p.price, 0);
  state.products.forEach(p => {
    const s = g[p.supplier || 'Não informado'] ||= { n: 0, cap: 0, vend: 0, al: 0, risco: 0, leads: [] }, t = sum(p.stock) + (PEND_SAIU_ORIGEM ? inTransit(p.sku, 'all') : 0), r = rate(p, 'all').r;
    s.n++; s.cap += sum(p.stock) * p.cost; s.vend += outs(p.sku, 90, 'all') * p.price; s.leads.push(p.lead);
    if (LOCS.some(l => alertAt(p, l.id))) s.al++; if (r && t / r < p.lead) s.risco++;
  });
  $('#supRows').innerHTML = Object.entries(g).sort((a, b) => b[1].vend - a[1].vend).map(([n, s]) => { const b = (buy[n] || []).reduce((t, x) => t + x.q * x.p.cost, 0);
    return `<tr><td>${esc(n)}</td><td class="n">${s.n}</td><td class="n">${brl(s.cap)}</td><td class="n">${brl(s.vend)}</td><td class="n">${tot90 ? pc(s.vend / tot90 * 100) : '—'}</td>
      <td class="n">${s.al || '—'}</td><td class="n">${s.risco ? `<span class="cv out">${s.risco}</span>` : '—'}</td><td class="n">${Math.round(s.leads.reduce((a, x) => a + x, 0) / s.leads.length)} d</td><td class="n">${b ? brl(b) : '—'}</td></tr>`; }).join('')
    || emptyRow(9, 'Sem fornecedores.');
}

/* ---------- Validação ---------- */
function validate(form, extra) {
  let ok = true;
  [...form.elements].filter(el => el.name).forEach(el => {
    let m = '';
    if (!el.closest('[hidden]')) {
      if (!el.value.trim()) m = ('opt' in el.dataset) ? '' : 'Campo obrigatório';
      else if (el.type === 'number' && (isNaN(el.value) || +el.value < +(el.min || 0))) m = `O valor mínimo é ${el.min || 0}`;
      else if (el.type === 'number' && el.step === '1' && !Number.isInteger(+el.value)) m = 'Use um número inteiro';
      else if (extra) m = extra(el) || '';
    }
    el.classList.toggle('bad', !!m); el.parentElement.querySelector('.err').textContent = m;
    if (m) ok = false;
  });
  return ok;
}
const clearForm = f => { f.reset(); f.querySelectorAll('.err').forEach(e => e.textContent = ''); f.querySelectorAll('.bad').forEach(e => e.classList.remove('bad')); };

/* ---------- Detalhes do produto ---------- */
function openDetail(p) {
  const adm = isAdm(), sc = adm ? 'all' : me.loc, R = rate(p, sc), t = qty(p, sc), lo = lastOut(p.sku, sc), mg = p.price ? (p.price - p.cost) / p.price * 100 : 0, tr = inTransit(p.sku, sc);
  const hist = state.log.filter(l => l.sku === p.sku && (adm || l.loc === me.loc || l.to === me.loc)).slice(0, 15), [tt] = TREND[R.trend], d30 = ruptura(p, sc, 30);
  const cell = adm || me.loc === 'matriz' ? `<div><span>Local na Matriz</span><b>${esc(p.loc || '—')}</b></div>` : `<div><span>Estoque mínimo</span><b>${p.min[me.loc]} un.</b></div>`;
  $('#hBody').innerHTML = `<h3>${esc(p.name)}</h3><p class="muted">${esc(p.sku)} · ${esc(p.cat)}</p>
    <div class="dl">
      <div><span>Fornecedor · prazo</span><b>${esc(p.supplier)} · ${p.lead} d</b></div>${cell}
      <div><span>Custo / Preço</span><b>${brl(p.cost)} / ${brl(p.price)}</b></div><div><span>Margem</span><b>${pc(mg)}</b></div>
      <div><span>Ritmo previsto</span><b>${dec(R.r)} un./dia · ${tt}</b></div><div><span>Cobertura</span><b>${R.r ? Math.round(t / R.r) + ' dias' : '—'}</b></div>
      <div><span>Ruptura prevista</span><b>${rupTxt(t, R.r)}</b></div><div><span>Dias sem estoque (30 d)</span><b>${d30 ? d30 + ' d' : 'nenhum'}</b></div>
      <div><span>A caminho (pendentes)</span><b>${tr ? '+' + tr + ' un.' : 'nada'}</b></div><div><span>Última saída</span><b>${lo ? fmtDT(lo) : 'nenhuma registrada'}</b></div>
      <div><span>${adm ? 'Estoque total' : 'Estoque atual'}</span><b>${t} un.</b></div></div>
    <table class="mini"><thead><tr><th>Local</th><th class="n">Qtd.</th><th class="n">Mín.</th><th>Status</th></tr></thead><tbody>
    ${LOCS.filter(l => adm || l.id === me.loc).map(l => { const s = statusOf(p, l.id); return `<tr><td>${esc(l.nome)}</td><td class="n">${p.stock[l.id]}</td><td class="n">${p.min[l.id]}</td><td><span class="badge ${s}">${LABEL[s]}</span></td></tr>`; }).join('')}
    </tbody></table>
    <h2 style="margin:1rem 0 .2rem">Histórico recente</h2>
    <ul class="log">${hist.map(l => logRow(l, false)).join('') || '<li class="vazio">Sem movimentações.</li>'}</ul>`;
  $('#hDlg').showModal();
}

/* ---------- Acesso (login por perfil) ----------
   ATENÇÃO: sem servidor, o login protege a interface, mas não é segurança forte —
   os dados ficam no navegador. Para segurança real, hospede os dados/autenticação em um backend. */
let auth = null, fails = 0, lockUntil = 0;
async function sha(s) {
  const txt = 'bjseg|' + s;
  if (globalThis.crypto?.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  let h = 5381; for (const c of txt) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return 'x' + h;
}
const saveAuth = () => { try { localStorage.setItem(AUTHKEY, JSON.stringify(auth)); } catch { toast('Não foi possível salvar os acessos'); } };
async function initAuth() {
  try { auth = JSON.parse(localStorage.getItem(AUTHKEY)); } catch { auth = null; }
  auth ||= { users: {} }; auth.users ||= {};
  for (const u of USERS) if (!auth.users[u.id]) auth.users[u.id] = { h: await sha(u.id + '|' + defPass(u.id)), def: true };
  saveAuth();
}
$('#lForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!auth) return;
  const f = e.target.elements, err = $('#lErr');
  if (Date.now() < lockUntil) { err.textContent = `Muitas tentativas. Aguarde ${Math.ceil((lockUntil - Date.now()) / 1000)} s.`; return; }
  const id = f.user.value;
  if (!f.pass.value || await sha(id + '|' + f.pass.value) !== auth.users[id].h) {
    if (++fails >= 5) { fails = 0; lockUntil = Date.now() + 30000; }
    err.textContent = 'Senha incorreta'; f.pass.value = ''; f.pass.focus(); return;
  }
  fails = 0; err.textContent = ''; f.pass.value = '';
  sessionStorage.setItem(SESSKEY, id); startSession(id);
});
function startSession(id) {
  me = USERS.find(u => u.id === id);
  document.body.classList.remove('locked'); document.body.classList.toggle('loja', !me.admin);
  $('#login').hidden = true;
  const saved = localStorage.getItem(LOCKEY);
  cur = me.admin ? (LOCS.some(l => l.id === saved) ? saved : 'all') : me.loc;
  if (me.admin) { $('#selLoc').innerHTML = `<option value="all">Visão: ${LN('all')}</option>` + LOCS.map(l => `<option value="${l.id}">Visão: ${esc(l.nome)}</option>`).join(''); $('#selLoc').value = cur; }
  $('#who').innerHTML = me.admin ? '<b>Líder</b> · todas as lojas' : `Loja · <b>${esc(me.nome)}</b>`;
  loadPrefs(); render(); route(); updateSync();
  if (!autoOn) { autoOn = true; setTimeout(autoSync, ERP.auto || 5000); }
}
$('#logoutBtn').onclick = () => { sessionStorage.removeItem(SESSKEY); history.replaceState(null, '', location.pathname + location.search); location.reload(); };

let pwTarget = null;
function openPass(id) {
  if (!isAdm()) return; // somente o líder altera senhas
  pwTarget = id; const f = $('#aForm'); clearForm(f);
  $('#aTitle').textContent = id === me.id ? 'Alterar minha senha' : 'Redefinir senha';
  $('#aInfo').textContent = USERS.find(u => u.id === id).nome;
  $('#aDlg').showModal();
}
$('#aForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target.elements;
  if (!isAdm()) return;
  const extra = el => el.name === 'p1' && el.value.length < 6 ? 'Mínimo de 6 caracteres'
    : el.name === 'p2' && f.p2.value !== f.p1.value ? 'As senhas não conferem' : '';
  if (!validate(e.target, extra)) return;
  auth.users[pwTarget] = { h: await sha(pwTarget + '|' + f.p1.value), def: false };
  saveAuth(); $('#aDlg').close(); toast('Senha atualizada'); renderUsers();
});
$('#usrRows').addEventListener('click', e => { const b = e.target.closest('[data-pw]'); if (b) openPass(b.dataset.pw); });

/* ---------- Eventos ---------- */
const setCur = v => { if (!isAdm()) return; cur = v; localStorage.setItem(LOCKEY, cur); $('#selLoc').value = cur; render(); };
$('#selLoc').addEventListener('change', e => setCur(e.target.value));
$('#btnCsv').onclick = () => isAdm() && exportCsv(); $('#btnPrint').onclick = () => window.print();
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
['#fCat', '#fSt'].forEach(s => $(s).addEventListener('input', renderTable)); $('#fFav').addEventListener('change', renderTable);
$('#fTs').addEventListener('input', renderTransf);
document.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) openTransf(b.dataset.t); });
['#fAType', '#fAUser', '#fAPer'].forEach(s => $(s).addEventListener('input', () => { actLimit = 100; renderActivity(); }));
$('#actMore').onclick = () => { actLimit += 100; renderActivity(); };
$('#fAl').addEventListener('input', renderAlerts);
$('#q').addEventListener('input', () => { if (!['estoque', 'lojas', 'transferencias', 'atividades'].includes(curView())) location.hash = '#estoque'; actLimit = 100; renderTable(); renderTransf(); renderActivity(); if (isAdm()) renderMatrix(); });
document.addEventListener('keydown', e => { if (me && e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); } });

$('#rows').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const p = state.products.find(x => x.id === b.closest('tr').dataset.id); if (!p) return;
  if (b.dataset.act === 'det') openDetail(p);
  else if (b.dataset.act === 'fav') { favs.has(p.sku) ? favs.delete(p.sku) : favs.add(p.sku); saveFavs(); renderTable(); renderFavs(); }
});
$('#locTiles').addEventListener('click', e => { const b = e.target.closest('[data-loc]'); if (!b) return; setCur(b.dataset.loc); location.hash = '#estoque'; });

// Navegação por abas (hash) e menu lateral
const curView = () => { const h = location.hash.slice(1); return (isAdm() ? VIEWS : VIEWS_LOJA).includes(h) ? h : 'painel'; };
function route() {
  if (!me) return;
  const v = curView();
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.dataset.v === v));
  document.querySelectorAll('.side a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + v));
  document.body.classList.remove('nav-open'); window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
const mobile = () => matchMedia('(max-width:800px)').matches;
const toggleNav = () => {
  if (mobile()) document.body.classList.toggle('nav-open');
  else { document.body.classList.toggle('nav-collapsed'); localStorage.setItem(NAVKEY, document.body.classList.contains('nav-collapsed') ? '1' : '0'); }
};
$('#navToggle').onclick = toggleNav; $('#menuBtn').onclick = toggleNav;
document.addEventListener('click', e => { if (mobile() && !e.target.closest('.side, #menuBtn')) document.body.classList.remove('nav-open'); });

/* ---------- Favoritos e filtros salvos (por usuário, só neste navegador) ---------- */
let favs = new Set(), saved = [];
const favKey = () => FAVKEY + me.id, filKey = () => FILKEY + me.id;
function loadPrefs() {
  try { favs = new Set(JSON.parse(localStorage.getItem(favKey())) || []); } catch { favs = new Set(); }
  try { saved = JSON.parse(localStorage.getItem(filKey())) || []; } catch { saved = []; }
  try { sgDismissed = new Set(JSON.parse(localStorage.getItem(SGKEY + me.id)) || []); } catch { sgDismissed = new Set(); }
}
const saveFavs = () => { try { localStorage.setItem(favKey(), JSON.stringify([...favs])); } catch { toast('Não foi possível salvar os favoritos'); } };
const saveSaved = () => { try { localStorage.setItem(filKey(), JSON.stringify(saved)); } catch { toast('Não foi possível salvar o filtro'); } };
function applyFilter(f) {
  $('#q').value = f.q || ''; $('#fFav').checked = !!f.fav; $('#fCat').value = f.cat || ''; $('#fSt').value = f.st || '';
  if (curView() !== 'estoque') location.hash = '#estoque';
  renderTable();
}
$('#fSaved').addEventListener('change', e => { const f = saved.find(x => x.name === e.target.value); if (f) applyFilter(f); $('#fDel').hidden = !f; });
$('#fSave').onclick = () => {
  const name = (prompt('Nome do filtro (ex.: CFTV crítico):') || '').trim().slice(0, 30); if (!name) return;
  saved = saved.filter(x => x.name !== name).concat({ name, q: $('#q').value.trim(), cat: $('#fCat').value, st: $('#fSt').value, fav: $('#fFav').checked });
  saveSaved(); renderSaved(); $('#fSaved').value = name; $('#fDel').hidden = false; toast('Filtro salvo');
};
$('#fDel').onclick = () => {
  const n = $('#fSaved').value; if (!n || !confirm(`Excluir o filtro "${n}"?`)) return;
  saved = saved.filter(x => x.name !== n); saveSaved(); renderSaved(); toast('Filtro excluído');
};

/* ---------- Aviso automático de reposição entre unidades ----------
   Sobe sozinho quando aparece uma sugestão nova. "Dispensar" esconde as atuais; uma sugestão nova faz o aviso voltar. */
let sgDismissed = new Set(), sgSeen = null;
const sgKey = x => `${x.p.sku}|${x.from}|${x.to}`;
function renderSmartBar() {
  const bar = $('#smartBar'), keys = sgCache.map(sgKey), fresh = sgCache.filter(x => !sgDismissed.has(sgKey(x)));
  if (sgSeen && keys.some(k => !sgSeen.has(k) && !sgDismissed.has(k))) toast('Novo aviso: sugestão de transferência entre unidades');
  sgSeen = new Set(keys); bar.hidden = !fresh.length; if (!fresh.length) return;
  $('#smartTitle').textContent = `${fresh.length} sugestão(ões) de transferência para equilibrar o estoque`;
  $('#smartList').innerHTML = fresh.slice(0, 3).map(x => `<li>${esc(x.p.name)} (${esc(x.p.sku)}): ${x.q} un. de ${esc(LN(x.from))} → ${esc(LN(x.to))}${x.rest > 0 ? `, ainda faltam ${x.rest}` : ''}</li>`).join('')
    + (fresh.length > 3 ? `<li>e mais ${fresh.length - 3}</li>` : '');
}
$('#smartX').onclick = () => {
  sgDismissed = new Set(sgCache.map(sgKey)); try { localStorage.setItem(SGKEY + me.id, JSON.stringify([...sgDismissed])); } catch { /* vale só nesta sessão */ }
  renderSmartBar();
};

/* ---------- Indicador de leitura do Object ---------- */
function updateSync() {
  const el = $('#syncInfo'); if (!el) return; const l = state.erp.last; let st, txt;
  if (!l) { st = 'warn'; txt = autoFail ? 'Object sem resposta · dados de exemplo' : 'Aguardando o Object · dados de exemplo'; }
  else { const m = (Date.now() - l) / 6e4; st = autoFail || m > STALE_MIN ? 'bad' : m > 10 ? 'warn' : 'ok'; txt = autoFail ? `Sem resposta do Object · última leitura há ${ago(l)}` : `Object · atualizado há ${ago(l)}`; }
  el.dataset.st = st; el.title = l ? 'Última leitura: ' + new Date(l).toLocaleString('pt-BR') : 'Nenhuma leitura do Object ainda';
  el.innerHTML = `<i class="dot"></i><span>${esc(txt)}</span>`;
}
setInterval(() => { if (me) updateSync(); }, 30000);

/* ---------- Tema claro/escuro ---------- */
const isLight = () => document.documentElement.dataset.theme === 'light';
function paintTheme() { const b = $('#themeBtn'); b.title = isLight() ? 'Mudar para o tema escuro' : 'Mudar para o tema claro'; b.setAttribute('aria-label', b.title); }
$('#themeBtn').onclick = () => {
  const t = isLight() ? 'dark' : 'light'; document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEMEKEY, t); } catch { /* sem armazenamento: vale só nesta sessão */ } paintTheme();
};
paintTheme();

/* ---------- Importação manual (CSV ou JSON exportado do Object) ----------
   Nada é gravado antes da confirmação: o arquivo é lido, comparado com o que já está aqui e mostrado como "o que vai mudar". */
function parseCSV(txt) {
  txt = txt.replace(/^\ufeff/, ''); const head = txt.split(/\r?\n/, 1)[0], d = (head.match(/;/g) || []).length >= (head.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], f = '', q = false;
  const endRow = () => { row.push(f); f = ''; if (row.some(x => x.trim())) rows.push(row); row = []; };
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; endRow(); }
    else f += c;
  }
  endRow(); return rows;
}
function csvRecords(rows) {
  if (rows.length < 2) return [];
  const H = rows[0].map(h => norm(h).replace(/[^a-z0-9]+/g, ' ').trim()), col = (...n) => H.findIndex(h => n.includes(h));
  const num = v => { let s = String(v ?? '').replace(/[R$\s]/g, ''); if (!s) return undefined; if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return Number.isFinite(+s) ? +s : undefined; };
  const cSku = col('sku', 'codigo', 'cod', 'codigo produto', 'cod produto'), cName = col('produto', 'descricao', 'nome', 'name'), cCat = col('categoria', 'grupo', 'cat'),
    cSup = col('fornecedor', 'supplier'), cLead = col('prazo', 'prazo dias', 'prazo de entrega', 'lead'), cCost = col('custo', 'preco custo', 'preco de custo', 'cost'),
    cPrice = col('preco', 'preco venda', 'preco de venda', 'price'), cLoc = col('filial', 'loja', 'local', 'deposito', 'unidade'), cBal = col('saldo', 'estoque', 'quantidade', 'qtd', 'qtde'), cMin = col('minimo', 'estoque minimo', 'min');
  if (cSku < 0) return [];
  // Formato largo: uma coluna por unidade ("Arujá") e, se houver, "Mín Arujá"
  const wide = {};
  H.forEach((h, i) => { const m = h.match(/^(?:estoque minimo|minimo|min)\s+(.+)$/), id = locId(m ? m[1] : h); if (id && (m || (i !== cLoc && i !== cBal))) (wide[id] ||= {})[m ? 'm' : 's'] = i; });
  const map = new Map();
  rows.slice(1).forEach(r => {
    const sku = String(r[cSku] ?? '').trim(); if (!sku) return;
    const o = map.get(sku) || { sku, saldos: [] }; map.set(sku, o);
    const put = (k, ci, fn) => { if (ci >= 0 && String(r[ci] ?? '').trim() !== '') o[k] = fn(r[ci]); }, txt = v => String(v).trim();
    put('descricao', cName, txt); put('categoria', cCat, txt); put('fornecedor', cSup, txt); put('prazo', cLead, num); put('custo', cCost, num); put('preco', cPrice, num);
    if (cLoc >= 0 && cBal >= 0) o.saldos.push({ filial: r[cLoc], saldo: num(r[cBal]), minimo: cMin >= 0 ? num(r[cMin]) : undefined });
    Object.entries(wide).forEach(([id, w]) => o.saldos.push({ filial: id, saldo: w.s !== undefined ? num(r[w.s]) : undefined, minimo: w.m !== undefined ? num(r[w.m]) : undefined }));
    if (cLoc < 0 && !Object.keys(wide).length && cBal >= 0) { o.saldo = num(r[cBal]); if (cMin >= 0) o.minimo = num(r[cMin]); }
  });
  return [...map.values()].map(o => { if (!o.saldos.length) delete o.saldos; return o; });
}
const FLD = { name: 'Nome', cat: 'Categoria', supplier: 'Fornecedor', lead: 'Prazo (dias)', cost: 'Custo', price: 'Preço de venda' };
function diffERP(items) { // compara o arquivo com o que já existe, sem alterar nada
  const d = { novos: [], alter: [], iguais: 0 };
  items.forEach(it => {
    const p = state.products.find(x => x.sku.toUpperCase() === it.sku); if (!p) { d.novos.push(it); return; }
    const ch = [];
    Object.keys(FLD).forEach(k => { if (it[k] !== undefined && it[k] !== null && it[k] !== '' && it[k] !== p[k]) ch.push({ lb: FLD[k], de: p[k], para: it[k], money: k === 'cost' || k === 'price' }); });
    Object.entries(it.stock).forEach(([l, v]) => { if (v !== p.stock[l]) ch.push({ lb: 'Saldo · ' + LN(l), de: p.stock[l], para: v }); });
    Object.entries(it.min).forEach(([l, v]) => { if (v !== p.min[l]) ch.push({ lb: 'Mínimo · ' + LN(l), de: p.min[l], para: v }); });
    ch.length ? d.alter.push({ p, ch }) : d.iguais++;
  });
  return d;
}
let impItems = null, impName = '', impDiff = null;
function openImport() {
  if (!isAdm()) return; impItems = null; $('#iFile').value = ''; $('#iApply').disabled = true;
  const li = state.imports[0];
  $('#iBody').innerHTML = li ? `<p class="muted">Última importação: ${fmtDT(li.t)} · ${esc(li.file)} · ${li.novos} novo(s), ${li.alt} alterado(s).</p>` : '';
  $('#iDlg').showModal();
}
async function readImport(file) {
  const out = $('#iBody'), fail = m => { impItems = null; $('#iApply').disabled = true; out.innerHTML = `<p class="err" style="margin:.5rem 0">${esc(m)}</p>`; };
  if (file.size > 5e6) return fail('Arquivo grande demais (máximo de 5 MB).');
  let raw;
  try {
    const txt = (await file.text()).replace(/^\ufeff/, ''), t = txt.trim();
    raw = /^[\[{]/.test(t) ? (j => Array.isArray(j) ? j : j.itens || j.items || [])(JSON.parse(t)) : csvRecords(parseCSV(txt));
  } catch { return fail('Não foi possível ler o arquivo. Use um CSV (separado por ; ou ,) ou um JSON exportado do Object.'); }
  const uniq = new Map(); raw.map(mapERP).filter(Boolean).forEach(it => uniq.set(it.sku, it));
  const items = [...uniq.values()], ignored = raw.length - items.length;
  if (!items.length) return fail('Nenhum item válido. O arquivo precisa ter uma coluna "SKU" (ou "Código") preenchida.');
  const d = diffERP(items), fora = state.products.filter(p => !uniq.has(p.sku.toUpperCase())).length, val = (c, v) => c.money ? brl(+v) : esc(String(v));
  impItems = items; impName = file.name; impDiff = d;
  const rows = d.alter.flatMap(a => a.ch.map(c => ({ a, c }))), more = rows.length - 40;
  out.innerHTML = `<div class="dl"><div><span>Itens no arquivo</span><b>${items.length}</b></div><div><span>Novos</span><b>${d.novos.length}</b></div>
    <div><span>Com alterações</span><b>${d.alter.length}</b></div><div><span>Sem alterações</span><b>${d.iguais}</b></div></div>
    <p class="muted">${ignored ? `${ignored} linha(s) sem SKU foram ignoradas. ` : ''}${fora ? `${fora} produto(s) do sistema não vieram no arquivo e continuam como estão. ` : ''}Diferenças de saldo entram no histórico como entrada ou saída.</p>
    ${d.novos.length ? `<p class="muted" style="margin:0 0 .6rem"><b>Novos:</b> ${d.novos.slice(0, 8).map(n => esc(n.sku)).join(', ')}${d.novos.length > 8 ? ` e mais ${d.novos.length - 8}` : ''}</p>` : ''}
    ${rows.length ? `<div class="wrap"><table class="mini"><thead><tr><th>Produto</th><th>Campo</th><th class="n">Hoje</th><th class="n">No arquivo</th></tr></thead><tbody>
    ${rows.slice(0, 40).map(({ a, c }) => `<tr><td>${esc(a.p.name)} <span class="sku">${esc(a.p.sku)}</span></td><td>${esc(c.lb)}</td><td class="n">${val(c, c.de)}</td><td class="n"><b>${val(c, c.para)}</b></td></tr>`).join('')}
    </tbody></table></div>${more > 0 ? `<p class="muted" style="margin:.5rem 0 0">+ ${more} alteração(ões) não listadas.</p>` : ''}` : ''}`;
  $('#iApply').disabled = !(d.novos.length || d.alter.length);
  if ($('#iApply').disabled) out.insertAdjacentHTML('beforeend', '<p class="muted">O arquivo não muda nada: os números já estão iguais.</p>');
}
$('#impBtn').onclick = openImport;
$('#iFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) readImport(f); });
$('#iApply').onclick = () => {
  if (!isAdm() || !impItems) return;
  const r = mergeERP(impItems), n = impDiff.novos.length, a = impDiff.alter.length;
  state.erp = { status: 'ok', last: Date.now(), msg: `Importação: ${impItems.length} itens` };
  state.imports.unshift({ t: Date.now(), file: impName, novos: n, alt: a }); state.imports.length = Math.min(state.imports.length, 10);
  addLog({ type: 'erp', msg: `Importação de ${impName}: ${n} novo(s), ${a} alterado(s)` });
  impItems = null; save(); render(); updateSync(); $('#iDlg').close(); toast(`Importado: ${n} novo(s), ${r.changed} atualizado(s)`);
};

/* ---------- Resumo do dia (texto para copiar, WhatsApp, .txt ou impressão) ---------- */
function summaryText() {
  const P = state.products, adm = isAdm(), now = new Date(), d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const custo = P.reduce((s, p) => s + qty(p) * p.cost, 0), units = P.reduce((s, p) => s + qty(p), 0), pairs = lowPairs(), A = alerts(), L = [];
  let sa = 0, en = 0; state.log.forEach(l => { if (l.t >= d0 && (cur === 'all' || l.loc === cur)) { if (l.type === 'out') sa += l.qty; else if (l.type === 'in') en += l.qty; } });
  const pend = state.transf.filter(t => t.status === 'pend' && tVisible(t)), stuck = pend.filter(t => now - t.created > ATRASO * DAY);
  L.push(`*BJSEG · Resumo do estoque*`, `${now.toLocaleDateString('pt-BR')} · ${LN(cur)}`, state.erp.last ? `Object atualizado há ${ago(state.erp.last)}` : 'Dados de exemplo (sem leitura do Object)', '',
    '*Números*', `• Valor do estoque (custo): ${brl(custo)}`, `• ${P.length} SKUs · ${units.toLocaleString('pt-BR')} unidades`, `• Alarmes de estoque baixo: ${pairs.length}`, '');
  if (pairs.length) { L.push('*Reposição urgente*'); pairs.slice(0, 5).forEach(({ p, loc }) => L.push(`• ${p.name} (${p.sku}) — ${LN(loc)}: ${p.stock[loc]} un., mín. ${p.min[loc]}`)); if (pairs.length > 5) L.push(`• e mais ${pairs.length - 5}`); L.push(''); }
  L.push('*Transferências*', `• ${pend.length} pendente(s) de aceite${stuck.length ? ` · ${stuck.length} há mais de ${ATRASO} dias` : ''}`, ...(sgCache.length ? [`• ${sgCache.length} sugestão(ões) de transferência entre unidades`] : []), '', '*Hoje*', `• Saídas: ${sa} un. · Entradas: ${en} un.`, '');
  if (A.length) { L.push(`*Pontos de atenção* (${A.filter(a => a.sev === 'out').length} crítico(s), ${A.filter(a => a.sev === 'crit').length} atenção)`); A.slice(0, 3).forEach(a => L.push(`• ${a.tipo}: ${a.item}`)); L.push(''); }
  if (adm) { const g = buyList(), n = Object.values(g).reduce((s, a) => s + a.length, 0), tot = Object.values(g).flat().reduce((s, x) => s + x.q * x.p.cost, 0);
    L.push('*Compras sugeridas*', n ? `• ${n} item(ns) em ${Object.keys(g).length} fornecedor(es) · ${brl(tot)}` : '• Nenhuma compra necessária'); }
  return L.join('\n').trim();
}
$('#sumBtn').onclick = () => { $('#sText').textContent = summaryText(); $('#sDlg').showModal(); };
$('#sCopy').onclick = async () => {
  const t = $('#sText').textContent;
  try { await navigator.clipboard.writeText(t); }
  catch { const a = document.createElement('textarea'); a.value = t; document.body.append(a); a.select(); try { document.execCommand('copy'); } catch { /* sem permissão */ } a.remove(); }
  toast('Resumo copiado');
};
$('#sWa').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent($('#sText').textContent), '_blank', 'noopener');
$('#sTxt').onclick = () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([$('#sText').textContent.replace(/\*/g, '')], { type: 'text/plain;charset=utf-8' }));
  a.download = `resumo-bjseg-${new Date().toISOString().slice(0, 10)}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#sPrint').onclick = () => { document.body.classList.add('print-sum'); window.print(); };
addEventListener('afterprint', () => document.body.classList.remove('print-sum'));

/* ---------- Início ---------- */
if (localStorage.getItem(NAVKEY) === '1') document.body.classList.add('nav-collapsed');
document.body.classList.add('locked'); $('#login').hidden = false;
$('#lUser').innerHTML = USERS.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('');
(async () => {
  await initAuth();
  const s = sessionStorage.getItem(SESSKEY);
  if (s && auth.users[s]) startSession(s); else $('#lForm').elements.pass.focus();
})();

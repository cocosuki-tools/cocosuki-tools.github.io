const ToolEngine = (() => {
const TYPES = ['calculator', 'simulator', 'checklist', 'diagnosis', 'planner', 'guide'];
const FORMATS = ['won', 'percent', 'number', 'decimal'];
const FUNCS = {
min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
round: (x, d) => { const p = Math.pow(10, d || 0); return Math.round(x * p) / p; },
ceil: x => Math.ceil(x), floor: x => Math.floor(x), abs: x => Math.abs(x),
roundup: (x, step) => Math.ceil(x / (step || 1)) * (step || 1),
if: (c, a, b) => (c ? a : b)
};
function tokenize(src) {
const s = String(src == null ? '' : src); const out = []; let i = 0;
while (i < s.length) {
const c = s[i];
if (/\s/.test(c)) { i++; continue; }
if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; const v = Number(s.slice(i, j)); if (!isFinite(v)) throw new Error('숫자 형식 오류: ' + s.slice(i, j)); out.push({ t: 'num', v }); i = j; continue; }
if (/[A-Za-z_]/.test(c)) { let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++; out.push({ t: 'id', v: s.slice(i, j) }); i = j; continue; }
const two = s.slice(i, i + 2);
if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
if ('+-*/%()<>!,'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
throw new Error('수식에 쓸 수 없는 글자: ' + c);
}
return out;
}
function compile(src) {
const toks = tokenize(src); let p = 0; const ids = new Set();
const peek = v => toks[p] && toks[p].t === 'op' && toks[p].v === v;
const eat = v => { if (!peek(v)) throw new Error('"' + v + '"가 필요해요'); p++; };
function primary() {
const tk = toks[p];
if (!tk) throw new Error('수식이 중간에 끝났어요');
if (tk.t === 'num') { p++; return () => tk.v; }
if (tk.t === 'op' && tk.v === '(') { p++; const e = or(); eat(')'); return e; }
if (tk.t === 'op' && tk.v === '-') { p++; const e = unary(); return v => -e(v); }
if (tk.t === 'id') {
p++;
if (tk.v === 'true') return () => 1;
if (tk.v === 'false') return () => 0;
if (peek('(')) {
const fn = FUNCS[tk.v]; if (!fn) throw new Error('모르는 함수: ' + tk.v);
p++; const args = [];
if (!peek(')')) { args.push(or()); while (peek(',')) { p++; args.push(or()); } }
eat(')');
return v => fn(...args.map(a => a(v)));
}
ids.add(tk.v);
return v => { if (!(tk.v in v)) throw new Error('없는 값: ' + tk.v); return Number(v[tk.v]); };
}
throw new Error('잘못된 위치의 기호: ' + tk.v);
}
function unary() { if (peek('!')) { p++; const e = unary(); return v => (e(v) ? 0 : 1); } return primary(); }
function bin(next, ops) {
return () => {
let l = next();
while (toks[p] && toks[p].t === 'op' && ops.includes(toks[p].v)) {
const op = toks[p].v; p++; const r = next(); const L = l;
l = v => { const a = L(v), b = r(v);
switch (op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b;
case '>': return a > b ? 1 : 0; case '<': return a < b ? 1 : 0; case '>=': return a >= b ? 1 : 0; case '<=': return a <= b ? 1 : 0;
case '==': return a === b ? 1 : 0; case '!=': return a !== b ? 1 : 0; case '&&': return a && b ? 1 : 0; case '||': return a || b ? 1 : 0; } };
}
return l;
};
}
const mul = bin(unary, ['*', '/', '%']), add = bin(mul, ['+', '-']), cmp = bin(add, ['>', '<', '>=', '<=']), eq = bin(cmp, ['==', '!=']), and = bin(eq, ['&&']), or = bin(and, ['||']);
const fn = or();
if (p < toks.length) throw new Error('수식 끝에 남는 글자가 있어요: ' + toks[p].v);
return { fn, ids };
}
const evaluate = (src, vars) => compile(src).fn(vars);
function tableCompute(table, inputVals, rows) {
const cols = table.columns || [];
const out = rows.map(r => {
const v = Object.assign({}, inputVals);
cols.filter(c => c.input).forEach(c => { v[c.id] = Number(r.values && r.values[c.id]) || 0; });
cols.filter(c => !c.input).forEach(c => { v[c.id] = evaluate(c.formula, v); });
if (table.flag && table.flag.when) v.__flag = evaluate(table.flag.when, v);
return v;
});
const agg = Object.assign({}, inputVals, { rows: out.length });
cols.forEach(c => {
const xs = out.map(o => o[c.id]).filter(x => isFinite(x));
agg['sum_' + c.id] = xs.reduce((a, b) => a + b, 0);
agg['avg_' + c.id] = xs.length ? agg['sum_' + c.id] / xs.length : 0;
agg['max_' + c.id] = xs.length ? Math.max(...xs) : 0;
agg['min_' + c.id] = xs.length ? Math.min(...xs) : 0;
});
agg.flagged = out.filter(o => o.__flag).length;
return { rows: out, agg };
}
function computeForm(spec, inputVals) {
const v = Object.assign({}, inputVals);
let table = null;
if (spec.table) { table = tableCompute(spec.table, v, spec.table.rows || []); Object.assign(v, table.agg); }
(spec.table && spec.table.totals || []).forEach(t => { if (t.id) v[t.id] = evaluate(t.formula, v); });
(spec.outputs || []).forEach(o => { if (o.id) v[o.id] = evaluate(o.formula, v); });
return { vars: v, table };
}
function validate(raw) {
const errors = [];
const spec = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw || {}));
const str = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const idOk = x => typeof x === 'string' && /^[a-z][a-z0-9_]{0,23}$/.test(x);
const RESERVED = new Set(['rows', 'flagged', 'true', 'false'].concat(Object.keys(FUNCS)));
if (!TYPES.includes(spec.toolType)) errors.push('toolType이 올바르지 않아요');
if (!str(spec.title, 30)) errors.push('title은 1~30자');
if (!str(spec.lead, 120)) errors.push('lead는 1~120자');
if (spec.howTo != null && !str(spec.howTo, 120)) errors.push('howTo는 120자 이내');
if (spec.note != null && spec.note !== '' && !str(spec.note, 200)) errors.push('note는 200자 이내');
const T = spec.toolType;
const checkFormula = (f, where, vars) => {
try { const r = evaluate(f, vars); if (typeof r !== 'number' || !isFinite(r)) errors.push(where + ': 기본값으로 계산하면 숫자가 안 나와요 (' + f + ')'); return r; }
catch (e) { errors.push(where + ': ' + e.message + ' (' + f + ')'); return NaN; }
};
if (T === 'calculator' || T === 'simulator' || T === 'planner') {
const inputs = Array.isArray(spec.inputs) ? spec.inputs : [];
spec.inputs = inputs;
if (T !== 'planner' && !spec.table && inputs.length < 2) errors.push('입력칸(inputs)이 2개 이상 필요해요 (표가 있으면 0개도 됨)');
if (inputs.length > 8) errors.push('입력칸은 8개 이하');
const seen = new Set(); const vars = {};
inputs.forEach((f, i) => {
if (!idOk(f.id) || RESERVED.has(f.id)) errors.push('inputs[' + i + '].id 형식 오류');
if (seen.has(f.id)) errors.push('inputs id 중복: ' + f.id); seen.add(f.id);
if (!str(f.label, 24)) errors.push('inputs[' + i + '].label은 1~24자');
if (typeof f.default !== 'number' || !isFinite(f.default)) errors.push('inputs[' + i + '].default는 숫자');
if (f.slider) { if (!(typeof f.min === 'number' && typeof f.max === 'number' && f.max > f.min)) errors.push('inputs[' + i + '] 슬라이더는 min<max 필요'); }
vars[f.id] = f.default;
});
if (T === 'simulator' && !inputs.some(f => f.slider)) errors.push('시뮬레이터는 슬라이더 입력이 1개 이상 필요해요');
if (T === 'planner' && !spec.table) errors.push('배치표(planner)는 table이 필요해요');
if (spec.table) {
const tbStart = errors.length;
const tb = spec.table; const cols = Array.isArray(tb.columns) ? tb.columns : []; const rows = Array.isArray(tb.rows) ? tb.rows : [];
if (!str(tb.rowLabel, 12)) errors.push('table.rowLabel은 1~12자');
if (cols.length < 2 || cols.length > 8) errors.push('table.columns는 2~8개');
if (rows.length < 2 || rows.length > 12) errors.push('table.rows는 2~12개');
const rowVars = Object.assign({}, vars);
cols.forEach((c, i) => {
if (!idOk(c.id) || RESERVED.has(c.id) || seen.has(c.id)) errors.push('table.columns[' + i + '].id 형식 오류/중복'); seen.add(c.id);
if (!str(c.label, 14)) errors.push('table.columns[' + i + '].label은 1~14자');
if (!c.input && !FORMATS.includes(c.format)) errors.push('table.columns[' + i + '].format 오류');
if (c.input) rowVars[c.id] = 1;
});
rows.forEach((r, i) => { if (!str(r.label, 16)) errors.push('table.rows[' + i + '].label은 1~16자'); cols.filter(c => c.input).forEach(c => { if (typeof (r.values || {})[c.id] !== 'number') errors.push('table.rows[' + i + '].values.' + c.id + ' 숫자 필요'); }); });
cols.filter(c => !c.input).forEach((c, i) => { checkFormula(c.formula, 'table 열 ' + c.label, rowVars); rowVars[c.id] = 1; });
if (tb.flag) { if (!str(tb.flag.text, 20)) errors.push('table.flag.text는 1~20자'); checkFormula(tb.flag.when, 'table.flag', rowVars); }
if (errors.length === tbStart) {
try {
const res = tableCompute(tb, vars, rows); Object.assign(vars, res.agg);
res.rows.forEach((o, i) => cols.filter(c => !c.input).forEach(c => { if (!isFinite(o[c.id])) errors.push('표 ' + (i + 1) + '행 ' + c.label + ' 계산값이 숫자가 아니에요'); }));
} catch (e) { errors.push('표 계산 오류: ' + e.message); }
}
(tb.totals || []).forEach((t, i) => {
if (!str(t.label, 24)) errors.push('table.totals[' + i + '].label은 1~24자');
if (!FORMATS.includes(t.format)) errors.push('table.totals[' + i + '].format 오류');
if (t.id && (!idOk(t.id) || seen.has(t.id))) errors.push('table.totals[' + i + '].id 형식 오류'); if (t.id) seen.add(t.id);
const r = checkFormula(t.formula, '합계 ' + t.label, vars); if (t.id) vars[t.id] = r;
});
}
const outs = Array.isArray(spec.outputs) ? spec.outputs : []; spec.outputs = outs;
if (T !== 'planner' && outs.length < 1) errors.push('결과(outputs)가 1개 이상 필요해요');
if (outs.length > 6) errors.push('결과는 6개 이하');
outs.forEach((o, i) => {
if (!str(o.label, 30)) errors.push('outputs[' + i + '].label은 1~30자');
if (!FORMATS.includes(o.format)) errors.push('outputs[' + i + '].format은 won/percent/number/decimal');
if (o.id && (!idOk(o.id) || seen.has(o.id))) errors.push('outputs[' + i + '].id 형식 오류/중복'); if (o.id) seen.add(o.id);
const r = checkFormula(o.formula, '결과 ' + o.label, vars); if (o.id) vars[o.id] = r;
});
const vds = Array.isArray(spec.verdicts) ? spec.verdicts : []; spec.verdicts = vds;
vds.forEach((d, i) => {
if (!['good', 'warn', 'bad', 'info'].includes(d.tone)) errors.push('verdicts[' + i + '].tone 오류');
if (!str(d.text, 120)) errors.push('verdicts[' + i + '].text는 1~120자');
try { evaluate(d.when, vars); } catch (e) { errors.push('verdicts[' + i + '].when: ' + e.message); }
});
if (vds.length && String(vds[vds.length - 1].when).trim() !== 'true') errors.push('verdicts 마지막 항목의 when은 "true"(그 외 모든 경우)여야 해요');
} else if (T === 'checklist') {
const items = Array.isArray(spec.items) ? spec.items : [];
if (items.length < 3 || items.length > 10) errors.push('점검 항목(items)은 3~10개');
items.forEach((it, i) => { if (!str(it.text, 50)) errors.push('items[' + i + '].text는 1~50자'); if (it.hint != null && it.hint !== '' && !str(it.hint, 80)) errors.push('items[' + i + '].hint는 80자 이내'); });
const b = Array.isArray(spec.bands) ? spec.bands : [];
if (b.length < 2) errors.push('결과 구간(bands)이 2개 이상 필요해요');
b.forEach((x, i) => { if (typeof x.min !== 'number' || x.min < 0 || x.min > 1) errors.push('bands[' + i + '].min은 0~1'); if (!str(x.text, 120)) errors.push('bands[' + i + '].text는 1~120자'); });
if (b.length && !b.some(x => x.min === 0)) errors.push('bands 중 min 0인 구간이 필요해요');
} else if (T === 'diagnosis') {
const axes = Array.isArray(spec.axes) ? spec.axes : []; const qs = Array.isArray(spec.questions) ? spec.questions : [];
if (axes.length < 2 || axes.length > 5) errors.push('진단 영역(axes)은 2~5개');
const ax = new Set();
axes.forEach((a, i) => { if (!idOk(a.id)) errors.push('axes[' + i + '].id 형식 오류'); if (!str(a.name, 12)) errors.push('axes[' + i + '].name은 1~12자'); ax.add(a.id); });
if (qs.length < 4 || qs.length > 12) errors.push('질문(questions)은 4~12개');
qs.forEach((q, i) => {
if (!str(q.text, 60)) errors.push('questions[' + i + '].text는 1~60자');
if (!ax.has(q.axis)) errors.push('questions[' + i + '].axis가 axes에 없어요');
const op = Array.isArray(q.options) ? q.options : [];
if (op.length < 2 || op.length > 4) errors.push('questions[' + i + '] 보기는 2~4개');
op.forEach((o, j) => { if (!str(o.label, 24)) errors.push('questions[' + i + '].options[' + j + '].label은 1~24자'); if (typeof o.score !== 'number') errors.push('questions[' + i + '].options[' + j + '].score 숫자 필요'); });
});
axes.forEach(a => { if (!qs.some(q => q.axis === a.id)) errors.push('영역 ' + a.name + '에 질문이 없어요'); });
const b = Array.isArray(spec.bands) ? spec.bands : [];
if (b.length < 2) errors.push('결과 구간(bands)이 2개 이상 필요해요');
b.forEach((x, i) => { if (typeof x.min !== 'number' || x.min < 0 || x.min > 1) errors.push('bands[' + i + '].min은 0~1'); if (!str(x.title, 20)) errors.push('bands[' + i + '].title은 1~20자'); if (!str(x.text, 120)) errors.push('bands[' + i + '].text는 1~120자'); });
if (b.length && !b.some(x => x.min === 0)) errors.push('bands 중 min 0인 구간이 필요해요');
const adv = spec.advice || {}; axes.forEach(a => { if (!str(adv[a.id], 120)) errors.push('advice.' + a.id + '(가장 약한 영역일 때 할 일)이 필요해요'); });
} else if (T === 'guide') {
const steps = Array.isArray(spec.steps) ? spec.steps : []; const fields = Array.isArray(spec.fields) ? spec.fields : []; const tpl = Array.isArray(spec.templates) ? spec.templates : [];
if (steps.length < 2 || steps.length > 7) errors.push('단계(steps)는 2~7개');
steps.forEach((s, i) => { if (!str(s.title, 24)) errors.push('steps[' + i + '].title은 1~24자'); if (!str(s.text, 160)) errors.push('steps[' + i + '].text는 1~160자'); });
const fid = new Set();
fields.forEach((f, i) => { if (!idOk(f.id)) errors.push('fields[' + i + '].id 형식 오류'); if (!str(f.label, 20)) errors.push('fields[' + i + '].label은 1~20자'); fid.add(f.id); });
if (fields.length > 4) errors.push('입력칸(fields)은 4개 이하');
if (tpl.length < 1 || tpl.length > 5) errors.push('문구 틀(templates)은 1~5개');
tpl.forEach((t, i) => {
if (!str(t.label, 24)) errors.push('templates[' + i + '].label은 1~24자');
if (!str(t.text, 400)) errors.push('templates[' + i + '].text는 1~400자');
(String(t.text || '').match(/\{([a-z][a-z0-9_]*)\}/g) || []).forEach(m => { if (!fid.has(m.slice(1, -1))) errors.push('templates[' + i + ']의 ' + m + '가 fields에 없어요'); });
});
}
const blob = JSON.stringify(spec);
if (/<\s*\/?\s*(script|iframe|img|style|a)\b/i.test(blob) || /javascript:/i.test(blob)) errors.push('HTML이나 링크 코드는 넣을 수 없어요');
return { ok: errors.length === 0, errors, spec };
}
const fmt = (v, f, unit) => {
if (typeof v !== 'number' || !isFinite(v)) return '-';
if (f === 'won') return Math.round(v).toLocaleString('ko-KR') + '원';
if (f === 'percent') return (v * 100).toFixed(1) + '%';
if (f === 'decimal') return (Math.round(v * 10) / 10).toLocaleString('ko-KR') + (unit || '');
return Math.round(v).toLocaleString('ko-KR') + (unit || '');
};
return { TYPES, compile, evaluate, tableCompute, computeForm, validate, fmt };
})();
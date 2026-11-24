// Prototype autonome V2. Aucune connexion, aucune donnée réelle, aucun effet de bord.
const codes = new Set(['512','530','4671','4672','4673','401','756','706','707','754','606','616','625','627','110','471']);
export function validateJournal(entries) {
  if (!Array.isArray(entries)) throw new Error('Journal invalide');
  const ids = new Set(), sources = new Set(), byId = new Map(), reversed = new Set();
  for (const e of entries) {
    if (!e || typeof e.id !== 'string' || !e.id.trim() || ids.has(e.id)) throw new Error('Identifiant invalide ou doublon');
    if (typeof e.source !== 'string' || !e.source.trim() || sources.has(e.source)) throw new Error('Source invalide ou doublon');
    if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(Date.parse(e.date)) || new Date(e.date).toISOString().slice(0,10)!==e.date) throw new Error('Date invalide');
    if (!Array.isArray(e.lines) || e.lines.length < 2) throw new Error('Deux lignes minimum');
    let d=0n,c=0n;
    for (const l of e.lines) {
      if (!codes.has(l.account) || !Number.isSafeInteger(l.cents) || l.cents<=0 || !['D','C'].includes(l.side)) throw new Error('Ligne invalide');
      if(l.side==='D') d+=BigInt(l.cents); else c+=BigInt(l.cents);
    }
    if(d!==c) throw new Error('Ecriture desequilibree');
    if(e.reverses != null) {
      const orig=byId.get(e.reverses);
      if(!orig || reversed.has(e.reverses) || e.date<orig.date) throw new Error('Contrepassation invalide');
      const signature=(lines,flip)=>lines.map(l=>JSON.stringify([l.account,flip?(l.side==='D'?'C':'D'):l.side,l.cents])).sort().join('|');
      if(signature(e.lines,false)!==signature(orig.lines,true)) throw new Error('Contrepassation non identique');
      reversed.add(e.reverses);
    }
    ids.add(e.id); sources.add(e.source); byId.set(e.id,e);
  }
  return true;
}
export function accountBalances(entries, asOf) {
  validateJournal(entries);
  if(typeof asOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!Number.isFinite(Date.parse(asOf))||new Date(asOf).toISOString().slice(0,10)!==asOf) throw new Error('Date invalide');
  const out = new Map();
  for(const e of entries) if(e.date<=asOf) for(const l of e.lines) {
    out.set(l.account,(out.get(l.account)||0n)+(l.side==='D'?1n:-1n)*BigInt(l.cents));
  }
  return Object.fromEntries([...out].map(([k,v])=>{const n=Number(v);if(!Number.isSafeInteger(n))throw new Error('Solde hors limites');return [k,n]}));
}
export function position(entries, asOf) {
  const b=accountBalances(entries,asOf), get=k=>b[k]||0;
  const available=get('512')+get('530');
  if(!Number.isSafeInteger(available)) throw new Error('Solde hors limites');
  return {bank:get('512'),cash:get('530'),available,processor:get('4671'),receivables:get('4672'),advances:-get('4673'),unassigned:get('471')};
}

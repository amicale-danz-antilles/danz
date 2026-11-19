/**
 * Comparateur hors-ligne, bloquant et respectueux des donnees DANZ.
 * Les snapshots RESTENT PRIVES, jamais dans GitHub ni dans un site web.
 * Ne produit aucun nom, identifiant, valeur, e-mail ou empreinte de donnees.
 *
 * Usage : node migration/compare-snapshots.mjs /secure/source.json /secure/target.json
 * Les deux JSON doivent contenir:
 * {
 *   "format": "DANZ-PRIVATE-1",
 *   "tables": { "<logical-table>": [ { ... full logical row ... }, ... ] },
 *   "assets": [ { "key": "...", "bytes": 123, "sha256": "<64 hex chars>" }, ... ],
 *   "authAccounts": [ { "id": "...", "role": "...", "active": true,
 *                        "is_treasurer": false, "household_id": null }, ... ]
 * }
 * Il faut sauvegarder les donnees et fichiers avec un chiffrement fort
 * adapte aux regles de l'association AVANT de lancer cet outil.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const contract = JSON.parse(readFileSync(new URL("./source-contract.json", import.meta.url),"utf8"));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    // Les sommes en centimes doivent rester des entiers exacts.
    throw new Error("unsafe_number_in_snapshot");
  }
  return value;
}

const hash = item => createHash("sha256").update(JSON.stringify(stable(item))).digest("hex");

function rowKey(row, fields) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("invalid_row");
  const key = fields.map(field => {
    if (!(field in row) || row[field] === null || typeof row[field] === "object") {
      throw new Error("missing_primary_key");
    }
    return String(row[field]);
  });
  return JSON.stringify(key);
}

function keyedRows(rows, fields) {
  if (!Array.isArray(rows)) throw new Error("invalid_rows");
  const map = new Map();
  for (const row of rows) {
    const key = rowKey(row,fields);
    if (map.has(key)) throw new Error("duplicate_primary_key");
    map.set(key,hash(row));
  }
  return map;
}

function compareMaps(a,b,context,report) {
  let missing=0,extra=0,changed=0;
  for (const [key,digest] of a) {
    if (!b.has(key)) missing++;
    else if (b.get(key)!==digest) changed++;
  }
  for (const key of b.keys()) if (!a.has(key)) extra++;
  if (missing || extra || changed) report.issues.push({
    area:context,missing,extra,changed,
  });
}

function compareAssetList(source,target,report) {
  for (const [label,rows] of [["source",source],["target",target]]) {
    if(!Array.isArray(rows)) throw new Error("assets_missing_"+label);
  }
  const keys=["key"];
  for (const rows of [source,target]) {
    for (const row of rows) {
      if (typeof row.key!=="string" || !Number.isSafeInteger(row.bytes) || row.bytes<0
        || typeof row.sha256!=="string" || !/^[a-f0-9]{64}$/.test(row.sha256)) {
        throw new Error("unverified_asset_manifest");
      }
    }
  }
  compareMaps(keyedRows(source,keys),keyedRows(target,keys),"files",report);
}

function identityProjection(account) {
  if(!account || typeof account.id!=="string" || !account.id)throw new Error("invalid_auth_account");
  return {
    id:account.id,
    role:account.role,
    active:account.active,
    is_treasurer:account.is_treasurer,
    household_id:account.household_id??null,
  };
}

export function compareSnapshots(source,target,expected=contract) {
  const report={ok:false,areasChecked:0,issues:[]};
  if (source?.format!=="DANZ-PRIVATE-1" || target?.format!=="DANZ-PRIVATE-1") {
    report.issues.push({area:"format",reason:"unrecognized_snapshot_format"});
    return report;
  }
  if (!source.tables || !target.tables || typeof source.tables!=="object" || typeof target.tables!=="object") {
    report.issues.push({area:"tables",reason:"snapshot_tables_missing"});
    return report;
  }
  for (const item of expected.tables) {
    const name=item.name;
    if (!Object.hasOwn(source.tables,name) || !Object.hasOwn(target.tables,name)) {
      report.issues.push({area:"tables",reason:"missing_required_table"});
      continue;
    }
    try {
      compareMaps(
        keyedRows(source.tables[name],item.primaryKey),
        keyedRows(target.tables[name],item.primaryKey),
        "table:"+name,report
      );
      report.areasChecked++;
    } catch (_) {
      report.issues.push({area:"table:"+name,reason:"invalid_or_duplicate_rows"});
    }
  }
  for (const side of [source,target]) {
    if (Object.keys(side.tables).some(name=>!expected.tables.some(table=>table.name===name))) {
      report.issues.push({area:"tables",reason:"unexpected_table_present"});
    }
  }
  try{
    compareAssetList(source.assets,target.assets,report);
    report.areasChecked++;
  }catch(_){report.issues.push({area:"files",reason:"invalid_or_incomplete_manifest"});}
  try{
    const a=source.authAccounts.map(identityProjection);
    const b=target.authAccounts.map(identityProjection);
    compareMaps(keyedRows(a,["id"]),keyedRows(b,["id"]),"authAccounts",report);
    report.areasChecked++;
  }catch(_){report.issues.push({area:"authAccounts",reason:"missing_or_invalid_identity_manifest"});}

  // La comparaison de donnees ne demontre PAS le bon fonctionnement de la connexion.
  report.ok = report.issues.length===0 && report.areasChecked===expected.tables.length+2;
  return report;
}

function cli() {
  if (process.argv.length!==4) {
    console.error("Usage: node migration/compare-snapshots.mjs source.json target.json");
    process.exitCode=2;
    return;
  }
  try {
    const source=JSON.parse(readFileSync(resolve(process.argv[2]),"utf8"));
    const target=JSON.parse(readFileSync(resolve(process.argv[3]),"utf8"));
    const result=compareSnapshots(source,target);
    // Aucune valeur ni identifiant utilisateur n'est imprime.
    console.log(JSON.stringify(result,null,2));
    if (!result.ok) process.exitCode=1;
  }catch(_){
    console.error("Comparison stopped: invalid or inaccessible private snapshot");
    process.exitCode=2;
  }
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) cli();

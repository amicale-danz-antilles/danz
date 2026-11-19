/**
 * DANZ - prototype SQLite D1 LOCAL, genere depuis les metadonnees read-only.
 * INTERDIT de l'appliquer directement a une base D1 distante ou a la production.
 * Aucune donnee utilisateur/finance/mot de passe, seulement la structure partielle.
 *
 * node migration/generate-d1-blueprint.mjs
 * node migration/generate-d1-blueprint.mjs --out /chemin/vers/nouveau-fichier.sql
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = JSON.parse(readFileSync(new URL("./source-schema-metadata.json", import.meta.url), "utf8"));
const sourceContract = JSON.parse(readFileSync(new URL("./source-contract.json", import.meta.url), "utf8"));
const NAME=/^[a-z][a-z0-9_]*$/;
const quote = s => {
  if(typeof s!=="string" || !NAME.test(s)) throw new Error("invalid_schema_identifier");
  return '"' + s + '"';
};
const d1Name = s => quote("mig_"+s);

const typeMap=Object.freeze({
  bool:"INTEGER",
  date:"TEXT",
  float8:"REAL",
  int2:"INTEGER",
  int4:"INTEGER",
  int8:"INTEGER",
  jsonb:"TEXT",
  text:"TEXT",
  timestamptz:"TEXT",
  uuid:"TEXT",
});

const onDelete=Object.freeze({a:"NO ACTION",c:"CASCADE",r:"RESTRICT",n:"SET NULL",d:"SET DEFAULT"});

export function generateD1Blueprint(meta=source, contract=sourceContract) {
  if(meta?.format!=="DANZ-READONLY-SCHEMA-METADATA-1"||
     !Array.isArray(meta.tables)||meta.tables.length!==36||
     !Array.isArray(contract.tables)||contract.tables.length!==36) {
    throw new Error("incomplete_36_table_contract");
  }
  const required=new Map(contract.tables.map(t=>[t.name,t]));
  const current=new Set();
  const risks=[];
  const ddl=[];
  for(const t of meta.tables) {
    if(!NAME.test(t.name) || !required.has(t.name) || current.has(t.name) ||
       !Array.isArray(t.columns) || !Array.isArray(t.primaryKey) ||
       !Array.isArray(t.foreignKeys)) throw new Error("invalid_or_duplicate_source_table");
    current.add(t.name);
    const expected=required.get(t.name);
    if(JSON.stringify(expected.primaryKey)!==JSON.stringify(t.primaryKey) ||
       t.columns.length===0) throw new Error("primary_key_contract_mismatch");

    const columnNames=new Set(), definitions=[];
    for(const col of t.columns) {
      if(!NAME.test(col.name)||columnNames.has(col.name)||!(col.pgType in typeMap)) {
        throw new Error("unsupported_or_duplicate_column");
      }
      columnNames.add(col.name);
      const type=typeMap[col.pgType];
      const nullable = col.nullable && !t.primaryKey.includes(col.name) ? "" : " NOT NULL";
      const boolCheck = col.pgType==="bool" ?
        ` CHECK (${quote(col.name)} IN (0, 1))` : "";
      definitions.push(`  ${quote(col.name)} ${type}${nullable}${boolCheck}`);
      if (col.identity || col.generated) {
        risks.push({area:t.name,kind:"source_generated_column",count:1});
      }
      if(col.pgType==="timestamptz"||col.pgType==="jsonb"){
        risks.push({area:t.name,kind:"semantic_canonicalization_needed",count:1});
      }
    }
    for(const key of t.primaryKey) if(!columnNames.has(key))throw new Error("missing_primary_key_column");
    definitions.push(`  PRIMARY KEY (${t.primaryKey.map(quote).join(", ")})`);

    if(!Array.isArray(t.uniqueKeys))throw new Error("missing_unique_constraints_inventory");
    for(const unique of t.uniqueKeys){
      if(!NAME.test(unique.name) || !Array.isArray(unique.columns) ||
         unique.columns.length===0 ||
         new Set(unique.columns).size!==unique.columns.length ||
         !unique.columns.every(n=>columnNames.has(n))) {
        throw new Error("invalid_unique_constraint");
      }
      definitions.push(`  UNIQUE (${unique.columns.map(quote).join(", ")})`);
    }

    for(const fk of t.foreignKeys){
      if(!NAME.test(fk.name) || !Array.isArray(fk.columns) ||
         !Array.isArray(fk.targetColumns) || fk.columns.length!==fk.targetColumns.length ||
         fk.columns.length<1 || !fk.columns.every(x=>columnNames.has(x)) ||
         !fk.targetColumns.every(x=>NAME.test(x)))throw new Error("bad_foreign_key_contract");
      if(fk.targetSchema==="public" && required.has(fk.targetTable) &&
         fk.deleteRule in onDelete && fk.deleteRule!=="d") {
        definitions.push(`  FOREIGN KEY (${fk.columns.map(quote).join(", ")}) REFERENCES ${d1Name(fk.targetTable)} (${fk.targetColumns.map(quote).join(", ")}) ON DELETE ${onDelete[fk.deleteRule]}`);
      }else{
        risks.push({area:t.name,kind:"unmodeled_foreign_key",count:1});
      }
    }
    const unmodeled=t.constraintsNotModeled||{};
    if(unmodeled.uniques !== t.uniqueKeys.length) {
      throw new Error("unique_constraints_count_mismatch");
    }
    for(const [key,kind] of [["checks","check_constraints"],["exclusions","exclusion_constraints"]]){
      const n=Number(unmodeled[key]);
      if(!Number.isSafeInteger(n)||n<0)throw new Error("invalid_constraint_count");
      if(n) risks.push({area:t.name,kind,count:n});
    }
    if(t.sourceRlsEnabled) risks.push({area:t.name,kind:"server_authorization_required",count:1});
    ddl.push(`CREATE TABLE ${d1Name(t.name)} (\n${definitions.join(",\n")}\n);`);
  }
  if(current.size!==required.size)throw new Error("missing_contract_table");

  // Les dates/JSON/decimaux doivent etre normalises avec des jeux d'essai avant import.
  // Ni les valeurs par defaut, triggers, index, vues, RPC, ni auth/storage ne sont portes.
  const header=[
    "-- DANZ - SCHEMA PILOTE LOCAL UNIQUEMENT ; NON AUTORISE EN D1 DISTANT",
    "-- Metadonnees publiques de schema, pas de donnees metier ni d'authentification.",
    "-- 36 tables avec prefixe mig_ (evite de toucher aux stg_* existantes).",
    "-- BLOQUEURS : DEFAULTS, CHECKS, RLS, INDEX SPECIFIQUES, TRIGGERS, RPC, AUTH, STORAGE.",
    "-- Les risques et ecarts sont listes par generateD1Blueprint().",
    "PRAGMA foreign_keys = ON;",
  ].join("\n");

  return Object.freeze({
    sql:header+"\n\n"+ddl.join("\n\n")+"\n",
    tableCount:ddl.length,
    columnCount:meta.tables.reduce((n,t)=>n+t.columns.length,0),
    publicForeignKeysModeled:meta.tables.reduce((n,t)=>n+t.foreignKeys.filter(f=>
      f.targetSchema==="public"&&required.has(f.targetTable)&&f.deleteRule in onDelete&&f.deleteRule!=="d").length,0),
    risks,
    safeForRemoteImport:false,
    realDataIncluded:false,
    approval:"NO-GO",
  });
}

const invoked=process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    const generated=generateD1Blueprint();
    const index=process.argv.indexOf("--out");
    if(index!==-1 && process.argv[index+1] && process.argv.length===4){
      // Refuser d'ecraser un fichier : cet artefact n'est jamais une migration autorisee.
      writeFileSync(resolve(process.argv[index+1]),generated.sql,{flag:"wx",mode:0o600});
    }else if(process.argv.length!==2){
      throw new Error("usage_invalid");
    }
    // On ne publie pas le SQL sans une destination explicite.
    console.log(JSON.stringify({
      stage:"local-schema-blueprint",tables:generated.tableCount,
      columns:generated.columnCount,foreignKeysModeled:generated.publicForeignKeysModeled,
      risksFound:generated.risks.length,remoteImportAuthorized:false,
      liveDataCopied:false,
    }));
  }catch(_){
    console.error("Schema blueprint refused: invalid contract or destination");
    process.exitCode=1;
  }
}

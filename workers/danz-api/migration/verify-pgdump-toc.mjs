/**
 * DANZ: controle LOCAL du catalogue d'une archive pg_dump PostgreSQL.
 * Un seul pg_dump custom est une photographie transactionnelle de la base.
 * Il doit contenir les 36 tables publiques ET les schemas geres auth/storage.
 * Une archive structurellement complete N'EST PAS une restauration reussie.
 *
 * Usage:
 *   pg_restore --list sauvegarde.dump > inventaire-prive.txt
 *   node migration/verify-pgdump-toc.mjs inventaire-prive.txt
 *
 * Ne jamais publier l'archive ni l'inventaire prive (identites, roles, schemas).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source=JSON.parse(readFileSync(new URL("./source-contract.json",import.meta.url),"utf8"));
const managed=["auth.users","auth.identities","storage.objects","storage.buckets"];
const linePattern=/^\s*\d+;\s+\d+\s+\d+\s+(TABLE DATA|TABLE)\s+([a-z_][a-z_0-9]*)\s+([a-z_][a-z_0-9]*)\s+/;

export function verifyDumpTOC(content){
  const report={ok:false,stage:"private-backup-toc",
    tableSchemaChecked:0,tableDataChecked:0,managedSchemaChecked:0,managedDataChecked:0,
    missing:[],restorationVerified:false,storageBytesVerified:false,encryptedCopyVerified:false};
  if(typeof content!=="string"||content.length===0){report.missing.push("unreadable_catalog");return report;}
  const found=new Set();
  for(const line of content.split(/\r?\n/)){
    const m=linePattern.exec(line);
    if(m) found.add(m[1]+" "+m[2]+"."+m[3]);
  }
  for(const table of source.tables){
    for(const [kind,countKey] of [["TABLE","tableSchemaChecked"],["TABLE DATA","tableDataChecked"]]){
      const key=kind+" public."+table.name;
      if(found.has(key))report[countKey]++;
      else report.missing.push(kind==="TABLE"?"missing_public_table":"missing_public_table_data");
    }
  }
  for(const key of managed){
    for(const [kind,countKey] of [["TABLE","managedSchemaChecked"],["TABLE DATA","managedDataChecked"]]){
      if(found.has(kind+" "+key))report[countKey]++;
      else report.missing.push(kind==="TABLE"?"missing_managed_table":"missing_managed_table_data");
    }
  }
  report.ok=report.missing.length===0 &&
    report.tableSchemaChecked===36 && report.tableDataChecked===36 &&
    report.managedSchemaChecked===4 && report.managedDataChecked===4;
  // Les noms de tables manquantes ne sont pas exposes aux sorties console :
  // elles pourront etre inspectees localement sans risque de contenu nominatif.
  report.missingCount=report.missing.length;
  delete report.missing;
  return report;
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  if(process.argv.length!==3){
    console.error("Usage: node migration/verify-pgdump-toc.mjs <private-catalog-path>");
    process.exitCode=2;
  }else{
    try{
      const out=verifyDumpTOC(readFileSync(resolve(process.argv[2]),"utf8"));
      console.log(JSON.stringify(out,null,2));
      if(!out.ok)process.exitCode=1;
    }catch(_){
      console.error("Cannot inspect private pg_dump catalog");
      process.exitCode=2;
    }
  }
}

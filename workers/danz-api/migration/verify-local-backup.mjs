// DANZ — verification LOCALE d'une sauvegarde, sans connexion reseau.
// Ne jamais commiter les fichiers SQL (dont auth.users), ni les fichiers R2.
// Usage: node migration/verify-local-backup.mjs /chemin/vers/backup-prive
// Ce controle ne remplace PAS une restauration complete dans un environnement isole.
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const contract=JSON.parse(readFileSync(new URL("./source-contract.json",import.meta.url),"utf8"));
const digest=b=>createHash("sha256").update(b).digest("hex");
const safeName=n=>/^[a-z_]+$/.test(n);
const escaped=n=>n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

export function verifyLocalBackup(directory,{requireAssets=true}={}) {
  const report={ok:false,checkedTables:0,expectedTables:contract.tables.length,checkedFiles:0,issues:[],fileDigests:{}};
  if (typeof directory!=="string" || !directory) {
    report.issues.push("missing_backup_folder");return report;
  }
  const root=resolve(directory);
  const files={};
  for(const filename of ["roles.sql","schema.sql","data.sql"]){
    const filepath=join(root,filename);
    if (!existsSync(filepath)) {report.issues.push("missing_"+filename);continue;}
    try {
      const st=statSync(filepath);
      if (!st.isFile()||st.size===0) {report.issues.push("empty_or_invalid_"+filename);continue;}
      const bytes=readFileSync(filepath);
      files[filename]=bytes.toString("utf8");
      report.fileDigests[filename]={bytes:bytes.length,sha256:digest(bytes)};
    }catch(_){report.issues.push("unreadable_"+filename);}
  }
  if (files["schema.sql"]){
    for (const item of contract.tables) {
      if(!safeName(item.name)){report.issues.push("invalid_contract_table");continue;}
      const expression=new RegExp(
        "(?:^|\\n)CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:\\\"?public\\\"?\\.)\\\"?"+escaped(item.name)+"\\\"?(?=\\s|\\()","im"
      );
      if (!expression.test(files["schema.sql"]))report.issues.push("missing_schema_table:"+item.name);
      else report.checkedTables++;
    }
  }
  if(files["data.sql"]){
    for(const item of contract.tables){
      const exp=new RegExp(
        "(?:^|\\n)COPY\\s+(?:\\\"?public\\\"?\\.)\\\"?"+escaped(item.name)+"\\\"?(?=\\s|\\()","im"
      );
      if(!exp.test(files["data.sql"]))report.issues.push("missing_data_copy:"+item.name);
    }
    for(const managed of ["auth.users","storage.objects","storage.buckets"]){
      const [schema,table]=managed.split(".");
      const exp=new RegExp("(?:^|\\n)COPY\\s+\\\"?"+schema+"\\\"?\\.\\\"?"+table+"\\\"?(?=\\s|\\()","im");
      if(!exp.test(files["data.sql"]))report.issues.push("missing_managed_data:"+managed);
    }
  }
  const assetManifest=join(root,"assets-manifest.json");
  if (!existsSync(assetManifest)) {
    if(requireAssets)report.issues.push("missing_assets_manifest");
  }else{
    try {
      const parsed=JSON.parse(readFileSync(assetManifest,"utf8"));
      if(parsed?.format!=="DANZ-ASSETS-1" || !Array.isArray(parsed.files)){
        report.issues.push("invalid_assets_manifest");
      }else{
        if(parsed.files.length===0&&requireAssets) report.issues.push("empty_assets_manifest");
        const names=new Set();
        for(const item of parsed.files){
          if(!item || typeof item.path!=="string"|| !/^(r2|supabase-storage)\//.test(item.path)
             || item.path.includes("\\") ||item.path.split("/").includes("..")
             || names.has(item.path) || !Number.isSafeInteger(item.bytes) || item.bytes<0
             || !/^[a-f0-9]{64}$/.test(item.sha256||"")){
            report.issues.push("invalid_asset_entry");continue;
          }
          names.add(item.path);
          const p=resolve(root,item.path);
          if (!relative(root,p) || relative(root,p).startsWith("..")){
            report.issues.push("invalid_asset_path");continue;
          }
          try{
            const stat=statSync(p);
            if(!stat.isFile()||stat.size!==item.bytes || digest(readFileSync(p))!==item.sha256){
              report.issues.push("file_mismatch");continue;
            }
            report.checkedFiles++;
          }catch(_){report.issues.push("unreadable_asset");}
        }
      }
    }catch(_){report.issues.push("invalid_assets_manifest");}
  }
  report.ok=report.issues.length===0 && report.checkedTables===contract.tables.length;
  return report;
}

const entry=process.argv[1]&&resolve(process.argv[1]);
if(entry===fileURLToPath(import.meta.url)){
  const base=process.argv[2];
  if (!base){console.error("Usage: node migration/verify-local-backup.mjs /private-backup-directory");process.exitCode=2;}
  else{
    const report=verifyLocalBackup(base);
    // Publication console limitee aux noms des tables et etats de validation.
    // Les noms, contenus des documents, e-mails, mots de passe n'y figurent pas.
    console.log(JSON.stringify(report,null,2));
    if(!report.ok)process.exitCode=1;
  }
}

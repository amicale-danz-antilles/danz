// DANZ — verification LOCALE d'une sauvegarde, sans connexion reseau.
// Ne jamais commiter les fichiers SQL (dont auth.users), ni les fichiers R2.
// Usage: node migration/verify-local-backup.mjs /chemin/vers/backup-prive
// Ce controle ne remplace PAS une restauration complete dans un environnement isole.
import { readFileSync, lstatSync, readdirSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const contract=JSON.parse(readFileSync(new URL("./source-contract.json",import.meta.url),"utf8"));
const digest=b=>createHash("sha256").update(b).digest("hex");
const digestFile=filepath=>{
  // Hachage par blocs pour conserver peu de RAM, y compris avec de gros albums.
  const h=createHash("sha256"), buffer=Buffer.allocUnsafe(1024*1024);
  const fd=openSync(filepath,"r");
  try {
    let n;
    while((n=readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n));
  } finally { closeSync(fd); }
  return h.digest("hex");
};
const safeName=n=>/^[a-z_]+$/.test(n);
const escaped=n=>n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

// This is a structural check for pg_dump's COPY text format, not a SQL engine.
// Ignore quoted SQL strings, dollar bodies and comments so a commented-out
// declaration cannot count as a backed-up table. Quoted identifiers remain.
function sqlSkeleton(text) {
  let out="",i=0;
  const mask=(from,to)=>text.slice(from,to).replace(/[^\r\n]/g," ");
  while (i<text.length) {
    const start=i;
    if (text.startsWith("--",i)) {
      const end=text.indexOf("\n",i);
      i=end<0?text.length:end;
      out+=mask(start,i);
    } else if (text.startsWith("/*",i)) {
      let depth=1; i+=2;
      while(i<text.length && depth) {
        if(text.startsWith("/*",i)) {depth++;i+=2;}
        else if(text.startsWith("*/",i)) {depth--;i+=2;}
        else i++;
      }
      out+=mask(start,i);
    } else if (text[i]==="'") {
      i++;
      while(i<text.length) {
        if(text[i]==="'" && text[i+1]==="'") i+=2;
        else if(text[i++]==="'") break;
      }
      out+=mask(start,i);
    } else if(text[i]==='"') {
      i++;
      while(i<text.length) {
        if(text[i]==='"' && text[i+1]==='"') i+=2;
        else if(text[i++]==='"') break;
      }
      out+=text.slice(start,i);
    } else {
      const tag=text[i]==="$" && /^\$(?:[a-z_][a-z_0-9]*)?\$/i.exec(text.slice(i));
      if(tag) {
        const end=text.indexOf(tag[0],i+tag[0].length);
        i=end<0?text.length:end+tag[0].length;
        out+=mask(start,i);
      } else out+=text[i++];
    }
  }
  return out;
}

function copyBlocks(text,issues) {
  const blocks=new Map();
  const lines=text.split(/\r?\n/);
  // Mask comments before recognizing headers, without interpreting COPY rows
  // (which can contain quotes, comment markers and arbitrary private content).
  let outside="", active=null;
  for (const line of lines) {
    if (active) {
      if (line==="\\.") { active=null; continue; }
      if (line.split("\t").length!==active.columns) issues.push("invalid_copy_row_width");
      continue;
    }
    outside+=line+"\n";
    const clean=sqlSkeleton(outside);
    const last=clean.slice(clean.lastIndexOf("\n",clean.length-2)+1).trim();
    const match=/^COPY\s+"?([a-z_]+)"?\."?([a-z_]+)"?\s*\(([^)]+)\)\s+FROM\s+stdin;$/i.exec(last);
    if (!match) continue;
    const name=match[1]+"."+match[2];
    if (blocks.has(name)) issues.push("duplicate_copy_block");
    const columns=match[3].split(",").map(x=>x.trim().replace(/^"|"$/g,""));
    if (new Set(columns).size!==columns.length || columns.some(x=>!safeName(x))) issues.push("invalid_copy_columns");
    active={columns:columns.length};
    blocks.set(name,columns);
    outside="";
  }
  if (active) issues.push("unterminated_copy_block");
  return blocks;
}

function localAssetPaths(directory,root,result=new Set()) {
  const stat=lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe_asset_directory");
  for (const name of readdirSync(directory)) {
    const path=join(directory,name), entry=lstatSync(path);
    if (entry.isSymbolicLink()) throw new Error("symlinks_not_allowed");
    if (entry.isDirectory()) localAssetPaths(path,root,result);
    else if (entry.isFile()) result.add(relative(root,path).split(sep).join("/"));
    else throw new Error("unsupported_file_type");
  }
  return result;
}

export function verifyLocalBackup(directory,{requireAssets=true}={}) {
  const report={ok:false,validationLevel:"local-structure-only",restorationVerified:false,
    encryptionVerified:false,remoteInventoryVerified:false,
    checkedTables:0,expectedTables:contract.tables.length,checkedFiles:0,issues:[],fileDigests:{}};
  if (typeof directory!=="string" || !directory) {
    report.issues.push("missing_backup_folder");return report;
  }
  const root=resolve(directory);
  try {
    if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error("unsafe_root");
  } catch (_) { report.issues.push("invalid_backup_folder"); return report; }
  const files={};
  for(const filename of ["roles.sql","schema.sql","data.sql"]){
    const filepath=join(root,filename);
    if (!existsSync(filepath)) {report.issues.push("missing_"+filename);continue;}
    try {
      const st=lstatSync(filepath);
      if (!st.isFile()||st.isSymbolicLink()||st.size===0) {report.issues.push("empty_or_invalid_"+filename);continue;}
      const bytes=readFileSync(filepath);
      files[filename]=bytes.toString("utf8");
      report.fileDigests[filename]={bytes:bytes.length,sha256:digest(bytes)};
    }catch(_){report.issues.push("unreadable_"+filename);}
  }
  if (files["schema.sql"]){
    const schema=sqlSkeleton(files["schema.sql"]);
    for (const item of contract.tables) {
      if(!safeName(item.name)){report.issues.push("invalid_contract_table");continue;}
      const expression=new RegExp(
        "(?:^|\\n)CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:\\\"?public\\\"?\\.)\\\"?"+escaped(item.name)+"\\\"?(?=\\s|\\()","im"
      );
      if (!expression.test(schema))report.issues.push("missing_schema_table:"+item.name);
      else report.checkedTables++;
    }
  }
  if(files["data.sql"]){
    const copies=copyBlocks(files["data.sql"],report.issues);
    for(const item of contract.tables){
      if(!copies.has("public."+item.name))report.issues.push("missing_data_copy:"+item.name);
      else if(item.primaryKey.some(key=>!copies.get("public."+item.name).includes(key))) {
        report.issues.push("missing_copy_primary_key:"+item.name);
      }
    }
    for(const managed of ["auth.users","auth.identities","storage.objects","storage.buckets"]){
      if(!copies.has(managed))report.issues.push("missing_managed_data:"+managed);
    }
  }
  const assetManifest=join(root,"assets-manifest.json");
  if (!existsSync(assetManifest)) {
    if(requireAssets)report.issues.push("missing_assets_manifest");
  }else{
    try {
      if (lstatSync(assetManifest).isSymbolicLink()) throw new Error("symlink_manifest");
      const parsed=JSON.parse(readFileSync(assetManifest,"utf8"));
      if(parsed?.format!=="DANZ-ASSETS-1" || !Array.isArray(parsed.files)){
        report.issues.push("invalid_assets_manifest");
      }else{
        if(parsed.files.length===0&&requireAssets) report.issues.push("empty_assets_manifest");
        const names=new Set(), actualNames=new Set();
        try {
          for (const storage of ["r2","supabase-storage"]) {
            for (const name of localAssetPaths(join(root,storage),root)) actualNames.add(name);
          }
        } catch (_) { report.issues.push("invalid_storage_directory"); }
        for(const item of parsed.files){
          if(!item || typeof item.path!=="string"|| !/^(r2|supabase-storage)\//.test(item.path)
             || item.path.includes("\\") ||item.path.split("/").some(x=>!x || x===".." || x===".")
             || names.has(item.path) || !Number.isSafeInteger(item.bytes) || item.bytes<0
             || !/^[a-f0-9]{64}$/.test(item.sha256||"")){
            report.issues.push("invalid_asset_entry");continue;
          }
          names.add(item.path);
          if (!actualNames.has(item.path)) { report.issues.push("unreadable_asset"); continue; }
          const p=resolve(root,item.path);
          if (!relative(root,p) || relative(root,p).startsWith("..")){
            report.issues.push("invalid_asset_path");continue;
          }
          try{
            const stat=lstatSync(p);
            if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==item.bytes || digestFile(p)!==item.sha256){
              report.issues.push("file_mismatch");continue;
            }
            report.checkedFiles++;
          }catch(_){report.issues.push("unreadable_asset");}
        }
        if ([...actualNames].some(name=>!names.has(name))) report.issues.push("unmanifested_asset");
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

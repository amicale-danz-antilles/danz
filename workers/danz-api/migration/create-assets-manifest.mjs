// Inventaire SHA256 prive des fichiers telecharges; ne contacte aucun fournisseur.
// Usage: node migration/create-assets-manifest.mjs <private-backup-directory>
// Chemins attends: <root>/r2/<bucket>/<objet> et <root>/supabase-storage/<bucket>/<objet>
// IMPORTANT : aucun fichier ou lien signe ne doit etre commite ou partage.
import { createReadStream, existsSync, readdirSync, lstatSync, writeFileSync, openSync, closeSync, fchmodSync, constants } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

function* walk(directory, root) {
  const entries=readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
  for (const entry of entries){
    const absolute=join(directory,entry.name);
    const stat=lstatSync(absolute);
    if(stat.isSymbolicLink())throw new Error("symlinks_not_allowed");
    if(entry.isDirectory())yield* walk(absolute,root);
    else if(entry.isFile())yield {
      absolute,path:relative(root,absolute).split(sep).join("/"),bytes:stat.size,
    };
    else throw new Error("unsupported_file_type");
  }
}

async function sha256File(file) {
  const hash=createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function createManifest(directory) {
  if (typeof directory!=="string" || !directory) throw new Error("missing_backup_directory");
  const root=resolve(directory);
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error("unsafe_backup_directory");
  const manifest={format:"DANZ-ASSETS-1",files:[]};
  for (const storage of ["r2","supabase-storage"]){
    const folder=join(root,storage);
    if(!existsSync(folder))throw new Error("missing_storage_directory");
    if(!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink())throw new Error("unsafe_storage_directory");
    for(const file of walk(folder,root)){
      manifest.files.push({path:file.path,bytes:file.bytes,sha256:await sha256File(file.absolute)});
    }
  }
  manifest.files.sort((a,b)=>a.path.localeCompare(b.path));
  if(manifest.files.length===0)throw new Error("no_files_in_storage_backup");
  return manifest;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]){console.error("Usage: node migration/create-assets-manifest.mjs <private-directory>");process.exitCode=2;}
  else{
    try{
      const root=resolve(process.argv[2]);
      const manifest=await createManifest(root);
      // Refuse a redirected output and keep an existing manifest private too.
      const fd=openSync(join(root,"assets-manifest.json"),constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);
      try { fchmodSync(fd,0o600); writeFileSync(fd,JSON.stringify(manifest,null,2)+"\n"); }
      finally { closeSync(fd); }
      console.log(JSON.stringify({ok:true,filesHashed:manifest.files.length,manifest:"assets-manifest.json"}));
    }catch(_){
      console.error("Cannot build private file manifest; verify storage copies and permissions");
      process.exitCode=1;
    }
  }
}

#!/usr/bin/env bash
# DANZ — sauvegarde PostgreSQL complete, MANUELLE et PRIVEE depuis macOS.
# A executer uniquement sur un ordinateur et un volume chiffre autorises.
# Usage: bash workers/danz-api/migration/backup-postgres-private-macos.sh "/Volumes/DANZ-SECURISE"
# Le script n'ecrit rien dans Supabase, Cloudflare ou GitHub.
# Il NE sauvegarde PAS les fichiers binaires Supabase Storage/R2 et NE teste PAS la restauration.
set -euo pipefail
set +x
umask 077

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "STOP : ce script guide est reserve a macOS." >&2
  exit 2
fi
if [[ "$#" -ne 1 || ! -d "$1" || -L "$1" ]]; then
  echo "STOP : fournir un dossier de destination prive et deja existant." >&2
  exit 2
fi
for app in pg_dump pg_restore node; do
  if ! command -v "$app" >/dev/null 2>&1; then
    echo "STOP : outil manquant : $app. Installer l'outil sur le poste autorise." >&2
    exit 2
  fi
done
dest="$(cd "$1" && pwd -P)"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# Eviter les sauvegardes par inadvertance dans le checkout GitHub.
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "$repo_root" && ( "$dest" == "$repo_root" || "$dest" == "$repo_root/"* ) ]]; then
  echo "STOP : la destination ne peut pas se trouver dans le depot GitHub." >&2
  exit 2
fi

echo "Une archive peut contenir les identites, mots de passe haches, informations"
echo "de personnels et donnees financieres. Ne la joignez JAMAIS a ChatGPT/GitHub."
echo "Vous devez avoir un disque chiffre, un stockage autorise, et une procedure"
echo "de conservation approuvee avant de proceder."
read -r -p "Confirmez le volume CHIFFRE et autorise (tapez CHIFFRE) : " confirm
if [[ "$confirm" != "CHIFFRE" ]]; then
  echo "STOP : aucune exportation realisee."
  exit 2
fi

# Valeurs saisies directement dans le terminal: pas de secret dans la commande
# shell ni le code source. Ne pas les transmettre dans le chat.
read -r -p "Hote PostgreSQL (Supabase > Connect) : " PGHOST
read -r -p "Port PostgreSQL (5432/6543 selon le mode) : " PGPORT
read -r -p "Utilisateur PostgreSQL : " PGUSER
read -r -p "Base PostgreSQL (habituellement postgres) : " PGDATABASE
if [[ ( "$PGHOST" != *.supabase.com && "$PGHOST" != *.supabase.co ) || "$PGDATABASE" != postgres ||
      ( "$PGHOST" != db.axewfeanyfxkzercafen.supabase.co &&
        "$PGUSER" != *axewfeanyfxkzercafen* ) ||
      ! "$PGPORT" =~ ^[0-9]{2,5}$ ]]; then
  echo "STOP : identite du projet Supabase DANZ ou connexion non confirmee." >&2
  exit 2
fi
read -r -s -p "Mot de passe PostgreSQL (non affiche) : " PGPASSWORD
printf '\n'
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGSSLMODE=require
trap 'unset PGPASSWORD PGHOST PGPORT PGUSER PGDATABASE PGSSLMODE' EXIT

timestamp="$(date -u +'%Y%m%d-%H%M%S')"
backup="$dest/DANZ-BD-PRIVEE-$timestamp"
if [[ -e "$backup" ]]; then
  echo "STOP : une sauvegarde portant ce nom existe deja." >&2
  exit 2
fi
mkdir -m 700 "$backup"
printf '%s\n' 'INCOMPLETE - NE PAS UTILISER COMME SAUVEGARDE VALIDEE' > "$backup/INCOMPLETE.txt"
archive="$backup/danz-postgresql.dump"
catalog="$backup/pgdump-catalog.txt"

echo "Lecture PostgreSQL en cours, vers le support prive uniquement..."
# Le format custom conserve schema, data, politiques, contraintes et proprietaires.
# Une photographie pg_dump unique assure la coherence des tables SQL dans la BD.
pg_dump --format=custom --file="$archive"
pg_restore --list "$archive" > "$catalog"
node "$script_dir/verify-pgdump-toc.mjs" "$catalog"

# Le controle TOC ne prouve ni que les donnees sont recuperables, ni que
# les objets Storage/R2 sont presents sur le volume.
mv "$backup/INCOMPLETE.txt" "$backup/DB_DUMP_STRUCTURE_CHECKED_ONLY.txt"
echo "Archive PostgreSQL creee et catalogue structurel controle."
echo "STOP MIGRATION : restauration isolee, roles globaux, fichiers R2/Storage,"
echo "inventaire distant et chiffrement de la copie independante a valider."

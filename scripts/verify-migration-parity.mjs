import { readFile } from 'node:fs/promises'
import { compareMigrationSnapshots } from './lib/migration-parity.mjs'

// Run only in a private environment. Never commit the input manifests.
const [sourcePath,targetPath]=process.argv.slice(2)
if (!sourcePath || !targetPath) {
  console.error('Usage : node scripts/verify-migration-parity.mjs migration-private/source.json migration-private/target.json')
  process.exit(2)
}
try {
  const source=JSON.parse(await readFile(sourcePath,'utf8'))
  const target=JSON.parse(await readFile(targetPath,'utf8'))
  const result=compareMigrationSnapshots(source,target)
  if (!result.ok) {
    for (const error of result.errors) console.error('ÉCHEC : '+error)
    console.error('Basculement INTERDIT : source et cible ne concordent pas.')
    process.exitCode=1
  } else {
    console.log('Parité vérifiée pour '+result.tableCount+' tables, '+result.accountCount+' identités et '+result.mediaCount+' médias.')
    console.log('Ce contrôle ne remplace ni un test de restauration ni la recette des autorisations.')
  }
} catch (error) {
  console.error('ÉCHEC du contrôle de migration : '+error.message)
  process.exitCode=1
}

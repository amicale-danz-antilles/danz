import test from 'node:test'
import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import { createFinancialXlsx, eur } from '../src/lib/treasuryXlsx.js'
import { buildFinancialSheets } from '../src/lib/treasuryExport.js'

test('un export Excel contient les 15 feuilles et toutes les écritures, même sans solde initial', () => {
  const sheets = buildFinancialSheets({
    entries: [{ id: 'e1', label: '=2+3', kind: 'expense', status: 'pending', amount_cents: 1350, note: 'Courses', category: 'courses',
      payment_method: 'personal_advance', advanced_by_offline: 'o1', occurred_at: '2026-09-20T12:00:00Z', created_at: '2026-09-20T12:00:00Z' }],
    profiles: [{ id: 'p1', active: true, full_name: 'Marie', email: 'm@example.com', is_amicaliste: true, membership_valid_until: '2026-12-31' }],
    offline: [{ id: 'o1', display_name: 'Jean', household_id: 'h1', is_amicaliste: false, linked_user_id: null }],
    households: [{ id: 'h1', name: 'Foyer Jean' }],
    events: [{id:'event1',title:'Soirée Time’s Up',published:false,starts_at:'2026-09-21T18:00:00Z'}],
    eventParticipants: [{event_id:'event1',offline_person_id:'o1'}],
    charges: [{ id: 'c1', household_id: 'h1', offline_person_id: 'o1', status: 'open', event_id: 'event1', category: 'membership', label: 'Cotisation',
      amount_cents: 6000, created_at: '2026-09-20T12:00:00Z' }],
  }, new Date('2026-09-24T12:00:00Z'))
  assert.equal(sheets.length, 15)
  assert.equal(sheets[0].name, 'Synthèse')
  assert.equal(sheets[0].rows.find((r) => r[0] === 'Compte bancaire')[1], 'Non initialisé')
  assert.equal(sheets[0].rows.find((r) => r[0] === 'Créances foyers')[1].euros, 60)
  assert.equal(sheets[0].rows.find((r) => r[0] === 'Avances à rembourser')[1].euros, 13.5)
  assert.equal(sheets.find((s) => s.name === 'Journal complet').rows.length, 1)
  assert.ok(sheets.some((s)=>s.name==='Reprises Excel'))
  assert.ok(sheets.some((s)=>s.name==='Archives BILAN'))
  const events=sheets.find((s)=>s.name==='Bilan par événement')
  assert.equal(events.rows.length,1)
  assert.equal(events.rows[0][0],'Soirée Time’s Up')
  assert.equal(events.rows[0][3],1)
  assert.equal(events.rows[0][9].euros,60)
  const details=sheets.find((s)=>s.name==='Détail par événement')
  assert.equal(details.rows[0][2],'Jean')
  const zip = unzipSync(createFinancialXlsx(sheets))
  assert.equal(Object.keys(zip).filter((f) => /^xl\/worksheets\/sheet\d+.xml$/.test(f)).length, 15)
  const journal = strFromU8(zip['xl/worksheets/sheet2.xml'])
  assert.ok(journal.includes('=2+3'))
  assert.ok(!journal.includes('<f>')) // Ne jamais exécuter des libellés issus des utilisateurs en formule Excel.
  assert.ok(journal.includes('Courses'))
  assert.ok(strFromU8(zip['xl/workbook.xml']).includes('Cotisations et membres'))
  assert.ok(strFromU8(zip['xl/styles.xml']).includes('numFmtId="164"'))
})

test('les cellules financières sont des nombres EUR et non des chaînes approximatives', () => {
  const zip = unzipSync(createFinancialXlsx([{name:'Vérification',headers:['Libellé','Montant'],rows:[['Caisse',eur(12345)]]}]))
  const sheet = strFromU8(zip['xl/worksheets/sheet1.xml'])
  assert.ok(sheet.includes('<v>123.45</v>'))
  assert.ok(sheet.includes('s="2"'))
  assert.ok(sheet.includes('<autoFilter ref="A1:B2"/>'))
})

test('la reprise Excel non ventilée est préservée dans les exports avec ses pièces et dates sources',()=>{
 const batch={id:'batch-1',sha256:'f'.repeat(64),source_filename:'exercice.xlsx',exercise:'2026-2027',opening_cents:11540,income_cents:120750,expense_cents:42155,confirmed_closing_cents:90135,membership_count:22,imported_at:'2026-09-24T15:00:00Z'}
 const sheets=buildFinancialSheets({
   opening:{as_of:'2026-06-13T00:00:00Z',bank_cents:0,cash_cents:0,unassigned_cents:11540},
   entries:[
     {id:'r3',kind:'expense',amount_cents:42155,status:'settled',payment_method:'unassigned',label:'Courses',occurred_at:'2026-09-24T12:00:00Z',source_date:'2026-10-10',needs_review:true,source_row:3,import_batch_id:'batch-1'},
     {id:'r4',kind:'income',amount_cents:120750,status:'settled',payment_method:'unassigned',label:'Cotisations',occurred_at:'2026-09-22T12:00:00Z',source_row:4,import_batch_id:'batch-1'}
   ],
   importBatches:[batch],importArchive:[{batch_id:'batch-1',source_row:2,income_label:'Cotisations ancien exercice',income_cents:277000,expense_label:'Achats anciens',expense_cents:11919}]
 },new Date('2026-09-25T12:00:00Z'))
 const summary=sheets.find((s)=>s.name==='Synthèse')
 assert.equal(summary.rows.find((r)=>r[0]==='Total comptable')[1].euros,901.35)
 assert.equal(summary.rows.find((r)=>r[0]==='À ventiler (Excel)')[1].euros,901.35)
 assert.equal(sheets.find((s)=>s.name==='Archives BILAN').rows.length,1)
 const journal=sheets.find((s)=>s.name==='Journal complet')
 assert.ok(journal.headers.includes('Date Excel originale'))
 assert.ok(journal.rows.some((r)=>r.includes('2026-10-10')))
 assert.equal(unzipSync(createFinancialXlsx(sheets))['xl/worksheets/sheet15.xml']!==undefined,true)
})

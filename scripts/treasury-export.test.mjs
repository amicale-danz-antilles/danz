import test from 'node:test'
import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import { createFinancialXlsx, eur } from '../src/lib/treasuryXlsx.js'
import { buildFinancialSheets } from '../src/lib/treasuryExport.js'
import { buildEditableSheet, previewEditableRows } from '../src/lib/treasuryRoundTrip.js'
import { eventManagementEconomics, eventMembershipAllocation, membershipMonthlyCents, membershipPlanMonths, membershipRecognitionForYear } from '../src/lib/membershipProfitability.js'
import { financialPositionForPerson } from '../src/lib/personFinance.js'


test('le classeur éditable ne propose que les écritures indépendantes et protégées', () => {
  const id='11111111-1111-4111-8111-111111111111'
  const entries=[
    {id,kind:'expense',status:'settled',amount_cents:1200,label:'Courses',category:'courses',payment_method:'cash',occurred_at:'2026-09-26T12:00:00Z'},
    {id:'p',kind:'income',status:'settled',amount_cents:6000,label:'Cotisation',payment_method:'bank_transfer',household_payment_id:'pay-1'},
    {id:'r',kind:'expense',status:'settled',amount_cents:800,label:'Avance remboursée',payment_method:'personal_advance'},
  ]
  const sheet=buildEditableSheet({entries})
  assert.equal(sheet.name,'Écritures modifiables')
  assert.equal(sheet.rows.length,1)
  const row=sheet.rows[0].map((v)=>v&&typeof v==='object'&&'euros' in v?String(v.euros):v)
  row[3]='Courses corrigées'
  row[4]='13,50'
  row[7]=String(Math.round((Date.UTC(2026,8,26)-Date.UTC(1899,11,30))/86400000))
  const preview=previewEditableRows([row],{entries,events:[]})
  assert.equal(preview.problems.length,0)
  assert.equal(preview.changes.length,1)
  assert.deepEqual(preview.changes[0].altered,['label','amountCents'])
  assert.equal(preview.changes[0].next.amountCents,1350)
  assert.equal(previewEditableRows([row],{entries:[{...entries[0],amount_cents:1500}],events:[]}).problems.length,1)
  const xlsx=unzipSync(createFinancialXlsx([sheet]))
  assert.ok(strFromU8(xlsx['xl/worksheets/sheet1.xml']).includes('Écritures modifiables')===false)
  assert.ok(strFromU8(xlsx['xl/worksheets/sheet1.xml']).includes('Référence de contrôle'))
})

test('un export Excel contient les 17 feuilles et toutes les écritures, même sans solde initial', () => {
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
    subscriptions: [{ id: 's1', offline_person_id: 'o1', household_id: 'h1', starts_on: '2026-09-01', ends_on: '2027-08-31',
      amount_cents: 6000, status: 'paid', activated_at: '2026-09-01T10:00:00Z' }],
  }, new Date('2026-09-24T12:00:00Z'))
  assert.equal(sheets.length, 17)
  assert.equal(sheets[0].name, 'Synthèse')
  assert.equal(sheets[0].rows.find((r) => r[0] === 'Revolut')[1], 'Non initialisé')
  assert.equal(sheets[0].rows.find((r) => r[0] === 'Créances foyers')[1].euros, 60)
  assert.equal(sheets[0].rows.find((r) => r[0] === 'Avances à rembourser')[1].euros, 13.5)
  assert.equal(sheets.find((s) => s.name === 'Journal complet').rows.length, 1)
  assert.ok(sheets.some((s)=>s.name==='Reprises Excel'))
  assert.ok(sheets.some((s)=>s.name==='Archives BILAN'))
  assert.ok(sheets.some((s)=>s.name==='Historique corrections'))
  const events=sheets.find((s)=>s.name==='Bilan par événement')
  assert.equal(events.rows.length,1)
  assert.equal(events.rows[0][0],'Soirée Time’s Up')
  assert.equal(events.rows[0][3],1)
  assert.equal(events.rows[0][4],1)
  assert.equal(events.rows[0][5],0)
  assert.equal(events.rows[0][8].euros,0)
  assert.equal(events.rows[0][9].euros,5)
  assert.equal(events.rows[0][10].euros,0)
  assert.equal(events.rows[0][12].euros,0)
  assert.equal(events.rows[0][13].euros,5)
  const annual=sheets.find((s)=>s.name==='Pilotage annuel')
  assert.equal(annual.rows.find((r)=>r[0]==='Cotisations lissées reconnues à date')[1].euros,5)
  const details=sheets.find((s)=>s.name==='Détail par événement')
  assert.equal(details.rows[0][2],'Jean')
  const zip = unzipSync(createFinancialXlsx(sheets))
  assert.equal(Object.keys(zip).filter((f) => /^xl\/worksheets\/sheet\d+.xml$/.test(f)).length, 17)
  const journal = strFromU8(zip['xl/worksheets/sheet2.xml'])
  assert.ok(journal.includes('=2+3'))
  assert.ok(!journal.includes('<f>')) // Ne jamais exécuter des libellés issus des utilisateurs en formule Excel.
  assert.ok(journal.includes('Courses'))
  assert.ok(strFromU8(zip['xl/workbook.xml']).includes('Cotisations et membres'))
  assert.ok(strFromU8(zip['xl/styles.xml']).includes('numFmtId="164"'))
})

test('le lissage de cotisation applique 5 euros par mois aux formules DANZ', () => {
  const annual={amount_cents:6000,starts_on:'2026-01-01',ends_on:'2026-12-31',status:'paid'}
  const short={amount_cents:2000,starts_on:'2026-09-01',ends_on:'2027-09-16',status:'paid'}
  assert.equal(membershipPlanMonths(annual),12)
  assert.equal(membershipMonthlyCents(annual),500)
  assert.equal(membershipPlanMonths(short),4)
  assert.equal(membershipMonthlyCents(short),500)
  assert.equal(membershipRecognitionForYear([short],2026,11),2000)
})

test('un événement vide ne reçoit aucune cotisation et ne crée plus de projection fantôme', () => {
  const events=[
    {id:'oct-1',title:'Oktoberfest',starts_at:'2026-10-09T18:00:00Z'},
    {id:'oct-2',title:'Journée familles',starts_at:'2026-10-17T18:00:00Z'},
  ]
  const subscriptions=Array.from({length:22},(_,i)=>({id:'s'+i,amount_cents:i<5?2000:6000,starts_on:'2026-09-01',ends_on:'2027-09-01',status:'paid'}))
  const data={events,subscriptions,eventParticipants:[],charges:[],entries:[],allocations:[],payments:[],households:[],members:[],profiles:[],offline:[]}
  assert.equal(eventMembershipAllocation(events[0],data),0)
  assert.equal(eventMembershipAllocation(events[1],data),0)
  assert.equal(eventManagementEconomics(events[0],data).projected,0)
})

test('le solde net d’une personne rapproche automatiquement dette et avance sans les effacer', () => {
  const person={id:'u1',personId:'u1',personType:'account'}
  const data={
    charges:[{id:'c1',user_id:'u1',status:'open',amount_cents:3000}],
    payments:[],allocations:[],offline:[],members:[],
    entries:[{id:'e1',payment_method:'personal_advance',advanced_by:'u1',status:'pending',amount_cents:5000}],
  }
  const result=financialPositionForPerson(person,data)
  assert.equal(result.debtCents,3000)
  assert.equal(result.advanceCents,5000)
  assert.equal(result.netCents,2000)
  assert.equal(result.charges.length,1)
  assert.equal(result.advances.length,1)
})

test('une dépense rattachée à un événement entre immédiatement dans son résultat', () => {
  const eventA={id:'evt-a',title:'Repas A',starts_at:'2026-09-20T18:00:00Z'}
  const eventB={id:'evt-b',title:'Repas B',starts_at:'2026-09-21T18:00:00Z'}
  const base={events:[eventA,eventB],charges:[],allocations:[],payments:[],eventParticipants:[],households:[],members:[],profiles:[],offline:[],subscriptions:[]}
  const expense={id:'x1',kind:'expense',status:'settled',payment_method:'bank_transfer',amount_cents:7300,event_id:'evt-a'}
  assert.equal(eventManagementEconomics(eventA,{...base,entries:[expense]}).cost,7300)
  assert.equal(eventManagementEconomics(eventB,{...base,entries:[expense]}).cost,0)
  assert.equal(eventManagementEconomics(eventB,{...base,entries:[{...expense,event_id:'evt-b'}]}).cost,7300)
})

test('une avance personnelle compte immédiatement dans le coût économique de l’événement', () => {
  const event={id:'evt',title:'Repas',starts_at:'2026-09-20T18:00:00Z'}
  const result=eventManagementEconomics(event,{
    events:[event],entries:[{id:'a1',event_id:'evt',kind:'expense',status:'pending',payment_method:'personal_advance',amount_cents:4200}],
    charges:[],allocations:[],payments:[],eventParticipants:[],households:[],members:[],profiles:[],offline:[],subscriptions:[]
  })
  assert.equal(result.cost,4200)
  assert.equal(result.projectedAssociationCost,4200)
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
 assert.equal(unzipSync(createFinancialXlsx(sheets))['xl/worksheets/sheet17.xml']!==undefined,true)
})

test('une annulation et une correction Revolut restent traçables dans la sauvegarde de 17 feuilles',()=>{
  const sheets=buildFinancialSheets({
    opening:{as_of:'2026-09-22T00:00:00Z',bank_cents:25000,cash_cents:4000,unassigned_cents:0},
    entries:[{id:'expense-1',label:'Doublon annulé',kind:'expense',status:'cancelled',
      cancelled_previous_status:'settled',cancel_reason:'Saisie en double',cancelled_at:'2026-09-25T08:00:00Z',
      amount_cents:1500,payment_method:'bank_transfer',occurred_at:'2026-09-23T11:00:00Z'}],
    transfers:[{id:'transfer-1',amount_cents:4200,from_account:'bank',to_account:'cash',
      occurred_at:'2026-09-24T10:00:00Z',cancelled_at:'2026-09-25T08:00:00Z',cancel_reason:'Transfert saisi deux fois'}],
    audit:[{action:'treasury_entry_cancelled',actor_id:'treasurer',created_at:'2026-09-25T08:00:00Z',
      details:{entry_id:'expense-1',reason:'Saisie en double'}}]
  },new Date('2026-09-25T12:00:00Z'))
  assert.equal(sheets.length,17)
  const journal=sheets.find(s=>s.name==='Journal complet')
  assert.ok(journal.headers.includes('Motif annulation'))
  assert.ok(journal.rows[0].includes('Saisie en double'))
  const transfers=sheets.find(s=>s.name==='Transferts internes')
  assert.equal(transfers.rows[0].includes('Annulé'),true)
  assert.equal(sheets.find(s=>s.name==='Historique corrections').rows.length,1)
  assert.equal(sheets.find(s=>s.name==='Synthèse').rows.find(r=>r[0]==='Revolut')[1].euros,250)
  const zip=unzipSync(createFinancialXlsx(sheets))
  assert.ok(zip['xl/worksheets/sheet17.xml'])
})

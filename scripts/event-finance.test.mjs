import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEventGroups, eventOverview, eventPeople } from '../src/lib/eventFinance.js'

const fixture = {
  events: [{ id:'e1',title:'Soirée Time’s Up' }],
  households: [{id:'h1',name:'Foyer Martin'},{id:'h2',name:'Foyer Bernard'}],
  members: [
    {id:'m1',user_id:'u1',household_id:'h1',member_type:'adult'},
    {id:'m2',user_id:'u2',household_id:'h2',member_type:'adult'},
    {id:'c1',household_id:'h1',member_type:'child',display_name:'Enfant Martin',age_category:'6–12 ans'}
  ],
  profiles: [
    {id:'u1',active:true,full_name:'Anne Martin',is_amicaliste:false},
    {id:'u2',active:true,full_name:'Paul Bernard',is_amicaliste:false}
  ],
  offline: [{id:'o1',display_name:'Paul ancien dossier',household_id:'h2',linked_user_id:'u2'}],
  eventParticipants: [
    {event_id:'e1',user_id:'u1'}, {event_id:'e1',household_member_id:'c1'},
    {event_id:'e1',offline_person_id:'o1'}, {event_id:'e1',user_id:'u2'}
  ],
  charges: [
    {id:'ch1',event_id:'e1',household_id:'h1',user_id:'u1',category:'activity',label:'Participation',status:'open',amount_cents:1500},
    {id:'ch2',event_id:'e1',household_id:'h1',household_member_id:'c1',category:'meal',label:'Repas enfant',status:'open',amount_cents:500},
    {id:'ch3',event_id:'e1',household_id:'h2',offline_person_id:'o1',category:'membership',label:'Cotisation',status:'open',amount_cents:2500},
    {id:'ch4',event_id:'e1',household_id:'h2',user_id:'u2',category:'other',label:'Annulation',status:'cancelled',amount_cents:800}
  ],
  payments: [{id:'pay1',status:'confirmed'},{id:'pay2',status:'declared'},{id:'pay3',status:'confirmed'}],
  allocations: [
    {charge_id:'ch1',payment_id:'pay1',amount_cents:700},
    {charge_id:'ch2',payment_id:'pay2',amount_cents:300},
    {charge_id:'ch3',payment_id:'pay3',amount_cents:2500},
  ],
}
test('un événement regroupe les foyers et ne compte que les paiements confirmés',()=>{
  const overview=eventOverview('e1',fixture)
  assert.deepEqual(overview,{total:4500,paid:3200,due:1300,participants:3,households:2,charges:3,memberships:1})
  const groups=buildEventGroups('e1',fixture)
  const martin=groups.find((g)=>g.householdId==='h1')
  assert.equal(martin.due,1300)
  assert.equal(martin.paid,700)
  assert.equal(martin.people.length,2)
  const bernard=groups.find((g)=>g.householdId==='h2')
  assert.equal(bernard.due,0)
  assert.equal(bernard.people.length,1)
  assert.equal(bernard.charges.find((c)=>c.id==='ch4').dueCents,0)
})
test('une ancienne fiche liée au compte réel ne crée pas un participant en double',()=>{
  const {people,byKey}=eventPeople(fixture)
  assert.equal(people.filter((p)=>p.name==='Paul Bernard').length,1)
  assert.equal(byKey['offline:o1'].key,'account:u2')
  assert.equal(eventOverview('e2',fixture).participants,0)
})

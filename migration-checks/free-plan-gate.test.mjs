import test from 'node:test'
import assert from 'node:assert/strict'
import {evaluateFreePlan} from './free-plan-gate.mjs'
const synthetic={workersPlan:'free',paidProductsDisabled:true,storageCostCapVerified:true,measuredAccountWide:true,workerRequestsDay:1000,d1RowsReadDay:10000,d1RowsWrittenDay:1000,d1BytesTotal:1000000,workerCpuMsPerInvocation:4}
test('synthetic measured scenario below thresholds passes',()=>assert.equal(evaluateFreePlan(synthetic).ok,true))
test('unknown metrics and unverified billing fail closed',()=>{
 assert.equal(evaluateFreePlan({}).ok,false)
 assert.equal(evaluateFreePlan({...synthetic,storageCostCapVerified:false}).ok,false)
 assert.equal(evaluateFreePlan({...synthetic,workersPlan:'paid'}).ok,false)
})
test('CPU and account-wide quota headroom enforced',()=>{
 for(const [key,value] of [['workerCpuMsPerInvocation',8],['d1RowsReadDay',4000000],['d1RowsWrittenDay',80000],['workerRequestsDay',80000],['d1BytesTotal',4000000000]])assert.equal(evaluateFreePlan({...synthetic,[key]:value}).ok,false)
})

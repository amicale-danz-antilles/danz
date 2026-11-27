// Planning gate, never provisions cloud services or enables paid plans.
// Inputs must come from current account-wide measurements, not estimates alone.
export const limits=Object.freeze({workerRequestsDay:100000,d1RowsReadDay:5000000,d1RowsWrittenDay:100000,d1BytesTotal:5000000000,d1LargestDatabaseBytes:500000000,d1DatabaseCount:10,d1QueriesPerInvocation:50,workerCpuMsPerInvocation:10})
export function evaluateFreePlan(measurements){
 const problems=[]
 if(measurements?.workersPlan!=='free')problems.push('workers_free_plan_not_verified')
 if(measurements?.paidProductsDisabled!==true)problems.push('paid_products_not_verified')
 if(measurements?.storageCostCapVerified!==true)problems.push('storage_cost_cap_not_verified')
 if(measurements?.measuredAccountWide!==true)problems.push('account_wide_metrics_not_verified')
 const metrics=[]
 for(const [key,limit] of Object.entries(limits)){
  const value=measurements?.[key]
  if(typeof value!=='number'||!Number.isFinite(value)||value<0){problems.push('missing_or_invalid:'+key);continue}
  const threshold=limit*0.8
  if(value>=threshold)problems.push('insufficient_headroom:'+key)
  metrics.push({key,value,limit,threshold})
 }
 return {ok:problems.length===0,problems,metrics}
}

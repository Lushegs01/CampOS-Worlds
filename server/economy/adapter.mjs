/**
 * @typedef {{schema:string,runIds:string[],runs:object[],limitations:string[]}} WorkEvidence
 * @typedef {{status:'not-connected',externalRecord:null,reason:string}} ExternalReceipt
 * @typedef {{evaluate:(evidence:WorkEvidence)=>Promise<ExternalReceipt>}} WorkStreamAdapter
 * No authorized WorkStream contract is present in this repository. This boundary sends nothing.
 */
/** @type {WorkStreamAdapter} */
export const localOnlyAdapter = Object.freeze({
 async evaluate(evidence) {
  if(evidence?.schema!=='campos.economic-lab/1'||!Array.isArray(evidence.runs)||!Array.isArray(evidence.runIds))throw Error('Unsupported evidence schema');
  return {status:'not-connected',externalRecord:null,reason:'Local prototype evidence only. No WorkStream contract, external acceptance, validation or funded reward is configured.'};
 }
});

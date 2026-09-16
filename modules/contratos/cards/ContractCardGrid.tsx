import type {BillingContract} from '../types';
import {ContractCard} from './ContractCard';

export function ContractCardGrid({contracts}:{contracts:BillingContract[]}){
 return <div className="contract-card-grid">{contracts.map(contract=><ContractCard key={contract.id} contract={contract}/>)}</div>;
}

import {useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {PlotFarmList} from './PlotFarmList';
import {FarmPlotsPage} from './FarmPlotsPage';
export function TalhoesPage(){const {searchParams}=useModuleNavigation();const farmId=searchParams.get('fazenda');return farmId?<FarmPlotsPage key={farmId} farmId={farmId}/>:<PlotFarmList/>;}

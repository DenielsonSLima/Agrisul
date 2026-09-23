'use client';

import {useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {QuoteCreatePage} from './QuoteCreatePage';
import {QuoteDetailPage} from './QuoteDetailPage';
import {QuoteList} from './QuoteList';
import '../styles.css';

export function CotacaoPage(){
 const {searchParams}=useModuleNavigation();
 const selectedId=searchParams.get('cotacao');
 if(selectedId)return <QuoteDetailPage key={selectedId} id={selectedId}/>;
 return <><QuoteList/>{searchParams.get('nova')==='1'&&<QuoteCreatePage/>}</>;
}

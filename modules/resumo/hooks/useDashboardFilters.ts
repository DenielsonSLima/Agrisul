'use client';
import {useState} from 'react';
import {defaultRange} from '../filters';
import type {DashboardDefaultPeriod} from '../defaultPeriod';
import type {SummaryFilters} from '../types';

export function useDashboardFilters(defaultPeriod:DashboardDefaultPeriod){
 const [period,setPeriod]=useState(defaultPeriod);
 const [filters,setFilters]=useState<SummaryFilters>(()=>defaultRange(defaultPeriod));
 const [draft,setDraft]=useState<SummaryFilters>(()=>defaultRange(defaultPeriod));
 // Restore hydrated/account-scoped preferences before querying with the new range.
 // Date edits remain temporary; a preference change preserves dimension filters.
 if(period!==defaultPeriod){
  const {from,to}=defaultRange(defaultPeriod);
  setPeriod(defaultPeriod);
  setFilters(value=>({...value,from,to}));
  setDraft(value=>({...value,from,to}));
 }
 return {filters,setFilters,draft,setDraft};
}

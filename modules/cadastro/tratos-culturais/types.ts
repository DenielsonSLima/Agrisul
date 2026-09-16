export type ManagementCategory='soil-preparation'|'cultural-practices';

export const managementCategories:readonly {value:ManagementCategory;label:string;operations:readonly string[]}[]=[
 {value:'soil-preparation',label:'Preparar solo',operations:['Subsolagem','Gradagem','Calagem','Gessagem','Adubação de plantio','Sulcamento','Plantio']},
 {value:'cultural-practices',label:'Tratos culturais',operations:['Operações pós-colheita','Adubação de cobertura','Adubação da soqueira','Irrigação','Manejo da palhada','Controle de plantas daninhas','Controle de pragas','Controle de doenças','Correções e intervenções necessárias']},
] as const;

export type ManagementCatalogEntry={
 category:ManagementCategory;
 categoryLabel:string;
 name:string;
 position:number;
};

export type PracticeInput={
 cultureId:string;
 cultureSubtypeId:string;
 category:ManagementCategory;
 name:string;
 description:string;
};
export type CulturalPractice=PracticeInput&{
 id:string;
 cultureName:string;
 cultureSubtypeName:string;
 createdAt:string;
 updatedAt:string;
};

export type ManagementList={
 practices:CulturalPractice[];
 catalog:ManagementCatalogEntry[];
};

export type SugarcaneBootstrapResult={
 culture:{id:string;name:string};
 subtypes:{id:string;name:string}[];
 focus:{cultureId:string;cultureSubtypeId:string};
 created:{cultures:number;subtypes:number;practices:number};
 totalPractices:number;
};

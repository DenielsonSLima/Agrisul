import {sql} from "drizzle-orm";
import {sqliteTable,text,integer,index,uniqueIndex,check} from "drizzle-orm/sqlite-core";
export const companies=sqliteTable("companies",{
 id:text("id").primaryKey(), ownerId:text("owner_id").notNull(), name:text("name").notNull(),
 cnpj:text("cnpj").notNull().default(""), isPrimary:integer("is_primary").notNull().default(0),
 apiService:text("api_service").notNull().default(""), apiKeyCiphertext:text("api_key_ciphertext"),
 legalName:text("legal_name").notNull().default(""),
 tradeName:text("trade_name").notNull().default(""),
 street:text("street").notNull().default(""),
 number:text("number").notNull().default(""),
 complement:text("complement").notNull().default(""),
 district:text("district").notNull().default(""),
 city:text("city").notNull().default(""),
 state:text("state").notNull().default(""),
 zipCode:text("zip_code").notNull().default(""),
 phone:text("phone").notNull().default(""),
 email:text("email").notNull().default(""),
 createdAt:text("created_at").notNull(), updatedAt:text("updated_at").notNull()
},table=>[
 index("idx_companies_owner").on(table.ownerId),
 uniqueIndex("idx_companies_one_primary").on(table.ownerId).where(sql`${table.isPrimary}=1`),
 uniqueIndex("idx_companies_owner_cnpj").on(table.ownerId,table.cnpj).where(sql`${table.cnpj}<>''`),
 check("companies_primary_boolean",sql`${table.isPrimary} in (0,1)`)
]);

export const watermarks=sqliteTable("watermarks",{
 ownerId:text("owner_id").primaryKey(),
 orientation:text("orientation").notNull().default("portrait"),
 opacity:integer("opacity").notNull().default(15),
 size:integer("size").notNull().default(60),
 imageKey:text("image_key"),imageName:text("image_name").notNull().default(""),
 updatedAt:text("updated_at").notNull()
},table=>[
 check("watermark_orientation",sql`${table.orientation} in ('portrait','landscape')`),
 check("watermark_opacity",sql`${table.opacity} between 0 and 100`),
 check("watermark_size",sql`${table.size} between 10 and 100`)
]);

export const clients=sqliteTable("clients",{
 id:text("id").primaryKey(),ownerId:text("owner_id").notNull(),
 legalName:text("legal_name").notNull().default(""),
 tradeName:text("trade_name").notNull().default(""),
 cnpj:text("cnpj").notNull().default(""),
 street:text("street").notNull().default(""),
 number:text("number").notNull().default(""),
 complement:text("complement").notNull().default(""),
 district:text("district").notNull().default(""),
 city:text("city").notNull().default(""),
 state:text("state").notNull().default(""),
 zipCode:text("zip_code").notNull().default(""),
 phone:text("phone").notNull().default(""),
 email:text("email").notNull().default(""),
 createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},table=>[
 uniqueIndex("idx_clients_owner_cnpj").on(table.ownerId,table.cnpj)
]);

export const atrRecords=sqliteTable("atr_records",{
 id:text("id").primaryKey(),ownerId:text("owner_id").notNull(),
 year:integer("year").notNull(),month:integer("month").notNull(),value:text("value").notNull(),
 createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},table=>[
 uniqueIndex("idx_atr_owner_year_month").on(table.ownerId,table.year,table.month),
 check("atr_month_range",sql`${table.month} between 1 and 12`),
 check("atr_year_range",sql`${table.year} between 1900 and 9999`)
]);

export const farms=sqliteTable("farms",{
 id:text("id").primaryKey(),ownerId:text("owner_id").notNull(),name:text("name").notNull(),
 areaHa:text("area_ha").notNull(),city:text("city").notNull(),state:text("state").notNull(),
 createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},table=>[index("idx_farms_owner").on(table.ownerId)]);

export const farmPlots=sqliteTable("farm_plots",{
 id:text("id").primaryKey(),farmId:text("farm_id").notNull().references(()=>farms.id,{onDelete:"cascade"}),
 name:text("name").notNull(),areaUnits:integer("area_units").notNull(),
 createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},table=>[
 uniqueIndex("idx_plots_farm_name").on(table.farmId,table.name),
 check("plot_area_positive",sql`${table.areaUnits}>0 AND ${table.areaUnits}<=999999999999999`)
]);

export const contractTypes=sqliteTable("contract_types",{
 id:text("id").primaryKey(),ownerId:text("owner_id").notNull(),name:text("name").notNull(),nameKey:text("name_key").notNull(),
 stagesJson:text("stages_json").notNull().default("[]"),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},table=>[uniqueIndex("idx_contract_types_owner_name").on(table.ownerId,table.nameKey)]);

export const cultures=sqliteTable("cultures",{
 id:text("id").primaryKey(),ownerId:text("owner_id").notNull(),name:text("name").notNull(),nameKey:text("name_key").notNull(),
 createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},table=>[uniqueIndex("idx_cultures_owner_name").on(table.ownerId,table.nameKey)]);
export const cultureSubtypes=sqliteTable("culture_subtypes",{
 id:text("id").primaryKey(),cultureId:text("culture_id").notNull().references(()=>cultures.id,{onDelete:"cascade"}),
 name:text("name").notNull(),nameKey:text("name_key").notNull(),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},table=>[uniqueIndex("idx_culture_subtypes_culture_name").on(table.cultureId,table.nameKey)]);

export const culturalPractices=sqliteTable("cultural_practices",{
 id:text("id").primaryKey(),ownerId:text("owner_id").notNull(),name:text("name").notNull(),nameKey:text("name_key").notNull(),
 description:text("description").notNull().default(""),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},table=>[uniqueIndex("idx_practices_owner_name").on(table.ownerId,table.nameKey)]);

export const billingContracts=sqliteTable("billing_contracts",{
 id:text("id").primaryKey(),ownerId:text("owner_id").notNull(),title:text("title").notNull(),
 clientId:text("client_id").notNull().references(()=>clients.id),typeId:text("type_id").notNull().references(()=>contractTypes.id),
 typeName:text("type_name").notNull(),stagesJson:text("stages_json").notNull().default("[]"),
 status:text("status").notNull().default("Rascunho"),startDate:text("start_date").notNull().default(""),endDate:text("end_date").notNull().default(""),
 value:text("value").notNull().default(""),notes:text("notes").notNull().default(""),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},table=>[index("idx_billing_contracts_owner").on(table.ownerId),check("billing_contract_status",sql`${table.status} in ('Rascunho','Ativo','Concluído','Cancelado')`)]);

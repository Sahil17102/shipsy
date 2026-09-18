import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const demoLeads=sqliteTable('demo_leads',{id:integer('id').primaryKey({autoIncrement:true}),name:text('name').notNull(),email:text('email').notNull(),company:text('company').notNull(),volume:text('volume').notNull(),createdAt:text('created_at').notNull()});

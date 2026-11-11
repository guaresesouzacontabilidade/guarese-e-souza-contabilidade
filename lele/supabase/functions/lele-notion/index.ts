// Ponto de entrada no Supabase (Deno). A lógica fica em handler.js (testada no Node).
import { createHandler, createRestDb } from './handler.js';

const env = Deno.env.toObject();
const db = createRestDb({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl: fetch });

Deno.serve(createHandler({ env, db }));

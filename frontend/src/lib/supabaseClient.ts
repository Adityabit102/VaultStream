import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'your-anon-key';

export const isSupabaseMock = !supabaseUrl || supabaseUrl.includes('your-project') || !supabaseAnonKey || supabaseAnonKey.includes('your-anon-key');

// Create real client only if valid credentials exist
export const supabase = !isSupabaseMock ? createClient(supabaseUrl, supabaseAnonKey) : null;

console.log(`Supabase client initialized. Mode: ${isSupabaseMock ? 'MOCK' : 'PRODUCTION'}`);

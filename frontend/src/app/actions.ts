'use server';
import { createClient } from '@supabase/supabase-js';

export async function takeAction(alertId: string, action: 'freeze' | 'escalate', token: string, analystId?: string) {
    console.log(`Action ${action} taken for alert ${alertId} by analyst ${analystId}`);
    
    try {
        const backendUrl = (process.env.NEXT_PUBLIC_HTTP_API_URL || 'http://localhost:8000') + `/v1/alerts/${alertId}`;
        const response = await fetch(backendUrl, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ action_taken: action }),
        });
        if (!response.ok) {
            throw new Error(`Failed to record action on backend: ${response.statusText}`);
        }
        
        // Audit events write
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co';
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'your-anon-key';
        const isMock = !supabaseUrl || supabaseUrl.includes('your-project') || !supabaseAnonKey || supabaseAnonKey.includes('your-anon-key');

        if (!isMock) {
            const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
            const { error: dbError } = await supabaseClient
                .from('audit_events')
                .insert([
                    {
                        analyst_id: analystId || 'mock_analyst',
                        alert_id: alertId,
                        action: action,
                        timestamp: new Date().toISOString()
                    }
                ]);
            if (dbError) {
                console.error("Supabase audit_events insert failed:", dbError.message);
            }
        } else {
            console.log(`[MOCK AUDIT] Created audit log: user ${analystId || 'mock_analyst'} executed '${action}' on alert ${alertId}`);
        }

        return { success: true, action, alertId };
    } catch (err) {
        console.error("Error calling backend takeAction:", err);
        return { success: false, error: String(err) };
    }
}

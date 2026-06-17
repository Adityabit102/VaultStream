'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { supabase } from '@/lib/supabaseClient';

type RoleType = 'analyst' | 'admin' | 'viewer' | null;

type RoleContextType = {
  role: RoleType;
  isAnalyst: boolean;
  isAdmin: boolean;
  isViewer: boolean;
  isAuthenticated: boolean;
  loading: boolean;
};

const RoleContext = createContext<RoleContextType | undefined>(undefined);

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, isMock } = useAuth();
  const [role, setRole] = useState<RoleType>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    const fetchRole = async () => {
      if (!user) {
        setRole(null);
        setLoading(false);
        return;
      }

      if (isMock) {
        setRole(user.role);
        setLoading(false);
      } else if (supabase) {
        try {
          const { data, error } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', user.id)
            .single();
          
          if (data && !error) {
            setRole(data.role as RoleType);
          } else {
            console.warn("Could not fetch user role from DB, defaulting to viewer:", error);
            setRole('viewer');
          }
        } catch (e) {
          console.error("Error fetching user role:", e);
          setRole('viewer');
        } finally {
          setLoading(false);
        }
      } else {
        setRole('viewer');
        setLoading(false);
      }
    };

    fetchRole();
  }, [user, authLoading, isMock]);

  const value = {
    role,
    isAnalyst: role === 'analyst',
    isAdmin: role === 'admin',
    isViewer: role === 'viewer',
    isAuthenticated: user !== null,
    loading: authLoading || loading
  };

  return (
    <RoleContext.Provider value={value}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const context = useContext(RoleContext);
  if (context === undefined) {
    throw new Error('useRole must be used within a RoleProvider');
  }
  return context;
}

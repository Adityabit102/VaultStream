'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase, isSupabaseMock } from '@/lib/supabaseClient';

export type UserSession = {
  email: string;
  role: 'analyst' | 'admin' | 'viewer';
  id: string;
};

type AuthContextType = {
  user: UserSession | null;
  loading: boolean;
  signOut: () => Promise<void>;
  signInMock: (email: string, role: 'analyst' | 'admin' | 'viewer') => void;
  isMock: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isSupabaseMock) {
      // Load mock session from localStorage
      const mockEmail = localStorage.getItem('vaultstream_mock_email');
      const mockRole = localStorage.getItem('vaultstream_mock_role') as UserSession['role'] | null;
      const mockId = localStorage.getItem('vaultstream_mock_id');
      
      if (mockEmail && mockRole && mockId) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUser({ email: mockEmail, role: mockRole, id: mockId });
      }
      setLoading(false);
    } else if (supabase) {
      // Production Supabase Auth Listener
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          const email = session.user.email || '';
          const role = email.includes('admin') ? 'admin' : email.includes('viewer') ? 'viewer' : 'analyst';
          setUser({ email, role, id: session.user.id });
        }
        setLoading(false);
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          const email = session.user.email || '';
          const role = email.includes('admin') ? 'admin' : email.includes('viewer') ? 'viewer' : 'analyst';
          setUser({ email, role, id: session.user.id });
        } else {
          setUser(null);
        }
        setLoading(false);
      });

      return () => {
        subscription.unsubscribe();
      };
    }
  }, []);

  const signInMock = (email: string, role: 'analyst' | 'admin' | 'viewer') => {
    const mockId = `mock_user_${Math.floor(Math.random() * 100000)}`;
    localStorage.setItem('vaultstream_mock_email', email);
    localStorage.setItem('vaultstream_mock_role', role);
    localStorage.setItem('vaultstream_mock_id', mockId);
    setUser({ email, role, id: mockId });
  };

  const signOut = async () => {
    if (isSupabaseMock) {
      localStorage.removeItem('vaultstream_mock_email');
      localStorage.removeItem('vaultstream_mock_role');
      localStorage.removeItem('vaultstream_mock_id');
      setUser(null);
    } else if (supabase) {
      await supabase.auth.signOut();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut, signInMock, isMock: isSupabaseMock }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

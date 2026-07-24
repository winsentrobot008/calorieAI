"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthContextValue {
  user: User | null;
  login: (userId: string, email: string, name?: string) => void;
  logout: () => void;
  isLoggedIn: boolean;
  loading: boolean;
  setLoading: (v: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadUser(): User | null {
  if (typeof window === "undefined") return null;
  const uid = localStorage.getItem("user_id");
  if (!uid) return null;
  return { id: uid, email: localStorage.getItem("user_email") || "", name: localStorage.getItem("user_name") || "" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setUser(loadUser());
    setMounted(true);
  }, []);

  const login = useCallback((userId: string, email: string, name?: string) => {
    localStorage.setItem("user_id", userId);
    localStorage.setItem("user_email", email || "");
    if (name) localStorage.setItem("user_name", name);
    setUser({ id: userId, email: email || "", name: name || "" });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("user_id");
    localStorage.removeItem("user_email");
    localStorage.removeItem("user_name");
    setUser(null);
  }, []);

  if (!mounted) return <>{children}</>;

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoggedIn: !!user, loading, setLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

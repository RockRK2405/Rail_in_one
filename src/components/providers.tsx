'use client';

import * as React from 'react';
import { AuthProvider } from './auth-provider';
import { ToastProvider } from './ui/toast';

/** Client-side context providers wired once at the app root. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>{children}</ToastProvider>
    </AuthProvider>
  );
}

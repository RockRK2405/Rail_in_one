'use client';

import * as React from 'react';
import { Button } from './ui/button';

interface State {
  error: Error | null;
}

/** Client-side error boundary — catches render errors in the tree below. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  State
> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught', error);
  }

  override render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
            <p className="text-sm font-medium">Something went wrong.</p>
            <p className="mt-1 text-sm text-muted-foreground">{this.state.error.message}</p>
            <Button className="mt-4" size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

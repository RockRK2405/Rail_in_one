'use client';

import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/auth-provider';

export default function ProfilePage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
      </div>
    );
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-md rounded-lg border p-6 text-center">
        <p className="text-sm">You are not signed in.</p>
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    router.push('/');
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
      <Card>
        <CardHeader>
          <CardTitle>{user.fullName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label="Email" value={user.email} />
          <Field
            label="Role"
            value={
              <Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'}>{user.role}</Badge>
            }
          />
          <Field label="Account id" value={<span className="font-mono text-xs">{user.id}</span>} />
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button variant="outline" onClick={handleLogout}>
          Log out
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b py-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

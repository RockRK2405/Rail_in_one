import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminDashboardPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">Admin dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Venues &amp; seat layouts</CardTitle>
          <CardDescription>
            Full venue / seat-category / seat-layout management UI arrives in Phase 3. The admin API
            (<code>GET</code>/<code>POST /api/admin/venues</code>) is live and ADMIN-protected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sign in as the seeded admin to exercise these endpoints.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

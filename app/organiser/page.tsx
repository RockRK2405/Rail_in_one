import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function OrganiserDashboardPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">Organiser dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your events</CardTitle>
          <CardDescription>
            Event, show, and pricing management plus revenue analytics arrive in Phase 3. The
            organiser API (<code>GET /api/organiser/events</code>, <code>POST /api/events</code>) is
            already live and role-protected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sign in as the seeded organiser to exercise these endpoints.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

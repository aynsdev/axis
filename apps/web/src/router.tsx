import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { AppShell } from '@/components/shell';
import { useLiveUpdates } from '@/lib/live';
import { NewTaskPage } from '@/pages/new-task';
import { OverviewPage } from '@/pages/overview';
import { ReposPage } from '@/pages/repos';
import { SessionsPage } from '@/pages/sessions';
import { SettingsPage } from '@/pages/settings';
import { Toaster } from '@/components/toaster';
import { TaskDetailPage } from '@/pages/task-detail';
import { TasksPage } from '@/pages/tasks';
import { UsagePage } from '@/pages/usage';
import { WorkspacePage } from '@/pages/workspace';

function Root() {
  const connection = useLiveUpdates();
  return (
    <>
      <AppShell connection={connection}>
        <Outlet />
      </AppShell>
      <Toaster />
    </>
  );
}

const root = createRootRoute({ component: Root });

const taskRoute = createRoute({
  getParentRoute: () => root,
  path: '/tasks/$taskId',
  component: function TaskRoute() {
    const { taskId } = taskRoute.useParams();
    return <TaskDetailPage key={taskId} taskId={taskId} />;
  },
});

const routes = [
  createRoute({ getParentRoute: () => root, path: '/', component: OverviewPage }),
  createRoute({ getParentRoute: () => root, path: '/workspace', component: WorkspacePage }),
  createRoute({ getParentRoute: () => root, path: '/tasks', component: TasksPage }),
  createRoute({ getParentRoute: () => root, path: '/tasks/new', component: NewTaskPage }),
  taskRoute,
  createRoute({ getParentRoute: () => root, path: '/sessions', component: SessionsPage }),
  createRoute({ getParentRoute: () => root, path: '/usage', component: UsagePage }),
  createRoute({ getParentRoute: () => root, path: '/repos', component: ReposPage }),
  createRoute({ getParentRoute: () => root, path: '/settings', component: SettingsPage }),
];

export const router = createRouter({
  routeTree: root.addChildren(routes),
  // The content inset, not the document, owns scrolling.
  scrollRestoration: true,
  scrollToTopSelectors: ['#content'],
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

import { Route, Switch, Redirect, useLocation } from "wouter";
import { isAdmin, useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import { Spinner } from "@/components/ui";
import LoginPage from "@/pages/LoginPage";
import LibraryPage from "@/pages/LibraryPage";
import WatchPage from "@/pages/WatchPage";
import ReviewsPage from "@/pages/admin/ReviewsPage";
import VideosPage from "@/pages/admin/VideosPage";
import GroupsPage from "@/pages/admin/GroupsPage";
import UsersPage from "@/pages/admin/UsersPage";
import CategoriesPage from "@/pages/admin/CategoriesPage";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) return <Spinner label="Opening the screening room…" />;
  if (!user) {
    setLocation("/login");
    return null;
  }
  return <Layout>{children}</Layout>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!isAdmin(user)) return <Redirect to="/" />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/">
        <Protected>
          <LibraryPage />
        </Protected>
      </Route>
      <Route path="/watch/:id">
        <Protected>
          <WatchPage />
        </Protected>
      </Route>
      <Route path="/admin/reviews">
        <Protected>
          <AdminOnly>
            <ReviewsPage />
          </AdminOnly>
        </Protected>
      </Route>
      <Route path="/admin/videos">
        <Protected>
          <AdminOnly>
            <VideosPage />
          </AdminOnly>
        </Protected>
      </Route>
      <Route path="/admin/groups">
        <Protected>
          <AdminOnly>
            <GroupsPage />
          </AdminOnly>
        </Protected>
      </Route>
      <Route path="/admin/users">
        <Protected>
          <AdminOnly>
            <UsersPage />
          </AdminOnly>
        </Protected>
      </Route>
      <Route path="/admin/categories">
        <Protected>
          <AdminOnly>
            <CategoriesPage />
          </AdminOnly>
        </Protected>
      </Route>
      <Route>
        <Redirect to="/" />
      </Route>
    </Switch>
  );
}

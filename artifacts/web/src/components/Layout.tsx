import { clsx } from "clsx";
import {
  FolderOpen,
  Languages,
  LayoutGrid,
  Library,
  LogOut,
  Tags,
  UserCog,
  Users,
  ClipboardCheck,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";
import { isAdmin, useAuth } from "@/lib/auth";
import { useI18n, useT, type I18nKey } from "@/lib/i18n";
import { Badge } from "./ui";

interface NavItem {
  href: string;
  labelKey: I18nKey;
  icon: typeof Library;
}

const memberNav: NavItem[] = [{ href: "/", labelKey: "nav.library", icon: Library }];

const adminNav: NavItem[] = [
  { href: "/admin/reviews", labelKey: "nav.reviewQueue", icon: ClipboardCheck },
  { href: "/admin/videos", labelKey: "nav.videos", icon: LayoutGrid },
  { href: "/admin/groups", labelKey: "nav.groups", icon: Users },
  { href: "/admin/users", labelKey: "nav.members", icon: UserCog },
  { href: "/admin/categories", labelKey: "nav.categories", icon: Tags },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const t = useT();
  const { locale, setLocale } = useI18n();
  const admin = isAdmin(user);

  const nav = admin ? [...memberNav, ...adminNav] : memberNav;

  const renderLink = (item: NavItem) => {
    const active =
      item.href === "/" ? location === "/" : location.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={clsx(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          active
            ? "bg-ember-soft text-ember"
            : "text-muted hover:bg-panel-2 hover:text-bone",
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
        {t(item.labelKey)}
      </Link>
    );
  };

  return (
    <div className="app-glow flex min-h-full">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-e border-line bg-panel/60">
        <div className="border-b border-line px-5 py-6">
          <div className="font-display text-2xl font-semibold tracking-tight text-bone">
            Heiba
          </div>
          <div className="mt-1 font-mono text-[10px] tracking-[0.3em] text-muted uppercase">
            {t("brand.tagline")}
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {admin ? (
            <>
              <div className="px-3 pt-2 pb-1 font-mono text-[10px] tracking-widest text-muted/60 uppercase">
                {t("nav.watch")}
              </div>
              {memberNav.map(renderLink)}
              <div className="px-3 pt-4 pb-1 font-mono text-[10px] tracking-widest text-muted/60 uppercase">
                {t("nav.manage")}
              </div>
              {adminNav.map(renderLink)}
            </>
          ) : (
            nav.map(renderLink)
          )}
        </nav>
        <div className="border-t border-line p-3">
          <div className="mb-2 flex items-center justify-between gap-2 px-3">
            <div className="min-w-0">
              <div className="truncate text-sm text-bone">{user?.email}</div>
              <Badge tone={user?.role === "OWNER" ? "ember" : "neutral"} className="mt-1">
                {user?.role ? t(`role.${user.role}`) : null}
              </Badge>
            </div>
            <button
              onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-bone"
              title={t("common.language")}
            >
              <Languages className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("common.language")}
            </button>
          </div>
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-danger"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            {t("auth.signOut")}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}

export function PageHeader({
  kicker,
  title,
  actions,
}: {
  kicker: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="font-mono text-[11px] tracking-[0.3em] text-ember uppercase">
          {kicker}
        </div>
        <h1 className="mt-1 font-display text-4xl font-medium tracking-tight text-bone">
          {title}
        </h1>
      </div>
      {actions}
    </div>
  );
}

export { FolderOpen };

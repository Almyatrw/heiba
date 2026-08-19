import {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCurrentUserQueryKey,
  useGetCurrentUser,
  useLogin,
  useLogout,
  type LoginInput,
  type User,
} from "@workspace/api-client-react";

export function isAdmin(user: User | null | undefined) {
  return user?.role === "OWNER" || user?.role === "ADMIN";
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false, staleTime: 60_000 },
  });

  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  const login = useCallback(
    async (input: LoginInput) => {
      await loginMutation.mutateAsync({ data: input });
      await queryClient.invalidateQueries();
    },
    [loginMutation, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      queryClient.clear();
    }
  }, [logoutMutation, queryClient]);

  const user = me.data?.user ?? null;
  // A 401 on /auth/me means "logged out", not "still loading"
  const isLoading = me.isLoading;

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Pulls a human message out of the plain-Error thrown by customFetch. */
export function apiErrorMessage(err: unknown, fallback = "Something went wrong") {
  if (!(err instanceof Error)) return fallback;
  const text = err.message;
  const match = /(\{.*\})\s*$/.exec(text);
  if (match) {
    try {
      const body = JSON.parse(match[1]) as { message?: string };
      if (body.message) return body.message;
    } catch {
      /* fall through */
    }
  }
  if (text.includes("Fetch error: 401")) return "Invalid email or password";
  if (text.includes("Fetch error: 403")) return "You do not have access";
  return fallback;
}

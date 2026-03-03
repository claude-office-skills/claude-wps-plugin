import { useState, useCallback } from "react";

export interface PermissionStatus {
  granted: boolean;
  app: string;
  settingsPath: string;
  description: string;
  error?: string;
  errorDetail?: string;
}

export interface LocalAccessState {
  checking: boolean;
  executing: boolean;
  permissions: Record<string, PermissionStatus>;
  lastResult: unknown | null;
  lastError: string | null;
}

const INITIAL: LocalAccessState = {
  checking: false,
  executing: false,
  permissions: {},
  lastResult: null,
  lastError: null,
};

export function useLocalAccess() {
  const [state, setState] = useState<LocalAccessState>(INITIAL);

  const checkAllPermissions = useCallback(async () => {
    setState((s) => ({ ...s, checking: true, lastError: null }));
    try {
      const res = await fetch("/local/permissions");
      const data = await res.json();
      setState((s) => ({
        ...s,
        checking: false,
        permissions: data.permissions ?? {},
      }));
      return data.permissions;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, checking: false, lastError: msg }));
      return null;
    }
  }, []);

  const checkPermission = useCallback(async (capability: string) => {
    setState((s) => ({ ...s, checking: true, lastError: null }));
    try {
      const res = await fetch("/local/permissions/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability }),
      });
      const data = await res.json();
      setState((s) => ({
        ...s,
        checking: false,
        permissions: { ...s.permissions, [capability]: data },
      }));
      return data as PermissionStatus;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, checking: false, lastError: msg }));
      return null;
    }
  }, []);

  const requestPermission = useCallback(async (capability: string) => {
    try {
      const res = await fetch("/local/permissions/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability }),
      });
      const data = await res.json();
      if (data.granted) {
        setState((s) => ({
          ...s,
          permissions: {
            ...s.permissions,
            [capability]: { ...s.permissions[capability], granted: true },
          },
        }));
      }
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, lastError: msg }));
      return null;
    }
  }, []);

  const executeAction = useCallback(
    async (action: string, params: Record<string, unknown> = {}) => {
      setState((s) => ({
        ...s,
        executing: true,
        lastResult: null,
        lastError: null,
      }));
      try {
        const res = await fetch("/local/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, params }),
        });

        if (res.status === 403) {
          const data = await res.json();
          setState((s) => ({
            ...s,
            executing: false,
            lastError: data.userMessage ?? "需要授权",
            lastResult: data,
          }));
          return data;
        }

        const data = await res.json();
        setState((s) => ({ ...s, executing: false, lastResult: data }));
        return data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, executing: false, lastError: msg }));
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  return {
    state,
    checkAllPermissions,
    checkPermission,
    requestPermission,
    executeAction,
    reset,
  };
}

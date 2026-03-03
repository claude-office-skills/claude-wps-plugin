import { useState, useCallback } from "react";

const PROXY = "http://127.0.0.1:3001";

export interface CapabilityCheck {
  capability: string;
  type: string;
  ready: boolean;
  serverConfigured?: boolean;
  secretsMissing?: string[];
  recipe?: {
    npm: string;
    description: string;
    oauthRequired: boolean;
  };
}

export interface UserAction {
  type: "oauth" | "api_key" | "manual";
  secret: string;
  description: string;
  oauthUrl?: string;
  scopes?: string[];
}

export interface ProvisionResult {
  ok: boolean;
  capability: string;
  fullyResolved: boolean;
  steps: Array<{ action: string; success: boolean; output?: string }>;
  userActionsRequired: UserAction[];
}

export interface EnvironmentInfo {
  [tool: string]: {
    available: boolean;
    path?: string;
    version?: string;
  };
}

export interface McpRecipe {
  name: string;
  npm: string;
  description: string;
  requiredSecrets: string[];
  oauthSupported: boolean;
}

export interface ProvisionState {
  checking: boolean;
  resolving: boolean;
  checks: CapabilityCheck[];
  userActions: UserAction[];
  environment: EnvironmentInfo | null;
  recipes: McpRecipe[];
  error: string | null;
}

const INITIAL: ProvisionState = {
  checking: false,
  resolving: false,
  checks: [],
  userActions: [],
  environment: null,
  recipes: [],
  error: null,
};

export function useProvision() {
  const [state, setState] = useState<ProvisionState>(INITIAL);

  const checkCapability = useCallback(async (capability: string) => {
    setState((prev) => ({ ...prev, checking: true, error: null }));
    try {
      const resp = await fetch(`${PROXY}/provision/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability }),
      });
      const data: CapabilityCheck = await resp.json();
      setState((prev) => ({
        ...prev,
        checking: false,
        checks: [
          ...prev.checks.filter((c) => c.capability !== capability),
          data,
        ],
      }));
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, checking: false, error: msg }));
      return null;
    }
  }, []);

  const resolveCapability = useCallback(
    async (capability: string, secrets?: Record<string, string>) => {
      setState((prev) => ({ ...prev, resolving: true, error: null }));
      try {
        const resp = await fetch(`${PROXY}/provision/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capability, autoInstall: true, secrets }),
        });
        const data: ProvisionResult = await resp.json();
        setState((prev) => ({
          ...prev,
          resolving: false,
          userActions: [
            ...prev.userActions.filter(
              (a) =>
                !data.userActionsRequired.some((n) => n.secret === a.secret),
            ),
            ...data.userActionsRequired,
          ],
        }));
        return data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, resolving: false, error: msg }));
        return null;
      }
    },
    [],
  );

  const storeApiKey = useCallback(async (name: string, value: string) => {
    try {
      await fetch(`${PROXY}/provision/api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value }),
      });
      setState((prev) => ({
        ...prev,
        userActions: prev.userActions.filter((a) => a.secret !== name),
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const loadEnvironment = useCallback(async () => {
    try {
      const resp = await fetch(`${PROXY}/provision/env`);
      const data = await resp.json();
      setState((prev) => ({
        ...prev,
        environment: data.environment ?? null,
      }));
    } catch {}
  }, []);

  const loadRecipes = useCallback(async () => {
    try {
      const resp = await fetch(`${PROXY}/provision/recipes`);
      const data = await resp.json();
      setState((prev) => ({
        ...prev,
        recipes: data.recipes ?? [],
      }));
    } catch {}
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL);
  }, []);

  return {
    state,
    checkCapability,
    resolveCapability,
    storeApiKey,
    loadEnvironment,
    loadRecipes,
    reset,
  };
}

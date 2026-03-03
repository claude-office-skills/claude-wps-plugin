import { memo, useState, useEffect } from "react";
import SidebarBlock from "./SidebarBlock";
import type { UserAction, McpRecipe, EnvironmentInfo } from "../hooks/useProvision";
import styles from "./ProvisionPanel.module.css";

interface Props {
  userActions: UserAction[];
  recipes: McpRecipe[];
  environment: EnvironmentInfo | null;
  resolving: boolean;
  onStoreApiKey: (name: string, value: string) => Promise<boolean>;
  onResolve: (capability: string) => void;
  onLoadRecipes: () => void;
  onLoadEnvironment: () => void;
}

function OAuthCard({ action, onResolve }: { action: UserAction; onResolve: () => void }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardIcon}>
        <span className={styles.oauthBadge}>OAuth</span>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>{action.description}</div>
        {action.oauthUrl && (
          <a
            href={action.oauthUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.connectBtn}
          >
            Connect
          </a>
        )}
        {!action.oauthUrl && (
          <button className={styles.connectBtn} onClick={onResolve}>
            配置
          </button>
        )}
      </div>
    </div>
  );
}

function ApiKeyCard({
  action,
  onSubmit,
}: {
  action: UserAction;
  onSubmit: (name: string, value: string) => void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!value.trim()) return;
    setSaving(true);
    onSubmit(action.secret, value.trim());
    setSaving(false);
    setValue("");
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>{action.description}</div>
        <div className={styles.inputRow}>
          <input
            type="password"
            className={styles.apiKeyInput}
            placeholder={action.secret}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          <button
            className={styles.saveBtn}
            onClick={handleSubmit}
            disabled={saving || !value.trim()}
          >
            {saving ? "..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EnvironmentSection({ env }: { env: EnvironmentInfo }) {
  const tools = Object.entries(env);
  return (
    <div className={styles.envSection}>
      <div className={styles.envTitle}>运行环境</div>
      <div className={styles.envGrid}>
        {tools.map(([name, info]) => (
          <div key={name} className={styles.envItem}>
            <span className={info.available ? styles.envOk : styles.envMissing}>
              {info.available ? "✓" : "✗"}
            </span>
            <span className={styles.envName}>{name}</span>
            {info.version && (
              <span className={styles.envVersion}>
                {info.version.split("\n")[0].slice(0, 20)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RecipeList({
  recipes,
  onResolve,
}: {
  recipes: McpRecipe[];
  onResolve: (name: string) => void;
}) {
  return (
    <div className={styles.recipeSection}>
      <div className={styles.envTitle}>可安装的 MCP 服务</div>
      {recipes.map((r) => (
        <div key={r.name} className={styles.recipeRow}>
          <div className={styles.recipeName}>{r.name}</div>
          <div className={styles.recipeDesc}>{r.description}</div>
          <button
            className={styles.installBtn}
            onClick={() => onResolve(r.name)}
          >
            安装
          </button>
        </div>
      ))}
    </div>
  );
}

function ProvisionPanel({
  userActions,
  recipes,
  environment,
  resolving,
  onStoreApiKey,
  onResolve,
  onLoadRecipes,
  onLoadEnvironment,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded && !environment) onLoadEnvironment();
    if (expanded && recipes.length === 0) onLoadRecipes();
  }, [expanded, environment, recipes.length, onLoadEnvironment, onLoadRecipes]);

  if (userActions.length === 0 && !expanded) return null;

  const oauthActions = userActions.filter((a) => a.type === "oauth");
  const apiKeyActions = userActions.filter((a) => a.type === "api_key");

  return (
    <div className={styles.wrapper}>
      {userActions.length > 0 && (
        <SidebarBlock
          type="approval"
          status={resolving ? "running" : "idle"}
          title={`需要配置 (${userActions.length})`}
        >
          <div className={styles.content}>
            {oauthActions.map((a) => (
              <OAuthCard
                key={a.secret}
                action={a}
                onResolve={() => onResolve(a.secret)}
              />
            ))}
            {apiKeyActions.map((a) => (
              <ApiKeyCard
                key={a.secret}
                action={a}
                onSubmit={onStoreApiKey}
              />
            ))}
          </div>
        </SidebarBlock>
      )}

      <button
        className={styles.expandToggle}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "收起环境信息 ▴" : "环境 & MCP 管理 ▾"}
      </button>

      {expanded && (
        <div className={styles.expandedArea}>
          {environment && <EnvironmentSection env={environment} />}
          {recipes.length > 0 && (
            <RecipeList recipes={recipes} onResolve={onResolve} />
          )}
        </div>
      )}
    </div>
  );
}

export default memo(ProvisionPanel);

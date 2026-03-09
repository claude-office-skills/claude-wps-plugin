import { useState, useEffect, useCallback, memo } from "react";
import styles from "./DataConnectorPanel.module.css";

const PROXY = "http://127.0.0.1:3001";

interface CredentialField {
  key: string;
  label: string;
  configured: boolean;
}

interface ConnectorAction {
  id: string;
  name: string;
  description: string;
}

interface ConnectorInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  layer: "bundled" | "user";
  enabled: boolean;
  requiresCredentials: boolean;
  hasCredentials: boolean;
  credentialStatus: CredentialField[];
  actions: ConnectorAction[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

const CONNECTOR_ICONS: Record<string, { emoji: string; bg: string }> = {
  similarweb: { emoji: "🌐", bg: "#1a3a5c" },
  sensortower: { emoji: "📱", bg: "#3a1a5c" },
  "yahoo-finance": { emoji: "📈", bg: "#1a4a2a" },
};

const DataConnectorPanel = memo(function DataConnectorPanel({
  visible,
  onClose,
}: Props) {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [credInputs, setCredInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newConn, setNewConn] = useState({
    id: "",
    name: "",
    baseUrl: "",
    authType: "header" as "header" | "bearer" | "query",
    authHeaderName: "api-key",
    authQueryParam: "api_key",
    credentialKey: "api_key",
    credentialLabel: "API Key",
  });
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error";
  } | null>(null);

  const showToast = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      setToast({ msg, type });
      setTimeout(() => setToast(null), 2500);
    },
    [],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${PROXY}/data-bridge/connectors`);
      if (resp.ok) {
        const data = await resp.json();
        setConnectors(data);
      }
    } catch {
      /* network error */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    try {
      await fetch(`${PROXY}/data-bridge/connectors/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      await refresh();
    } catch {
      showToast("操作失败", "error");
    }
  };

  const handleStartEdit = (conn: ConnectorInfo) => {
    setEditingId(conn.id);
    const inputs: Record<string, string> = {};
    for (const cs of conn.credentialStatus) {
      inputs[cs.key] = "";
    }
    setCredInputs(inputs);
  };

  const handleSaveCredentials = async (id: string) => {
    const nonEmpty = Object.fromEntries(
      Object.entries(credInputs).filter(([, v]) => v.trim()),
    );
    if (Object.keys(nonEmpty).length === 0) return;

    setSaving(true);
    try {
      const resp = await fetch(
        `${PROXY}/data-bridge/connectors/${id}/credentials`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nonEmpty),
        },
      );
      if (resp.ok) {
        showToast("凭证已加密保存");
        setEditingId(null);
        await refresh();
      } else {
        showToast("保存失败", "error");
      }
    } catch {
      showToast("网络错误", "error");
    }
    setSaving(false);
  };

  const handleRemoveCredentials = async (id: string) => {
    try {
      const resp = await fetch(
        `${PROXY}/data-bridge/connectors/${id}/credentials`,
        { method: "DELETE" },
      );
      if (resp.ok) {
        showToast("凭证已移除");
        await refresh();
      }
    } catch {
      showToast("操作失败", "error");
    }
  };

  const handleCreateConnector = async () => {
    if (!newConn.id || !newConn.name || !newConn.baseUrl) {
      showToast("请填写 ID、名称和 API 地址", "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        id: newConn.id.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        name: newConn.name,
        baseUrl: newConn.baseUrl,
        authType: newConn.authType,
        authHeaderName: newConn.authType === "header" ? newConn.authHeaderName : undefined,
        authQueryParam: newConn.authType === "query" ? newConn.authQueryParam : undefined,
        authCredentialKey: newConn.credentialKey,
        credentials: [
          { key: newConn.credentialKey, label: newConn.credentialLabel, required: true },
        ],
        endpoints: {
          query: { name: "通用查询", path: "/", method: "GET", description: "默认查询端点" },
        },
      };
      const resp = await fetch(`${PROXY}/data-bridge/connectors/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (data.ok) {
        showToast(`数据源「${newConn.name}」已添加`);
        setShowAddForm(false);
        setNewConn({ id: "", name: "", baseUrl: "", authType: "header", authHeaderName: "api-key", authQueryParam: "api_key", credentialKey: "api_key", credentialLabel: "API Key" });
        await refresh();
      } else {
        showToast(data.error || "创建失败", "error");
      }
    } catch {
      showToast("网络错误", "error");
    }
    setSaving(false);
  };

  const handleDeleteConnector = async (id: string) => {
    try {
      const resp = await fetch(`${PROXY}/data-bridge/connectors/${id}`, {
        method: "DELETE",
      });
      const data = await resp.json();
      if (data.ok) {
        showToast("已删除");
        await refresh();
      } else {
        showToast(data.error || "删除失败", "error");
      }
    } catch {
      showToast("网络错误", "error");
    }
  };

  const handleImportScan = async () => {
    try {
      const resp = await fetch(`${PROXY}/data-bridge/import-credentials`, {
        method: "POST",
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.imported?.length > 0) {
          showToast(`已导入 ${data.imported.length} 个凭证`);
        } else {
          showToast("未发现新的凭证文件");
        }
        await refresh();
      }
    } catch {
      showToast("扫描失败", "error");
    }
  };

  if (!visible) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>数据源管理</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className={styles.closeBtn}
              onClick={() => setShowAddForm((v) => !v)}
              title="添加数据源"
              style={{ fontSize: 20, color: showAddForm ? "var(--accent)" : undefined }}
            >
              +
            </button>
            <button className={styles.closeBtn} onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        {/* 添加数据源表单 */}
        {showAddForm && (
          <div className={styles.credForm} style={{ margin: "8px 12px" }}>
            <div className={styles.credFormTitle}>添加自定义数据源</div>
            <div className={styles.credFieldGroup}>
              <div className={styles.credFieldLabel}>数据源 ID（英文小写）</div>
              <input
                className={styles.credFieldInput}
                placeholder="my-data-api"
                value={newConn.id}
                onChange={(e) => setNewConn((p) => ({ ...p, id: e.target.value }))}
              />
            </div>
            <div className={styles.credFieldGroup}>
              <div className={styles.credFieldLabel}>名称</div>
              <input
                className={styles.credFieldInput}
                placeholder="我的数据 API"
                value={newConn.name}
                onChange={(e) => setNewConn((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className={styles.credFieldGroup}>
              <div className={styles.credFieldLabel}>API 基础地址</div>
              <input
                className={styles.credFieldInput}
                placeholder="https://api.example.com/v1"
                value={newConn.baseUrl}
                onChange={(e) => setNewConn((p) => ({ ...p, baseUrl: e.target.value }))}
              />
            </div>
            <div className={styles.credFieldGroup}>
              <div className={styles.credFieldLabel}>认证方式</div>
              <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                {(["header", "bearer", "query"] as const).map((t) => (
                  <button
                    key={t}
                    className={styles.actionBtn}
                    style={{
                      background: newConn.authType === t ? "var(--accent-bg)" : undefined,
                      borderColor: newConn.authType === t ? "var(--accent-border)" : undefined,
                      color: newConn.authType === t ? "var(--accent)" : undefined,
                    }}
                    onClick={() => setNewConn((p) => ({ ...p, authType: t }))}
                  >
                    {t === "header" ? "Header" : t === "bearer" ? "Bearer" : "Query"}
                  </button>
                ))}
              </div>
            </div>
            {newConn.authType === "header" && (
              <div className={styles.credFieldGroup}>
                <div className={styles.credFieldLabel}>Header 名称</div>
                <input
                  className={styles.credFieldInput}
                  placeholder="api-key"
                  value={newConn.authHeaderName}
                  onChange={(e) => setNewConn((p) => ({ ...p, authHeaderName: e.target.value }))}
                />
              </div>
            )}
            {newConn.authType === "query" && (
              <div className={styles.credFieldGroup}>
                <div className={styles.credFieldLabel}>Query 参数名</div>
                <input
                  className={styles.credFieldInput}
                  placeholder="api_key"
                  value={newConn.authQueryParam}
                  onChange={(e) => setNewConn((p) => ({ ...p, authQueryParam: e.target.value }))}
                />
              </div>
            )}
            <div className={styles.credFormActions}>
              <button
                className={`${styles.credFormBtn} ${styles.credFormBtnSave}`}
                disabled={saving || !newConn.id || !newConn.name || !newConn.baseUrl}
                onClick={handleCreateConnector}
              >
                {saving ? "创建中…" : "创建数据源"}
              </button>
              <button
                className={`${styles.credFormBtn} ${styles.credFormBtnCancel}`}
                onClick={() => setShowAddForm(false)}
              >
                取消
              </button>
            </div>
          </div>
        )}

        <div className={styles.connectorList}>
          {loading && connectors.length === 0 && (
            <div className={styles.loadingState}>加载中…</div>
          )}

          {!loading && connectors.length === 0 && (
            <div className={styles.emptyState}>
              <span>暂无数据连接器</span>
            </div>
          )}

          {connectors.map((conn) => {
            const icon = CONNECTOR_ICONS[conn.id] || {
              emoji: "🔌",
              bg: "#2a2a2a",
            };
            const allConfigured =
              !conn.requiresCredentials || conn.hasCredentials;
            const isEditing = editingId === conn.id;
            const isExpanded = expandedId === conn.id;

            return (
              <div key={conn.id} className={styles.connectorCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardLeft}>
                    <div
                      className={styles.connectorIcon}
                      style={{ background: icon.bg }}
                    >
                      {icon.emoji}
                    </div>
                    <span className={styles.connectorName}>{conn.name}</span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {!conn.enabled ? (
                      <span
                        className={`${styles.statusBadge} ${styles.statusDisabled}`}
                      >
                        已禁用
                      </span>
                    ) : allConfigured ? (
                      <span
                        className={`${styles.statusBadge} ${styles.statusConnected}`}
                      >
                        已连接
                      </span>
                    ) : (
                      <span
                        className={`${styles.statusBadge} ${styles.statusPending}`}
                      >
                        待配置
                      </span>
                    )}
                    <button
                      className={`${styles.toggle} ${conn.enabled ? styles.toggleOn : ""}`}
                      onClick={() => handleToggle(conn.id, conn.enabled)}
                    />
                  </div>
                </div>

                <div className={styles.cardDesc}>{conn.description}</div>

                {/* 凭证状态 */}
                {conn.requiresCredentials &&
                  conn.credentialStatus.map((cs) => (
                    <div key={cs.key} className={styles.credentialRow}>
                      <div
                        className={`${styles.credentialDot} ${cs.configured ? styles.credentialDotOk : styles.credentialDotMissing}`}
                      />
                      <span className={styles.credentialLabel}>
                        {cs.label}
                        {cs.configured ? " ✓" : " — 未配置"}
                      </span>
                    </div>
                  ))}

                {/* 操作按钮 */}
                <div className={styles.cardActions}>
                  {conn.requiresCredentials && !isEditing && (
                    <button
                      className={`${styles.actionBtn} ${!allConfigured ? styles.actionBtnPrimary : ""}`}
                      onClick={() => handleStartEdit(conn)}
                    >
                      {allConfigured ? "更新凭证" : "配置凭证"}
                    </button>
                  )}
                  {conn.requiresCredentials && allConfigured && !isEditing && (
                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      onClick={() => handleRemoveCredentials(conn.id)}
                    >
                      移除
                    </button>
                  )}
                  <button
                    className={styles.actionBtn}
                    onClick={() =>
                      setExpandedId(isExpanded ? null : conn.id)
                    }
                  >
                    {isExpanded ? "收起" : "查看能力"}
                  </button>
                  {conn.layer === "user" && (
                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      onClick={() => handleDeleteConnector(conn.id)}
                    >
                      删除
                    </button>
                  )}
                </div>

                {/* 凭证编辑表单 */}
                {isEditing && (
                  <div className={styles.credForm}>
                    <div className={styles.credFormTitle}>
                      配置凭证（加密存储，仅本机可见）
                    </div>
                    {conn.credentialStatus.map((cs) => (
                      <div key={cs.key} className={styles.credFieldGroup}>
                        <div className={styles.credFieldLabel}>
                          {cs.label}
                        </div>
                        <input
                          type="password"
                          className={styles.credFieldInput}
                          placeholder={
                            cs.configured
                              ? "留空保持不变"
                              : `输入 ${cs.label}`
                          }
                          value={credInputs[cs.key] || ""}
                          onChange={(e) =>
                            setCredInputs((prev) => ({
                              ...prev,
                              [cs.key]: e.target.value,
                            }))
                          }
                          autoComplete="off"
                        />
                      </div>
                    ))}
                    <div className={styles.credFormActions}>
                      <button
                        className={`${styles.credFormBtn} ${styles.credFormBtnSave}`}
                        disabled={
                          saving ||
                          Object.values(credInputs).every((v) => !v.trim())
                        }
                        onClick={() => handleSaveCredentials(conn.id)}
                      >
                        {saving ? "保存中…" : "加密保存"}
                      </button>
                      <button
                        className={`${styles.credFormBtn} ${styles.credFormBtnCancel}`}
                        onClick={() => setEditingId(null)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {/* 能力列表 */}
                {isExpanded && (
                  <div className={styles.actionsList}>
                    <div className={styles.actionsTitle}>可用数据接口</div>
                    {conn.actions.map((a) => (
                      <div key={a.id} className={styles.actionItem}>
                        <span className={styles.actionId}>{a.id}</span>
                        <span className={styles.actionName}>
                          {a.name}
                          {a.description ? ` — ${a.description}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 底部提示 */}
        <div className={styles.importHint}>
          <div className={styles.importHintText}>
            也可以将凭证文件放入{" "}
            <span className={styles.importHintPath}>
              ~/.claude-wps/credentials/
            </span>{" "}
            目录，
            <button
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                fontSize: "10px",
                padding: 0,
                textDecoration: "underline",
              }}
              onClick={handleImportScan}
            >
              点击扫描导入
            </button>
          </div>
          <div
            className={styles.importHintText}
            style={{ marginTop: 2, color: "var(--text-faint)" }}
          >
            所有凭证 AES-256 加密存储，仅限本机使用，其他用户不可见
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={`${styles.toast} ${toast.type === "success" ? styles.toastSuccess : styles.toastError}`}
          >
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  );
});

export default DataConnectorPanel;

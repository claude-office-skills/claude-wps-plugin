import { useState, memo } from "react";
import SidebarBlock from "../SidebarBlock";
import { blockStyles } from "../SidebarBlock";

interface Props {
  src: string;
  alt?: string;
  chartType?: string;
  width?: number;
  height?: number;
  onInsertTable?: () => void;
  onDownload?: () => void;
}

function ImageRenderer({
  src,
  alt,
  chartType,
  width,
  height,
  onInsertTable,
  onDownload,
}: Props) {
  const [zoomed, setZoomed] = useState(false);

  const sizeInfo = width && height ? `${width}×${height}` : undefined;
  const title = chartType ? `图表输出 · ${chartType}` : "图表输出";

  const footer = (
    <>
      <span className={blockStyles.footerInfo}>
        {chartType ?? "Image"}
        {sizeInfo && ` · ${sizeInfo}`}
      </span>
      <div className={blockStyles.footerActions}>
        <button
          className={blockStyles.actionBtn}
          onClick={() => setZoomed((v) => !v)}
        >
          {zoomed ? "缩小" : "放大"}
        </button>
        {onInsertTable && (
          <button
            className={`${blockStyles.actionBtn} ${blockStyles.actionBtnPrimary}`}
            onClick={onInsertTable}
          >
            插入表格
          </button>
        )}
        {onDownload && (
          <button className={blockStyles.actionBtn} onClick={onDownload}>
            下载
          </button>
        )}
      </div>
    </>
  );

  return (
    <SidebarBlock type="chart-image" title={title} footer={footer}>
      <div
        style={{
          padding: "8px 14px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <img
          src={src}
          alt={alt ?? "chart output"}
          style={{
            maxWidth: zoomed ? "none" : "100%",
            maxHeight: zoomed ? "none" : 300,
            borderRadius: 4,
            cursor: "pointer",
          }}
          onClick={() => setZoomed((v) => !v)}
        />
      </div>
    </SidebarBlock>
  );
}

export default memo(ImageRenderer);

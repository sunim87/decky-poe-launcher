import React from "react";

import { AppConfig, KakaoMaintenanceInfo } from "../../../shared/types";
import "../ui/ConfirmModal.css";
import "./KakaoMaintenanceModal.css";

type KakaoMaintenanceModalInfo = KakaoMaintenanceInfo & {
  gameId: AppConfig["activeGame"];
  serviceId: "Kakao Games";
};

interface KakaoMaintenanceModalProps {
  info: KakaoMaintenanceModalInfo | null;
  onClose: () => void;
}

const KakaoMaintenanceModal: React.FC<KakaoMaintenanceModalProps> = ({
  info,
  onClose,
}) => {
  if (!info) return null;

  const handleOpenInspection = () => {
    window.open(info.url, "_blank");
  };

  return (
    <div className="confirm-modal-overlay" onClick={onClose}>
      <div
        className="confirm-modal-content variant-primary kakao-maintenance-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-modal-header kakao-maintenance-header">
          <span className="material-symbols-outlined kakao-maintenance-modal-icon">
            construction
          </span>
          <div>
            <h2 className="confirm-title">서비스 점검 중</h2>
            <p className="kakao-maintenance-subtitle">{info.title}</p>
          </div>
        </div>

        <div className="confirm-modal-body">
          {info.description && (
            <p className="confirm-message kakao-maintenance-description">
              {info.description}
            </p>
          )}

          {info.details.length > 0 && (
            <dl className="kakao-maintenance-modal-details">
              {info.details.map(({ label, value }) => (
                <div className="kakao-maintenance-modal-row" key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="confirm-modal-actions">
          <button
            className="btn-confirm-secondary"
            onClick={handleOpenInspection}
          >
            점검 페이지 열기
          </button>
          <button className="btn-confirm-primary btn-primary" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
};

export default KakaoMaintenanceModal;

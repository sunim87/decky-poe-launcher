import React, { useState } from "react";

import imgUacTooltip from "../../assets/settings/uac-tooltip.png";
import "../ui/ConfirmModal.css";

interface KakaoStarterUacModalProps {
  isOpen: boolean;
  onConfirm: () => Promise<boolean>;
  onDecline: () => Promise<void>;
}

const KakaoStarterUacModal: React.FC<KakaoStarterUacModalProps> = ({
  isOpen,
  onConfirm,
  onDecline,
}) => {
  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setErrorMsg("");
    setApplying(true);
    try {
      const success = await onConfirm();
      if (!success) {
        setErrorMsg(
          "UAC 우회 적용에 실패했습니다. 설정에서 다시 시도해 주세요.",
        );
        setApplying(false);
      }
    } catch (error) {
      setErrorMsg(
        error instanceof Error
          ? error.message
          : "UAC 우회 적용 중 오류가 발생했습니다.",
      );
      setApplying(false);
    }
  };

  const handleDecline = async () => {
    setErrorMsg("");
    setApplying(true);
    try {
      await onDecline();
    } catch (error) {
      setErrorMsg(
        error instanceof Error
          ? error.message
          : "UAC 우회 설정을 끄는 중 오류가 발생했습니다.",
      );
      setApplying(false);
    }
  };

  return (
    <div className="confirm-modal-overlay">
      <div
        className="confirm-modal-content variant-primary"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "540px" }}
      >
        <div className="confirm-modal-header">
          <h2 className="confirm-title">카카오게임즈 스타터 UAC 우회</h2>
        </div>
        <div className="confirm-modal-body">
          <p className="confirm-message" style={{ whiteSpace: "pre-line" }}>
            카카오게임즈 스타터가 설치되어 있지만 UAC 우회가 아직 적용되지
            않았습니다.
            {"\n\n"}
            기존 UAC 우회 설정이 켜져 있어도 새 스타터에는 별도로 적용해야
            합니다. 지금 적용하시겠습니까?
            {"\n\n"}
            <small style={{ color: "#aaa" }}>
              거절하면 UAC 우회 설정을 끕니다. 나중에 설정 &gt; 게임 &gt;
              카카오게임즈 스타터 UAC 우회에서 다시 활성화할 수 있습니다.
            </small>
            {errorMsg && (
              <>
                {"\n\n"}
                <span style={{ color: "#f48771", fontWeight: "bold" }}>
                  {errorMsg}
                </span>
              </>
            )}
          </p>
          <img
            src={imgUacTooltip}
            alt="사용자 계정 컨트롤 안내 예시"
            style={{
              display: "block",
              width: "100%",
              maxHeight: "180px",
              objectFit: "contain",
              marginTop: "16px",
              border: "1px solid #333",
              borderRadius: "6px",
              background: "#101010",
            }}
          />
        </div>
        <div className="confirm-modal-actions">
          <button
            className="btn-confirm-secondary"
            onClick={handleDecline}
            disabled={applying}
          >
            설정 끄기
          </button>
          <button
            className="btn-confirm-primary btn-primary"
            onClick={handleConfirm}
            disabled={applying}
          >
            {applying ? "처리 중..." : "지금 적용"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default KakaoStarterUacModal;

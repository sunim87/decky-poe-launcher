import React from "react";

import { SettingsCategory } from "../../settings/types";
import "../../settings/Settings.css";

interface Props {
  categories: SettingsCategory[];
  activeCategoryId: string;
  onSelectCategory: (id: string) => void;
}

const SettingsSidebar: React.FC<Props> = ({
  categories,
  activeCategoryId,
  onSelectCategory,
}) => {
  return (
    <div className="settings-sidebar">
      <div className="settings-header">설정</div>
      <div className="sidebar-menu">
        {categories.map((cat) => (
          <button
            type="button"
            key={cat.id}
            aria-pressed={activeCategoryId === cat.id}
            className={`sidebar-item ${activeCategoryId === cat.id ? "active" : ""}`}
            onClick={() => onSelectCategory(cat.id)}
          >
            {/* Google Font Icon */}
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "20px" }}
            >
              {cat.icon}
            </span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SettingsSidebar;

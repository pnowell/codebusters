import React, { useState } from 'react';
import { Modal } from './Modal';
import { reloadForCriticalVersion } from '../../services/versionService';

interface VersionUpdateModalProps {
  requiredCriticalVersion: number | null;
}

/**
 * Non-dismissible modal shown whenever Firestore `/classroom_config/app_version`
 * reports a `criticalVersion` higher than the currently loaded client's `CRITICAL_VERSION`.
 */
export const VersionUpdateModal: React.FC<VersionUpdateModalProps> = ({
  requiredCriticalVersion,
}) => {
  const [isReloading, setIsReloading] = useState(false);

  const handleReload = () => {
    if (requiredCriticalVersion === null || isReloading) return;
    setIsReloading(true);
    void reloadForCriticalVersion(requiredCriticalVersion);
  };

  return (
    <Modal
      isOpen={requiredCriticalVersion !== null}
      onClose={() => {}}
      closeOnBackdrop={false}
      closeOnEscape={false}
      ariaLabelledBy="version-update-modal-title"
      backdropClassName="version-update-backdrop"
      dialogClassName="modal-dialog card-panel not-allowed-dialog"
    >
      <div className="modal-header">
        <h3 id="version-update-modal-title">🔄 App Update Required</h3>
      </div>

      <div className="modal-body not-allowed-body">
        <div className="not-allowed-icon" aria-hidden="true">
          🚀
        </div>
        <h4>Please Reload DaVinci Decoders</h4>
        <p className="not-allowed-desc">
          A critical update has been released since this tab was opened. Cloud sync and
          leaderboards are paused until you reload.
        </p>
        <p className="not-allowed-subdesc">
          Reload the app to continue practicing with the latest fixes.
        </p>

        <div className="not-allowed-actions">
          <button
            type="button"
            className="btn-main-action"
            disabled={isReloading}
            onClick={handleReload}
          >
            {isReloading ? 'Reloading…' : 'Reload App Now'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

import React from 'react';
import { useAuth } from '../../context/useAuth';

interface UserAuthBadgeProps {
  displayName?: string;
  onOpenOptions?: () => void;
}

export const UserAuthBadge: React.FC<UserAuthBadgeProps> = ({ displayName, onOpenOptions }) => {
  const { user, allowedUser, isAllowed, isLoading, isConfigured, signIn } = useAuth();

  if (isLoading) {
    return (
      <div className="auth-badge loading-badge">
        <span className="spinner-dots">•••</span>
      </div>
    );
  }

  if (isAllowed && user) {
    const badgeName =
      (displayName && displayName !== 'Decoder' ? displayName : null) ||
      allowedUser?.displayName ||
      user.displayName ||
      'Decoder';

    return (
      <button
        className="auth-badge logged-in-badge"
        onClick={onOpenOptions}
        title={`${badgeName} (${user.email}) - Click for Options`}
      >
        <span className="auth-name">{badgeName}</span>
        <span className="auth-sync-indicator" title="Cloud Sync Active">●</span>
      </button>
    );
  }

  return (
    <button
      className="auth-badge guest-badge"
      onClick={() => {
        if (!isConfigured) {
          onOpenOptions?.();
          return;
        }
        signIn();
      }}
      title={isConfigured ? 'Sign in with your Google account' : 'Firebase not configured — click for Options'}
    >
      <span className="auth-avatar-fallback">👤</span>
      <span className="auth-name">Sign In</span>
    </button>
  );
};

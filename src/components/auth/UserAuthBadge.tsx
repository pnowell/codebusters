import React from 'react';
import { useAuth } from '../../context/useAuth';

interface UserAuthBadgeProps {
  onOpenOptions?: () => void;
}

export const UserAuthBadge: React.FC<UserAuthBadgeProps> = ({ onOpenOptions }) => {
  const { user, allowedUser, isAllowed, isLoading, isConfigured, signIn } = useAuth();

  if (isLoading) {
    return (
      <div className="auth-badge loading-badge">
        <span className="spinner-dots">•••</span>
      </div>
    );
  }

  if (isAllowed && user) {
    const displayName = allowedUser?.displayName || user.displayName || 'Decoder';

    return (
      <button
        className="auth-badge logged-in-badge"
        onClick={onOpenOptions}
        title={`${displayName} (${user.email}) - Click for Options`}
      >
        <span className="auth-name">{displayName}</span>
        <span className="auth-sync-indicator" title="Cloud Sync Active">●</span>
      </button>
    );
  }

  return (
    <button
      className="auth-badge guest-badge"
      onClick={() => {
        if (!isConfigured) {
          alert('Firebase is not configured yet. Please add your credentials to .env.local.');
          return;
        }
        signIn();
      }}
      title={isConfigured ? 'Sign in with your Google account' : 'Firebase not configured in .env.local'}
    >
      <span className="auth-avatar-fallback">👤</span>
      <span className="auth-name">Sign In</span>
    </button>
  );
};

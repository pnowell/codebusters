import React from 'react';
import { useAuth } from '../../context/useAuth';

interface UserAuthBadgeProps {
  onOpenOptions?: () => void;
}

export const UserAuthBadge: React.FC<UserAuthBadgeProps> = ({ onOpenOptions }) => {
  const { user, allowedUser, isAllowed, isLoading, isConfigured, signIn, signOut } = useAuth();

  if (isLoading) {
    return (
      <div className="auth-badge loading-badge">
        <span className="spinner-dots">•••</span>
      </div>
    );
  }

  if (isAllowed && user) {
    const displayName = allowedUser?.displayName || user.displayName || 'Decoder';
    const role = allowedUser?.role;
    const isTeacherOrCoach = role === 'coach' || role === 'teacher';
    const roleLabel = role === 'teacher' ? 'Teacher' : 'Coach';

    return (
      <div className="auth-badge-container">
        <button
          className={`auth-badge logged-in-badge ${isTeacherOrCoach ? 'coach-badge' : ''}`}
          onClick={onOpenOptions}
          title={`${displayName} (${user.email}) - Click for Options`}
        >
          {user.photoURL ? (
            <img src={user.photoURL} alt="" className="auth-avatar-img" referrerPolicy="no-referrer" />
          ) : (
            <span className="auth-avatar-fallback">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="auth-name">{displayName}</span>
          {isTeacherOrCoach && <span className="auth-role-tag">{roleLabel}</span>}
          <span className="auth-sync-indicator" title="Cloud Sync Active">●</span>
        </button>

        <button
          className="btn-simple btn-signout"
          onClick={signOut}
          title="Sign out of Google"
        >
          Log Out
        </button>
      </div>
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

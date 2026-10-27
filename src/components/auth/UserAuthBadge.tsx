import React from 'react';
import { useAuth } from '../../context/useAuth';

interface UserAuthBadgeProps {
  onOpenOptions?: () => void;
}

export const UserAuthBadge: React.FC<UserAuthBadgeProps> = ({ onOpenOptions }) => {
  const { user, allowedUser, isAllowed, isLoading, isConfigured, signIn, signOut } = useAuth();

  if (!isConfigured) {
    return (
      <button className="auth-badge guest-badge" onClick={onOpenOptions} title="Classroom Settings (Local Storage Mode)">
        <span className="auth-avatar-fallback">👤</span>
        <span className="auth-name">Guest Mode</span>
      </button>
    );
  }

  if (isLoading) {
    return (
      <div className="auth-badge loading-badge">
        <span className="spinner-dots">•••</span>
      </div>
    );
  }

  if (isAllowed && user) {
    const displayName = allowedUser?.displayName || user.displayName || 'Decoder';
    const isCoach = allowedUser?.role === 'coach';

    return (
      <div className="auth-badge-container">
        <button
          className={`auth-badge logged-in-badge ${isCoach ? 'coach-badge' : ''}`}
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
          {isCoach && <span className="auth-role-tag">Coach</span>}
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
      className="btn-google-signin"
      onClick={signIn}
      title="Sign in with your Google account"
    >
      <svg className="google-icon" viewBox="0 0 24 24" width="16" height="16">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        />
      </svg>
      <span>Sign In</span>
    </button>
  );
};

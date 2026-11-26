import { useState } from 'react'
import { DEFAULT_SERVER, KoSyncError, login, logout, register, saveKoSettings, useKoSync } from '../lib/kosync'

export function KoSyncSettings() {
  const s = useKoSync()
  const [server, setServer] = useState(s.server || DEFAULT_SERVER)
  const [username, setUsername] = useState(s.username ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'login' | 'register' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loggedIn = !!(s.username && s.userkey)

  const run = async (kind: 'login' | 'register') => {
    setError(null)
    setBusy(kind)
    try {
      const url = server.trim() || DEFAULT_SERVER
      if (kind === 'login') await login(url, username.trim(), password)
      else await register(url, username.trim(), password)
      setPassword('')
    } catch (e) {
      setError(e instanceof KoSyncError ? e.message : `Couldn't reach the server. ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="ko-settings">
      <p className="muted small">
        Sync reading positions with KOReader on your Kindle or other devices. Works for PDF, EPUB and CBZ files that are identical
        on both sides (copy them from your library folders over USB).
      </p>
      {loggedIn ? (
        <>
          <div className="ko-status">
            <span className="ko-dot" /> Signed in as <b>{s.username}</b>
            <span className="muted small ko-server" title={s.server}>
              {s.server}
            </span>
            <button className="btn sm" onClick={() => logout()}>
              Sign out
            </button>
          </div>
          <label className="ap-check">
            <input type="checkbox" checked={s.enabled} onChange={(e) => saveKoSettings({ enabled: e.target.checked })} />
            Sync automatically when opening and reading books
          </label>
          <label className="ko-field">
            <span className="muted small">This device appears in KOReader as</span>
            <input
              className="input"
              value={s.deviceName}
              onChange={(e) => useKoSync.setState({ deviceName: e.target.value })}
              onBlur={(e) => saveKoSettings({ deviceName: e.target.value.trim() || 'Trove' })}
            />
          </label>
        </>
      ) : (
        <div className="form ko-form">
          <label>
            Server
            <input className="input" value={server} onChange={(e) => setServer(e.target.value)} placeholder={DEFAULT_SERVER} />
          </label>
          <div className="ko-row">
            <label>
              Username
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </label>
            <label>
              Password
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                onKeyDown={(e) => e.key === 'Enter' && username && password && run('login')}
              />
            </label>
          </div>
          {error && <div className="ko-error">{error}</div>}
          <div className="modal-actions left">
            <button className="btn primary" disabled={!username || !password || !!busy} onClick={() => run('login')}>
              {busy === 'login' ? 'Signing in…' : 'Sign in'}
            </button>
            <button className="btn" disabled={!username || !password || !!busy} onClick={() => run('register')}>
              {busy === 'register' ? 'Creating…' : 'Create account'}
            </button>
            <span className="muted small">Use the same account you set up in KOReader.</span>
          </div>
        </div>
      )}
    </div>
  )
}

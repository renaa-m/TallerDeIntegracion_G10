import './app_loading.css'

interface AppLoadingProps {
  message?: string
  compact?: boolean
}

function AppLoading({
  message = 'Sincronizando...',
  compact = false,
}: AppLoadingProps) {
  return (
    <div
      className={`app-loading${compact ? ' app-loading--compact' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="app-loading-spinner" aria-hidden="true" />
      <p className="app-loading-message">{message}</p>
    </div>
  )
}

export default AppLoading

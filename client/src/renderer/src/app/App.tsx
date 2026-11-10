import { useEffect, useState } from 'react'
import { Onboarding } from '../pages/Onboarding'
import { Dictionary } from '../pages/Dictionary'
import { History } from '../pages/History'
import { Home } from '../pages/Home'
import { Settings } from '../pages/Settings'
import { Snippets } from '../pages/Snippets'
import { StylePage } from '../pages/Style'
import { parseHash, type Route } from '../lib/route'
import { AppProvider, useApp } from './AppContext'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import { ToastProvider } from '../components/Toast'

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash))
  useEffect(() => {
    const on = (): void => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

function Page({ route }: { route: Route }): React.JSX.Element {
  switch (route) {
    case 'history':
      return <History />
    case 'dictionary':
      return <Dictionary />
    case 'snippets':
      return <Snippets />
    case 'style':
      return <StylePage />
    case 'settings':
      return <Settings />
    default:
      return <Home />
  }
}

function Shell(): React.JSX.Element {
  const route = useRoute()
  const { platform } = useApp()
  useEffect(() => {
    document.documentElement.dataset.platform = platform
  }, [platform])
  useEffect(() => {
    document.title = route === 'onboarding' ? 'Welcome to WisprRam' : `${route[0].toUpperCase()}${route.slice(1)} · WisprRam`
  }, [route])

  if (route === 'onboarding') return <Onboarding />
  return (
    <div className="app">
      <TitleBar />
      <Sidebar route={route} />
      <main className="content" id="main">
        <div className="page" key={route}>
          <Page route={route} />
        </div>
      </main>
    </div>
  )
}

export function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </ToastProvider>
  )
}

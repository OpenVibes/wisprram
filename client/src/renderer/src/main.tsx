import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import './styles/tokens.css'
import './styles/app.css'
import { App } from './app/App'
import { installMockBridgeIfNeeded } from './mock/install'

installMockBridgeIfNeeded()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/overlay.css'
import { installMockBridgeIfNeeded } from './mock/install'
import { Overlay } from './overlay/Overlay'

installMockBridgeIfNeeded()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>
)

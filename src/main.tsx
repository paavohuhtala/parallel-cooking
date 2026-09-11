import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { MotionProvider } from './components/motion.tsx'
import { router } from './router.tsx'
import './styles.css'

// The single-user build kept the whole kitchen here. State lives on the server
// now, so the old blob is dead weight sitting in every returning user's browser.
try {
  localStorage.removeItem('parallel-cooking/v1')
} catch {
  // Storage unavailable; nothing to clean up.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider>
      <RouterProvider router={router} />
    </MotionProvider>
  </StrictMode>,
)

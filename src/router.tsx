import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { getMenu, getRoom } from './api/client.ts'
import LandingRoute from './routes/LandingRoute.tsx'
import MenuEditorRoute from './routes/MenuEditorRoute.tsx'
import RoomRoute from './routes/RoomRoute.tsx'

const rootRoute = createRootRoute({ component: Outlet })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingRoute,
})

const roomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/r/$roomId',
  // Resolved before the socket opens, so a dead link renders a real page
  // instead of a connection error.
  loader: ({ params }) => getRoom(params.roomId),
  component: RoomRoute,
  errorComponent: () => (
    <div className="splash">
      <h1>Keittiötä ei löytynyt</h1>
      <p>Linkki voi olla vanhentunut tai väärin kirjoitettu.</p>
      <a className="btn" href="/">
        Takaisin alkuun
      </a>
    </div>
  ),
})

const menuRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/m/$menuId',
  // Same reasoning as the room route: resolve first, so a dead link renders a
  // real page rather than an empty editor.
  loader: ({ params }) => getMenu(params.menuId),
  component: MenuEditorRoute,
  errorComponent: () => (
    <div className="splash">
      <h1>Menua ei löytynyt</h1>
      <p>Linkki voi olla vanhentunut tai väärin kirjoitettu.</p>
      <a className="btn" href="/">
        Takaisin alkuun
      </a>
    </div>
  ),
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, roomRoute, menuRoute]),
  defaultNotFoundComponent: () => (
    <div className="splash">
      <h1>Sivua ei löytynyt</h1>
      <a className="btn" href="/">
        Takaisin alkuun
      </a>
    </div>
  ),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
